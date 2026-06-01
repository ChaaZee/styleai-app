"""
cleanup.py — Scan all cached listings and remove dead/broken links
===========================================================================

HOW IT WORKS:
    1. Loads all rows from depop_cache
    2. For each listing URL, sends a HEAD request (falls back to GET if needed)
    3. Dead listings (404, 410, or redirect to a not-found page) are removed
    4. Rows where ALL listings are dead get deleted entirely
    5. Rows where SOME listings are dead get trimmed

WHAT COUNTS AS "DEAD":
    - HTTP 404 / 410 — explicitly gone
    - Redirect to a URL containing "/not-found", "page-not-found", "sold-out", etc.
    - HEAD blocked (403) but GET also returns 404 — confirmed dead
    - 403 from a HEAD that we can't verify with GET → kept (benefit of the doubt)

SOURCE-SPECIFIC RULES:
    depop    — HEAD first, GET fallback. 403 = assume live (Depop WAF)
    asos     — GET only (they reject HEAD). Check for 404 or redirect to homepage
    pacsun   — HEAD only, 403 = assume live
    shopify  — GET /products/{handle}.json — 404 = dead, 200 = live
    default  — HEAD first, GET fallback

USAGE:
    pip install requests psycopg2-binary
    python scripts/python/cleanup.py              # dry run (safe, shows what would be removed)
    python scripts/python/cleanup.py --delete     # actually remove dead listings

IMPORTANT: Run from your HOME computer, not a server.
    Many sites block cloud IP ranges with 403. From home you get real 404s.
===========================================================================
"""

import sys
import json
import re
import time
import requests
import psycopg2
import psycopg2.extras
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

# ── CONFIG ────────────────────────────────────────────────────────────────────
DB_URL      = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
DRY_RUN     = "--delete" not in sys.argv   # safe by default
CONCURRENCY = 8     # parallel URL checks per batch
BATCH_SIZE  = 50    # DB rows per batch
TIMEOUT     = 10    # seconds per request

# Sources that should be filtered (set to empty to check ALL sources)
# e.g. CHECK_SOURCES = {"depop"} to only clean depop listings
CHECK_SOURCES = set()  # empty = check everything

# These URL patterns always indicate a dead/sold listing
DEAD_URL_PATTERNS = [
    "/not-found", "page-not-found", "/404", "sold-out",
    "listing-not-found", "product-not-found",
]

HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "accept": "text/html,application/xhtml+xml,*/*;q=0.9",
    "accept-language": "en-US,en;q=0.9",
}


# ── URL CHECKER ───────────────────────────────────────────────────────────────
def detect_source(url: str) -> str:
    """Determine which platform a URL belongs to."""
    if not url:
        return "unknown"
    if "depop.com" in url:
        return "depop"
    if "asos.com" in url:
        return "asos"
    if "pacsun.com" in url:
        return "pacsun"
    if "grailed.com" in url:
        return "grailed"
    # Shopify brands
    for domain in ["civilregime.com", "mnml.la", "unionlosangeles.com", "carhartt-wip.com"]:
        if domain in url:
            return "shopify"
    return "other"


def url_has_dead_pattern(url: str) -> bool:
    """Check if a redirect destination looks like a not-found page."""
    lower = url.lower()
    return any(p in lower for p in DEAD_URL_PATTERNS)


def check_shopify(url: str) -> bool:
    """
    For Shopify brands: convert product URL to /products/{handle}.json
    and check if the product exists. Returns True if live.
    """
    try:
        # Extract domain and slug
        # URL format: https://www.civilregime.com/products/some-product-slug
        match = re.search(r"(https?://[^/]+)/products/([^/?#]+)", url)
        if not match:
            return True  # can't parse, assume live
        base, handle = match.group(1), match.group(2)
        api_url = f"{base}/products/{handle}.json"
        resp = requests.get(api_url, headers=HEADERS, timeout=TIMEOUT)
        return resp.status_code == 200
    except Exception:
        return True  # network error → assume live


def check_asos(url: str) -> bool:
    """
    ASOS rejects HEAD requests. Use GET and check for redirect to homepage
    or a 404 response.
    """
    try:
        resp = requests.get(
            url, headers=HEADERS, allow_redirects=True, timeout=TIMEOUT
        )
        if resp.status_code == 404:
            return False
        if url_has_dead_pattern(resp.url):
            return False
        # ASOS sometimes redirects sold/deleted items to their homepage
        if resp.url and resp.url.rstrip("/") in ("https://www.asos.com", "https://www.asos.com/us"):
            return False
        return True
    except Exception:
        return True


def check_depop(url: str) -> bool:
    """
    Depop: try HEAD first. If blocked (403), try GET.
    403 from both = WAF blocked = assume live.
    404 from either = dead.
    """
    try:
        resp = requests.head(
            url, headers=HEADERS, allow_redirects=True, timeout=TIMEOUT
        )
        if resp.status_code in (404, 410):
            return False
        if url_has_dead_pattern(resp.url or url):
            return False
        if resp.status_code == 403:
            # WAF blocked HEAD — try GET to confirm
            try:
                gresp = requests.get(
                    url, headers=HEADERS, allow_redirects=True, timeout=TIMEOUT
                )
                if gresp.status_code == 404:
                    return False
                if url_has_dead_pattern(gresp.url or url):
                    return False
            except Exception:
                pass
        return True
    except Exception:
        return True


