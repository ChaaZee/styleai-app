"""
fix_depop_titles.py — Replace slug-style titles with real Depop product titles
===========================================================================

THE PROBLEM:
    Some Depop listings in depop_cache have a slug as their title instead of a
    real human-readable title, e.g.:
        "vintage-nike-hoodie-abc123"   (bad — a URL slug)
    instead of:
        "Men's Vintage Nike Hoodie Size M"   (good — the real title)

WHAT THIS SCRIPT DOES:
    1. Loads every depop_cache row whose listings come from Depop (_source = 'depop')
    2. For each listing whose title looks like a slug (all lowercase, has hyphens,
       no spaces), fetches the real title from the Depop product detail API:
           GET https://api.depop.com/api/v3/products/{slug}/
    3. Writes the corrected title back into the listings array and upserts the row
    4. Prints a per-fix log and a final summary

SLUG DETECTION:
    A title is treated as a slug if it is all lowercase AND contains a hyphen AND
    has no spaces. "vintage-nike-hoodie-abc123" → slug. "Vintage Nike Hoodie" → real.

USAGE (PowerShell):
    pip install requests psycopg2-binary
    python scripts/python/fix_depop_titles.py              # dry run (safe, no writes)
    python scripts/python/fix_depop_titles.py --apply      # actually write changes

NOTES:
    - The product detail endpoint does not require a cookie, but DEPOP_COOKIE is
      supported at the top just in case the WAF starts demanding one.
    - Rate-limited to ~0.3s between API calls to stay polite.
    - listings is parsed defensively in Python — never with jsonb functions in SQL,
      because some rows store listings as a double-encoded JSON string.
===========================================================================
"""

import os
import sys
import json
import time
import requests
import psycopg2

# ── CONFIG ────────────────────────────────────────────────────────────────────
# Prefer the DATABASE_URL env var; fall back to the shared hardcoded value used
# by the other scripts in this folder.
DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres",
)

DRY_RUN     = "--apply" not in sys.argv   # safe by default — pass --apply to write
DELAY_SECS  = 0.3                          # sleep between Depop API calls
TIMEOUT     = 15                           # seconds per request

# Optional Depop cookie. Product detail fetches usually work without one, but if
# the WAF starts blocking cookieless requests, paste a browser cookie here.
# Get it: DevTools → Network → any depop.com request → Headers → copy "cookie:" value
DEPOP_COOKIE = os.environ.get("DEPOP_COOKIE", "")

# Standard browser headers (mirrors depop_seed.py / cleanup.py).
HEADERS = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "origin": "https://www.depop.com",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}
if DEPOP_COOKIE:
    HEADERS["cookie"] = DEPOP_COOKIE


# ── SLUG DETECTION ──────────────────────────────────────────────────────────--
def is_slug_title(title: str) -> bool:
    """A title is a slug if it's all lowercase, has a hyphen, and no spaces.

    Examples:
        "vintage-nike-hoodie-abc123" → True
        "Vintage Nike Hoodie"        → False
        "hoodie"                     → False (no hyphen)
    """
    if not title:
        return False
    return title == title.lower() and "-" in title and " " not in title


def extract_slug(listing: dict) -> str:
    """Get the slug from the listing's `slug` field, or parse it from the URL."""
    slug = (listing.get("slug") or "").strip().strip("/")
    if slug:
        return slug
    # Fall back to parsing /products/{slug}/ out of the URL
    url = listing.get("url", "") or ""
    marker = "/products/"
    if marker in url:
        tail = url.split(marker, 1)[1]
        return tail.split("/")[0].split("?")[0].split("#")[0]
    return ""


