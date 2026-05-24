"""
cleanup.py — Scan all cached Depop listings and remove ones that are no longer available.

HOW IT WORKS:
  1. Loads all rows from the depop_cache table
  2. For each listing, sends a HEAD request to its Depop URL
  3. If the listing returns 404 (not found) or 410 (gone) → marks it as dead
  4. Removes dead listings from their cache row
  5. If ALL listings in a row are dead → deletes the entire row

IMPORTANT — RUN THIS ON YOUR LOCAL MACHINE:
  Depop blocks HEAD requests from server/cloud IPs with 403.
  Running from your home internet gets real 200/404 responses.
  403 is treated as "still live" (blocked, not gone).

USAGE:
  pip install requests psycopg2-binary
  python scripts/python/cleanup.py           # dry run — shows what would be removed
  python scripts/python/cleanup.py --delete  # actually removes dead listings
"""

import sys
import json
import time
import requests
import psycopg2
import psycopg2.extras
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── CONFIG ────────────────────────────────────────────────────────────────────
DB_URL       = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
DRY_RUN      = "--delete" not in sys.argv  # safe by default, pass --delete to actually remove
CONCURRENCY  = 10    # how many URLs to check at the same time
BATCH_SIZE   = 50    # how many DB rows to process at once
TIMEOUT_SECS = 8     # how long to wait for each URL check


# ── URL CHECKER ───────────────────────────────────────────────────────────────
def is_live(url):
    """
    Returns True if the listing is still available, False if it's gone.
    - 404 / 410 = listing deleted or sold → dead
    - 403 / 429 = blocked by Depop (not our fault) → assume live
    - Anything else (200, redirect) → live
    """
    if not url:
        return False
    try:
        resp = requests.head(
            url,
            headers={"user-agent": "Mozilla/5.0", "accept": "text/html"},
            allow_redirects=True,
            timeout=TIMEOUT_SECS,
        )
        # Explicit "gone" responses
        if resp.status_code in (404, 410):
            return False
        # Blocked by Depop's WAF — we can't tell if it's live, assume it is
        if resp.status_code in (403, 429):
            return True
        # Check if we got redirected to a "not found" page
        final_url = resp.url or url
        if "/not-found" in final_url or "page-not-found" in final_url:
            return False
        return resp.status_code < 400
    except Exception:
        # Network error, timeout — assume live (don't delete on flaky connections)
        return True


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(DB_URL, sslmode="require")

def get_total_rows(cursor):
    cursor.execute("""
        SELECT COUNT(*) FROM depop_cache
        WHERE listings IS NOT NULL AND listings::text NOT IN ('[]', 'null', '')
    """)
    return cursor.fetchone()[0]

def fetch_batch(cursor, limit, offset):
    """Fetches a batch of cache rows ordered by query."""
    cursor.execute("""
        SELECT query, listings FROM depop_cache
        WHERE listings IS NOT NULL AND listings::text NOT IN ('[]', 'null', '')
        ORDER BY query
        LIMIT %s OFFSET %s
    """, (limit, offset))
    return cursor.fetchall()

def delete_row(cursor, query):
    cursor.execute("DELETE FROM depop_cache WHERE query = %s", (query,))

def update_row(cursor, query, listings):
    cursor.execute(
        "UPDATE depop_cache SET listings = %s::jsonb WHERE query = %s",
        (json.dumps(listings), query)
    )


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    mode = "DRY RUN (pass --delete to actually remove)" if DRY_RUN else "LIVE — deleting dead listings"
    print(f"\n🪡  Stitch Cache Cleanup ({mode})\n")

    conn = get_connection()
    cursor = conn.cursor()

    total_rows = get_total_rows(cursor)
    print(f"📦  {total_rows} cache rows to scan\n")

    total_checked = 0
    total_dead    = 0
    rows_updated  = 0
    rows_deleted  = 0
    offset        = 0

    while offset < total_rows:
        # Load a batch of rows from the DB
        batch = fetch_batch(cursor, BATCH_SIZE, offset)
        if not batch:
            break

        for query, listings_raw in batch:
            # Parse listings — stored as either a list or a JSON string
            if isinstance(listings_raw, str):
                try:
                    listings = json.loads(listings_raw)
                except Exception:
                    continue
            else:
                listings = listings_raw

            if not isinstance(listings, list) or not listings:
                continue

            # Collect all URLs that have a value
            urls = [l.get("url") for l in listings if l.get("url")]
            if not urls:
                continue

            # Check all URLs concurrently
            dead_urls = set()
            with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
                future_to_url = {executor.submit(is_live, url): url for url in urls}
                for future in as_completed(future_to_url):
                    url = future_to_url[future]
                    total_checked += 1
                    try:
                        live = future.result()
                    except Exception:
                        live = True  # assume live on error
                    if not live:
                        dead_urls.add(url)
                        total_dead += 1
                        print(f"  ❌  dead: {url}")

            # Remove dead listings from this row
            if dead_urls and not DRY_RUN:
                cleaned = [l for l in listings if l.get("url") not in dead_urls]
                if not cleaned:
                    # All listings in this row are dead — delete the whole row
                    delete_row(cursor, query)
                    conn.commit()
                    rows_deleted += 1
                    print(f"  🗑️  deleted row: \"{query}\" (all {len(listings)} listings gone)")
                else:
                    # Some listings survive — update with cleaned list
                    update_row(cursor, query, cleaned)
                    conn.commit()
                    rows_updated += 1
                    print(f"  ✂️  trimmed \"{query}\": {len(listings)} → {len(cleaned)} listings")

        offset += BATCH_SIZE
        pct = min(100, round(offset / total_rows * 100))
        print(f"\n  📊  Progress: {min(offset, total_rows)}/{total_rows} rows ({pct}%) — {total_dead} dead so far\n")

    cursor.close()
    conn.close()

    print(f"\n✅  Done!")
    print(f"   Checked : {total_checked} listings across {total_rows} rows")
    print(f"   Dead    : {total_dead} listings removed")
    if not DRY_RUN:
        print(f"   Updated : {rows_updated} rows trimmed")
        print(f"   Deleted : {rows_deleted} rows fully removed")
    else:
        print(f"\n   ℹ️  Dry run — re-run with --delete to remove them.")
    print()

if __name__ == "__main__":
    main()
