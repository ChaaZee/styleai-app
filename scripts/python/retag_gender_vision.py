"""
retag_gender_vision.py -- Visual gender retagging using Gemini Flash vision.

WHY THIS EXISTS:
  retag_gender.py uses title text (e.g. "women's jacket" -> female).
  That works for explicitly labelled items, but leaves many as "both" --
  things like "vintage denim jacket" where the silhouette clearly reads
  men's or women's from the photo but the title is neutral.

  This script fetches every listing tagged "both" (or all listings if
  --all is passed), downloads the image, and asks Gemini Flash to
  classify the garment as male / female / unisex. It only overwrites
  "both" tags by default -- never clobbers a clear text-based tag.

USAGE:
  pip install psycopg2-binary google-genai requests
  python scripts/python/retag_gender_vision.py            # only "both" items
  python scripts/python/retag_gender_vision.py --all      # every listing
  python scripts/python/retag_gender_vision.py --dry-run  # print, don't save

COST ESTIMATE:
  Gemini 2.0 Flash-Lite is ~$0.000035 / image.
  10,000 "both" listings ~= $0.35.
"""

import argparse
import base64
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
import psycopg2.extras
import requests
from google import genai
from google.genai import types

# ── CONFIG ────────────────────────────────────────────────────────────────────
def _load_env_var(name):
    """Read a var from env or the project .env file."""
    val = os.getenv(name, "")
    if not val:
        env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
        if os.path.exists(env_path):
            for line in open(env_path):
                if line.startswith(f"{name}="):
                    val = line.split("=", 1)[1].strip().strip('"')
                    break
    return val


DB_URL = _load_env_var("DATABASE_URL")
if not DB_URL:
    print("ERROR: DATABASE_URL not set. Export it or add to .env")
    sys.exit(1)
GEMINI_KEY    = os.getenv("GEMINI_API_KEY", "")
MODEL         = "gemini-2.5-flash-lite"
BATCH_SIZE    = 50
CONCURRENCY   = 3
IMG_TIMEOUT   = 8
MAX_IMG_BYTES = 4 * 1024 * 1024  # 4 MB inline limit

GENDER_PROMPT = (
    "Look at the clothing item in this product photo. "
    "Classify whose clothing it is: reply with exactly one word -- "
    "'male', 'female', or 'unisex'. "
    "Base your answer on silhouette, cut, styling, and visual cues. "
    "If genuinely ambiguous or you cannot see clear clothing, reply 'unisex'."
)