# ── DEPOP API ─────────────────────────────────────────────────────────────────
def fetch_real_title(slug: str):
    """Fetch the real product title from the Depop v3 product detail API.

    Returns the title string, or None if it couldn't be found (non-200 response,
    missing fields, or a request error). Never raises.
    """
    url = f"https://api.depop.com/api/v3/products/{slug}/"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    except Exception as e:
        print(f"  [skip] {slug} → request error: {e}")
        return None

    if resp.status_code != 200:
        print(f"  [skip] {slug} → HTTP {resp.status_code}")
        return None

    try:
        data = resp.json()
    except Exception:
        print(f"  [skip] {slug} → invalid JSON response")
        return None

    # Prefer "description", fall back to "title" — whichever is non-empty.
    for key in ("description", "title"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    print(f"  [skip] {slug} → no title/description in response")
    return None


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(DB_URL, sslmode="require")


def load_depop_rows(cursor):
    """Load all cache rows, returning (query, listings_list) for rows that have
    at least one Depop-sourced listing.

    Filtering happens in Python — never with jsonb_array_length / jsonb scalar
    functions in SQL, because some rows store listings as a double-encoded JSON
    string and those functions crash on non-array values.
    """
    cursor.execute("SELECT query, listings FROM depop_cache ORDER BY query")
    rows = cursor.fetchall()
    result = []
    for query, listings_raw in rows:
        listings = parse_listings(listings_raw)
        if not isinstance(listings, list) or not listings:
            continue
        # Keep the row only if any listing is from Depop.
        if any((l.get("_source") == "depop") for l in listings if isinstance(l, dict)):
            result.append((query, listings))
    return result


def parse_listings(listings_raw):
    """Defensively parse the listings column into a Python list.

    Handles three storage shapes: a real list, a JSON string wrapping a list,
    and a double-encoded JSON string. Returns [] on anything unparseable.
    """
    value = listings_raw
    # Unwrap up to two layers of JSON string encoding.
    for _ in range(2):
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except Exception:
                return []
        else:
            break
    return value if isinstance(value, list) else []


def upsert_row(cursor, query, listings):
    """Write the updated listings array back to the row, keyed on `query`."""
    cursor.execute(
        "UPDATE depop_cache SET listings = %s::jsonb WHERE query = %s",
        (json.dumps(listings), query),
    )


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    mode = "DRY RUN" if DRY_RUN else "APPLY MODE"
    print(f"\nStitch — Fix Depop Titles — {mode}\n")
    if DRY_RUN:
        print("  Pass --apply to actually write changes.\n")
    if not DEPOP_COOKIE:
        print("  (no DEPOP_COOKIE set — product detail fetches usually work without one)\n")

    conn = get_connection()
    cur = conn.cursor()

    print("Loading Depop cache rows...")
    rows = load_depop_rows(cur)
    print(f"  {len(rows)} rows with Depop listings loaded\n")

    fixed = skipped = failed = 0

    for query, listings in rows:
        row_changed = False

        for listing in listings:
            if not isinstance(listing, dict):
                continue
            # Only touch Depop listings.
            if listing.get("_source") != "depop":
                continue

            title = listing.get("title", "") or ""
            if not is_slug_title(title):
                skipped += 1   # already a real title
                continue

            slug = extract_slug(listing)
            if not slug:
                print(f"  [skip] (no slug) \"{title}\"")
                failed += 1
                continue

            real_title = fetch_real_title(slug)
            time.sleep(DELAY_SECS)  # rate limit between API calls

            if not real_title:
                failed += 1
                continue

            print(f"  [fix] \"{title}\" → \"{real_title}\"")
            listing["title"] = real_title
            row_changed = True
            fixed += 1

        # Persist the row once, after all its listings are processed.
        if row_changed and not DRY_RUN:
            upsert_row(cur, query, listings)
            conn.commit()

    cur.close()
    conn.close()

    print(f"\n{'='*50}")
    print(f"Fixed {fixed} titles, skipped {skipped} (already real), failed {failed}")
    if DRY_RUN:
        print("Dry run — re-run with --apply to write these changes.")
    print()


if __name__ == "__main__":
    main()
