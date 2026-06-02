"""
cleanup.py — Scan all cached listings and remove dead/broken links
===========================================================================

HOW IT WORKS:
    1. Loads all rows from depop_cache
    2. For each listing, checks whether the product still exists
    3. Dead listings are removed; rows that become fully empty are deleted

WHAT COUNTS AS "DEAD":
    - HTTP 404 / 410 — explicitly gone
    - Redirect to a URL containing "/not-found", "page-not-found", "sold-out", etc.
    - Depop (with cookie): slug not found in search results → dead
    - Depop (no cookie): 403 from WAF → skipped (can't tell)

SOURCE-SPECIFIC RULES:
    depop    — Uses Depop search API with cookie (same as seed script).
               Set your cookie in the DEPOP_COOKIE env var.
               Without cookie: Depop listings are SKIPPED (WAF blocks all checks).
    asos     — GET only (they reject HEAD). Check for 404 or redirect to homepage.
    pacsun   — HEAD only, 403 = assume live.
    shopify  — GET /products/{handle}.json — 404 = dead, 200 = live.
    default  — HEAD first, GET fallback.

USAGE:
    pip install requests psycopg2-binary
    python scripts/python/cleanup.py              # dry run (safe, shows what would be removed)
    python scripts/python/cleanup.py --delete     # actually remove dead listings

FOR DEPOP CLEANUP:
    1. Go to depop.com in Chrome and browse for a second
    2. DevTools (F12) → Network → any depop request → Headers → copy full "cookie:" value
    3. Set it as the DEPOP_COOKIE env var (PowerShell: $env:DEPOP_COOKIE = "...")
    4. Run from your HOME computer (not a server)
===========================================================================
"""

import os
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
DB_URL      = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres",
)
DRY_RUN     = "--delete" not in sys.argv   # safe by default
CONCURRENCY = 8     # parallel URL checks per batch
TIMEOUT     = 10    # seconds per request

# Depop browser cookie enables Depop dead-link checking (read from DEPOP_COOKIE env var).
# Without this, Depop listings are skipped (their WAF blocks all cookieless requests).
# Get it: DevTools → Network → any depop.com request → Headers → copy "cookie:" value
DEPOP_COOKIE = os.environ.get("DEPOP_COOKIE", "")
if not DEPOP_COOKIE:
    print("[warn] DEPOP_COOKIE env var not set — Depop API calls may fail")

# Sources to check. Leave empty to check all sources.
# Example: CHECK_SOURCES = {"depop"} to only clean Depop listings.
CHECK_SOURCES = set()

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


def extract_depop_slug(url: str) -> str:
    """Extract the full product slug from a Depop URL.

    Example:
        https://www.depop.com/products/seller-title-words-ab12/
        → 'seller-title-words-ab12'
    """
    m = re.search(r'/products/([^/?#]+)', url)
    return m.group(1).rstrip('/') if m else ""


def check_depop(url: str) -> bool:
    """
    Verify a Depop listing using the same v3 search API the seed script uses.

    Strategy:
      - Extract the slug from the URL (e.g. 'seller-cool-jacket-ab12')
      - Search Depop for that exact slug string
      - If any result has the same slug → listing is live
      - If 0 results or slug absent → listing is dead

    Requires DEPOP_COOKIE to be set. Without a cookie the Depop WAF returns
    403 for every request (live or dead), so we skip and assume live.
    """
    if not DEPOP_COOKIE:
        # Cannot check without a cookie — skip to avoid false positives
        return True

    slug = extract_depop_slug(url)
    if not slug:
        return True  # malformed URL, keep it

    try:
        api_headers = {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            "cookie": DEPOP_COOKIE,
            "origin": "https://www.depop.com",
            "referer": f"https://www.depop.com/products/{slug}/",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "user-agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        }
        # Search using the slug as the query — if the listing exists it will
        # appear in results and its slug will match exactly.
        params = {
            "what": slug,
            "items_per_page": 5,
            "country": "us",
            "currency": "USD",
        }
        resp = requests.get(
            "https://www.depop.com/api/v3/search/products/",
            headers=api_headers,
            params=params,
            timeout=TIMEOUT,
        )
        if resp.status_code == 403:
            # Cookie expired or WAF block — can't tell, assume live
            return True
        if resp.status_code != 200:
            return True  # network error, assume live

        data = resp.json()
        products = data.get("products") or data.get("objects") or []
        # Check if any result has our exact slug
        for product in products:
            if product.get("slug", "") == slug:
                return True  # found it — listing is live
        # Slug not in results → listing is gone
        return False
    except Exception:
        return True  # network error, assume live


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
    """Load all non-empty cache rows.

    Intentionally avoids jsonb_array_length in SQL — some rows store listings
    as a JSON string instead of a JSON array, causing the function to throw
    even inside a subquery. We filter empty/non-array rows in Python instead.
    """
    cursor.execute("""
        SELECT query, listings
        FROM depop_cache
        ORDER BY query
    """)
    all_rows = cursor.fetchall()
    result = []
    for query, listings_raw in all_rows:
        # Normalise: listings may be stored as a JSONB string wrapping an array
        if isinstance(listings_raw, str):
            try:
                listings = json.loads(listings_raw)
            except Exception:
                continue
        else:
            listings = listings_raw
        # Skip non-arrays and empty arrays
        if isinstance(listings, list) and len(listings) > 0:
            # Re-pack as parsed list so callers don't need to re-parse
            result.append((query, listings))
    return result


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
    if not DEPOP_COOKIE:
        print("  ⚠⃣  DEPOP_COOKIE is empty — Depop listings will be SKIPPED.")
        print("     Set your Depop browser cookie in the DEPOP_COOKIE env var.\n")

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