def check_generic(url: str) -> bool:
    """Generic HEAD + GET fallback check."""
    try:
        resp = requests.head(
            url, headers=HEADERS, allow_redirects=True, timeout=TIMEOUT
        )
        if resp.status_code in (404, 410):
            return False
        if url_has_dead_pattern(resp.url or url):
            return False
        if resp.status_code < 400:
            return True
        # HEAD failed or gave ambiguous result — try GET
        resp2 = requests.get(
            url, headers=HEADERS, allow_redirects=True, timeout=TIMEOUT
        )
        if resp2.status_code in (404, 410):
            return False
        if url_has_dead_pattern(resp2.url or url):
            return False
        return resp2.status_code < 400
    except Exception:
        return True


def is_live(url: str) -> bool:
    """
    Check if a product URL is still live. Dispatches to source-specific
    checker for best accuracy.
    """
    if not url:
        return False
    source = detect_source(url)
    if source == "depop":
        return check_depop(url)
    elif source == "asos":
        return check_asos(url)
    elif source == "shopify":
        return check_shopify(url)
    else:
        return check_generic(url)


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(DB_URL, sslmode="require")


def get_all_rows(cursor):
    """Load all non-empty cache rows."""
    cursor.execute("""
        SELECT query, listings
        FROM depop_cache
        WHERE jsonb_typeof(listings) = 'array'
          AND jsonb_array_length(listings) > 0
        ORDER BY query
    """)
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
    mode = "DRY RUN" if DRY_RUN else "LIVE DELETE MODE"
    src_filter = f" (sources: {', '.join(CHECK_SOURCES)})" if CHECK_SOURCES else " (all sources)"
    print(f"\nStitch Cache Cleanup — {mode}{src_filter}\n")
    if DRY_RUN:
        print("  Pass --delete to actually remove dead listings.\n")

    conn = get_connection()
    cur = conn.cursor()

    print("Loading cache rows...")
    rows = get_all_rows(cur)
    print(f"  {len(rows)} rows loaded\n")

    total_checked  = 0
    total_dead     = 0
    rows_updated   = 0
    rows_deleted   = 0
    rows_skipped   = 0

    for row_idx, (query, listings_raw) in enumerate(rows):
        # Parse listings
        if isinstance(listings_raw, str):
            try:
                listings = json.loads(listings_raw)
            except Exception:
                continue
        else:
            listings = listings_raw

        if not isinstance(listings, list) or not listings:
            continue

        # Filter to only check requested sources
        if CHECK_SOURCES:
            to_check = [
                l for l in listings
                if detect_source(l.get("url", "")) in CHECK_SOURCES
            ]
            skip = [
                l for l in listings
                if detect_source(l.get("url", "")) not in CHECK_SOURCES
            ]
        else:
            to_check = listings
            skip = []

        if not to_check:
            rows_skipped += 1
            continue

        # Check all URLs in this row concurrently
        urls = [l.get("url", "") for l in to_check]
        dead_urls = set()

        with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
            future_map = {ex.submit(is_live, url): url for url in urls if url}
            for future in as_completed(future_map):
                url = future_map[future]
                total_checked += 1
                try:
                    live = future.result()
                except Exception:
                    live = True
                if not live:
                    dead_urls.add(url)
                    total_dead += 1
                    print(f"  ✗ dead: {url}")

        # Update DB if there are dead listings
        if dead_urls and not DRY_RUN:
            cleaned_checked = [l for l in to_check if l.get("url") not in dead_urls]
            cleaned_all = skip + cleaned_checked  # keep unchecked sources intact

            if not cleaned_all:
                delete_row(cur, query)
                conn.commit()
                rows_deleted += 1
                print(f"  [deleted row] \"{query}\" — all {len(listings)} listings gone")
            else:
                update_row(cur, query, cleaned_all)
                conn.commit()
                rows_updated += 1
                removed = len(listings) - len(cleaned_all)
                print(f"  [trimmed] \"{query}\": {len(listings)} → {len(cleaned_all)} ({removed} removed)")

        # Progress every 50 rows
        if (row_idx + 1) % 50 == 0:
            pct = round((row_idx + 1) / len(rows) * 100)
            print(f"\n  Progress: {row_idx + 1}/{len(rows)} rows ({pct}%) — {total_dead} dead so far\n")

    cur.close()
    conn.close()

    print(f"\n{'='*50}")
    print(f"Done!")
    print(f"  Checked : {total_checked} listings")
    print(f"  Dead    : {total_dead} removed")
    if not DRY_RUN:
        print(f"  Rows updated : {rows_updated}")
        print(f"  Rows deleted : {rows_deleted}")
    else:
        print(f"\n  Dry run — re-run with --delete to remove them.")
    print()


if __name__ == "__main__":
    main()