# ── GEMINI ────────────────────────────────────────────────────────────────────
def init_client():
    key = GEMINI_KEY
    if not key:
        env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
        if os.path.exists(env_path):
            for line in open(env_path):
                if line.startswith("GEMINI_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"')
                    break
    if not key:
        print("ERROR: GEMINI_API_KEY not set. Export it or add to .env")
        sys.exit(1)
    # http_options timeout (seconds) closes hung connections instead of hanging forever
    return genai.Client(api_key=key, http_options={"timeout": 120})


def fetch_image_b64(url):
    """Download image, return (base64_str, mime_type) or None."""
    try:
        r = requests.get(url, timeout=IMG_TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code != 200:
            return None
        mime = r.headers.get("content-type", "image/jpeg").split(";")[0]
        data = r.content
        if len(data) > MAX_IMG_BYTES:
            return None
        return base64.b64encode(data).decode(), mime
    except Exception:
        return None


def classify_gender_vision(client, url):
    """Ask Gemini to visually classify garment gender. Returns 'male'/'female'/'both'/None."""
    img = fetch_image_b64(url)
    if img is None:
        return None
    b64, mime = img

    for attempt in range(8):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=[
                    types.Part.from_bytes(data=base64.b64decode(b64), mime_type=mime),
                    GENDER_PROMPT,
                ],
                config=types.GenerateContentConfig(temperature=0.0, max_output_tokens=8),
            )
            raw = response.text.strip().lower()
            print(f"  [gemini raw] {response.text.strip()!r}", flush=True)
            if "female" in raw:
                return "female"
            if "male" in raw:
                return "male"
            return "both"
        except Exception as e:
            msg = str(e).lower()
            wait = min(10 * (2 ** attempt), 120)
            if "timeout" in msg or "timed out" in msg or "deadline" in msg:
                print(f"  [timeout attempt {attempt+1}/8] retrying in {wait}s", flush=True)
            elif "503" in msg or "unavailable" in msg or "429" in msg or "resource_exhausted" in msg:
                print(f"  [rate limit attempt {attempt+1}/8] retrying in {wait}s", flush=True)
            else:
                print(f"  [gemini error] {e}", flush=True)
                return None
            time.sleep(wait)

    print(f"  [gave up after 8 attempts] {url[:60]}", flush=True)
    return None


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(DB_URL, sslmode="require")


def fetch_rows(cursor, only_both, offset, limit):
    where = "listings IS NOT NULL AND listings::text NOT IN ('[]', 'null', '')"
    if only_both:
        where += ' AND listings::text LIKE \'%%"_gender": "both"%%\''
    cursor.execute(
        f"SELECT query, listings::text FROM depop_cache WHERE {where} ORDER BY query LIMIT %s OFFSET %s",
        (limit, offset),
    )
    return cursor.fetchall()


# ── PER-LISTING WORKER ────────────────────────────────────────────────────────
def process_listing(args):
    listing, client = args
    old_gender = listing.get("_gender", "both")
    url = listing.get("image") or listing.get("imageUrl") or ""
    if not url:
        return listing, old_gender

    new_gender = classify_gender_vision(client, url)
    if new_gender is None:
        return listing, old_gender

    title = listing.get("title") or listing.get("name") or "(no title)"
    marker = "CHANGED" if new_gender != old_gender else "same"
    print(f"  [{marker}] {old_gender} -> {new_gender}  |  {title[:70]}")
    return listing, new_gender


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all",     action="store_true", help='Process all listings, not just "both"')
    parser.add_argument("--dry-run", action="store_true", help="Print changes but do not save to DB")
    args = parser.parse_args()

    only_both = not args.all
    dry_run   = args.dry_run

    target_label = "all listings" if args.all else 'only "both" listings'
    print("\nStitch Visual Gender Retagger")
    print(f"  Model:    {MODEL}")
    print(f"  Target:   {target_label}")
    print(f"  Dry run:  {dry_run}\n")

    client = init_client()
    conn   = get_connection()
    cur    = conn.cursor()

    where = "listings IS NOT NULL AND listings::text NOT IN ('[]', 'null', '')"
    if only_both:
        where += ' AND listings::text LIKE \'%%"_gender": "both"%%\''
    cur.execute(f"SELECT COUNT(*) FROM depop_cache WHERE {where}")
    total_rows = cur.fetchone()[0]
    print(f"Found {total_rows} cache rows in scope\n")

    total_checked = 0
    total_changed = 0
    offset        = 0

    while offset < total_rows:
        rows = fetch_rows(cur, only_both, offset, BATCH_SIZE)
        if not rows:
            break

        for query, listings_raw in rows:
            try:
                listings = json.loads(listings_raw) if isinstance(listings_raw, str) else listings_raw
            except Exception:
                continue
            if not isinstance(listings, list) or not listings:
                continue

            print(f"\n[row {offset + 1}/{total_rows}] {query!r} ({len(listings)} listings)")

            work = [(l, client) for l in listings]
            results_ordered = [None] * len(work)
            row_changed = 0

            with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
                futures = {pool.submit(process_listing, w): i for i, w in enumerate(work)}
                for future in as_completed(futures):
                    idx = futures[future]
                    listing, new_gender = future.result()
                    old_gender = listing.get("_gender", "both")
                    if new_gender != old_gender:
                        row_changed += 1
                        total_changed += 1
                        listing = dict(listing)
                        listing["_gender"] = new_gender
                    results_ordered[idx] = listing

            total_checked += len(listings)

            if not dry_run and row_changed > 0:
                cur.execute(
                    "UPDATE depop_cache SET listings = %s::jsonb WHERE query = %s",
                    (json.dumps(results_ordered), query),
                )
                conn.commit()

        offset += len(rows)
        pct = min(100, round(offset / total_rows * 100))
        print(f"\n  -- Progress: {offset}/{total_rows} rows ({pct}%) | {total_changed} tags changed --")

    cur.close()
    conn.close()

    action = "would change" if dry_run else "changed"
    print(f"\nDone.")
    print(f"  {total_checked:,} listings checked")
    print(f"  {total_changed:,} gender tags {action}\n")


if __name__ == "__main__":
    main()
