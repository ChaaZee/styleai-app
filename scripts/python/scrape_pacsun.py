"""
scrape_pacsun.py — Fetch products from Pacsun and insert into Stitch cache
===========================================================================

HOW TO USE:
    1. pip install requests psycopg2-binary beautifulsoup4
    2. Get fresh cookies from your browser:
         - Go to pacsun.com in Chrome
         - Press F12 → Network tab → Fetch/XHR
         - Reload the page
         - Click any request → Headers → scroll to "Request Headers"
         - Copy the full "cookie:" value and paste it below as COOKIE
    3. Edit SEARCH_QUERIES to control what categories to fetch
    4. Run:  python scripts/python/scrape_pacsun.py

WHY COOKIES ARE NEEDED:
    Pacsun uses PerimeterX bot protection. Requests without your real
    browser cookies get blocked with a 403. The cookies expire after a
    few hours, so you'll need to grab fresh ones each session.

    This script MUST be run locally (on your own computer), NOT from
    the Render server, because the cookies are tied to your home IP.

IMPORTANT:
    Don't commit your cookie string to GitHub!
===========================================================================
"""

import requests
import psycopg2
import json
import re
import time


# ── PASTE YOUR COOKIE STRING HERE ─────────────────────────────────────────────
# Get from DevTools → any pacsun.com request → Headers → cookie:
# It's a long string that starts with "cqcid=..." — paste the whole thing
COOKIE = ""  # <-- paste here


# ── DATABASE ──────────────────────────────────────────────────────────────────
DB_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# ── SEARCH QUERIES ────────────────────────────────────────────────────────────
# Each entry: (search_term, aesthetic, garment_type, gender)
# These control what Pacsun pages we visit and how we tag the results
SEARCH_QUERIES = [
    ("mens hoodie",      "Streetwear",  "tops",      "male"),
    ("mens graphic tee", "Streetwear",  "tops",      "male"),
    ("mens cargo pants", "Streetwear",  "bottoms",   "male"),
    ("mens jacket",      "Streetwear",  "outerwear", "male"),
    ("mens shorts",      "Streetwear",  "bottoms",   "male"),
    ("womens hoodie",    "Y2K",         "tops",      "female"),
    ("womens graphic",   "Y2K",         "tops",      "female"),
]


# ── CONFIG ────────────────────────────────────────────────────────────────────
ITEMS_PER_QUERY = 12        # max products to fetch per search query
DELAY_SECS = 2.0            # seconds to wait between page requests
DRY_RUN = False             # set True to test without writing to DB


# ── HEADERS ──────────────────────────────────────────────────────────────────
# These headers mimic a real Chrome browser request
# The cookie is the critical part — without it Pacsun blocks the request
def make_headers(referer="https://www.pacsun.com/"):
    return {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cookie": COOKIE,
        "referer": referer,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    }


def load_existing_urls(conn):
    """
    Load all product URLs already in the cache into a set for O(1) lookup.
    We extract the 'url' field from every listing object in every row so we
    can skip any listing whose URL is already stored (prevents duplicates).
    """
    cur = conn.cursor()
    cur.execute("""
        SELECT listing->>'url'
        FROM depop_cache,
        jsonb_array_elements(listings) AS listing
        WHERE listing->>'url' IS NOT NULL
    """)
    rows = cur.fetchall()
    cur.close()
    return set(row[0] for row in rows)  # a set of URL strings


def get_product_urls_from_search(query):
    """
    Fetch the Pacsun search results page for a query and extract product page URLs.

    Pacsun renders products server-side (the HTML contains the page links).
    We pull out URLs that match the pattern: /brand-name/product-name-XXXXXXXXXXXXX.html
    The 13-digit number at the end is Pacsun's product ID.

    Returns a list of relative URLs like:
        ["/nightlab/full-zip-hoodie-0190522800038.html", ...]
    """
    # URL-encode the query (spaces → %20 or +)
    encoded_query = requests.utils.quote(query)
    url = f"https://www.pacsun.com/search?q={encoded_query}&v=c"

    print(f"  Searching: {url}")
    resp = requests.get(url, headers=make_headers(), timeout=15)

    if resp.status_code != 200:
        print(f"  ✗ Status {resp.status_code} — cookies may be expired, grab fresh ones")
        return []

    html = resp.text

    # Extract all href links that look like product pages
    # Pacsun product URLs always end with a 13-digit number before .html
    # Example: /nightlab/full-zip-hoodie-0190522800038.html
    all_hrefs = re.findall(r'href="(/[^"]+\.html)"', html)

    # Filter to only actual product pages (have a 13-digit ID at the end)
    product_urls = list(dict.fromkeys([   # dict.fromkeys removes duplicates while preserving order
        u for u in all_hrefs
        if re.search(r'-\d{13}\.html$', u)
    ]))

    print(f"  Found {len(product_urls)} product URLs")
    return product_urls[:ITEMS_PER_QUERY]


def get_product_details(product_path):
    """
    Visit a single Pacsun product page and extract title, price, and image.

    Pacsun uses Open Graph meta tags (og:title, og:image, og:price:amount)
    which are reliable and consistent across all product pages.
    These are HTML <meta> tags in the <head> section.

    Returns a dict with title, price, image, url — or None if scraping fails.
    """
    url = f"https://www.pacsun.com{product_path}"
    resp = requests.get(url, headers=make_headers("https://www.pacsun.com/search"), timeout=15)

    if resp.status_code != 200:
        print(f"    ✗ Skipping {product_path} (status {resp.status_code})")
        return None

    html = resp.text

    # og:title = the product name, e.g. "Nightlab Full Zip Hoodie"
    title_match = re.search(r'<meta property="og:title" content="([^"]+)"', html)
    title = title_match.group(1).strip() if title_match else None

    # og:image = the main product photo URL (CDN link to the image)
    image_match = re.search(r'<meta property="og:image" content="([^"]+)"', html)
    image = image_match.group(1) if image_match else None

    # Try a few different price patterns (Pacsun uses multiple formats)
    price = None
    for pattern in [
        r'<meta property="og:price:amount" content="([^"]+)"',  # Open Graph price
        r'"price"\s*:\s*"([\d.]+)"',                            # JSON-LD price
        r'\$\s*([\d]+\.\d{2})',                                 # plain dollar amount in HTML
    ]:
        m = re.search(pattern, html)
        if m:
            price = f"${m.group(1)}"
            break

    # If we couldn't get the title, this page probably didn't load right
    if not title:
        return None

    return {
        "title": title,
        "price": price or "N/A",
        "image": image,
        "url": url,
    }


def upsert_to_db(conn, query_key, aesthetic, garment_type, gender, listings):
    """
    Insert a batch of Pacsun listings into the depop_cache table.
    Uses ON CONFLICT to append to existing rows rather than overwrite.
    Duplicates were already filtered out via existing_urls before we got here;
    the ON CONFLICT append remains as a safety net for truly new listings.
    """
    if not listings:
        return

    if DRY_RUN:
        print(f"    [DRY RUN] Would insert {len(listings)} listings for '{query_key}'")
        return

    cur = conn.cursor()
    cur.execute("""
        INSERT INTO depop_cache (query, listings, aesthetic, garment_type, permanent, created_at)
        VALUES (%s, %s::jsonb, %s, %s, true, NOW())
        ON CONFLICT (query) DO UPDATE
        SET listings = depop_cache.listings || EXCLUDED.listings::jsonb,
            updated_at = NOW()
    """, (
        query_key,
        json.dumps(listings),
        aesthetic,
        garment_type,
    ))
    conn.commit()
    cur.close()
    print(f"    ✓ Inserted {len(listings)} listings into cache")


def main():
    if not COOKIE:
        print("ERROR: You need to paste your Pacsun cookie string into COOKIE = \"\" at the top of this file")
        print("Get it from: DevTools → Network → any pacsun.com request → Headers → cookie:")
        return

    print("=" * 60)
    print("Stitch — Pacsun Scraper")
    print("=" * 60)

    # Connect to the database
    conn = psycopg2.connect(DB_URL, sslmode="require")
    print("✓ Connected to database\n")

    # Load every URL already in the cache ONCE up front so we can skip
    # listings we've already stored (prevents duplicate entries).
    existing_urls = load_existing_urls(conn)
    print(f"✓ Loaded {len(existing_urls)} existing URLs from cache\n")

    total_inserted = 0

    for search_term, aesthetic, garment_type, gender in SEARCH_QUERIES:
        print(f"\n── Query: '{search_term}' → {aesthetic}/{garment_type}/{gender} ──")

        # Step 1: Get product page URLs from search results
        product_urls = get_product_urls_from_search(search_term)
        if not product_urls:
            print("  No products found — skipping")
            continue

        time.sleep(DELAY_SECS)

        # Step 2: Visit each product page to get details
        listings = []
        for i, path in enumerate(product_urls):
            print(f"  [{i+1}/{len(product_urls)}] {path}")
            details = get_product_details(path)

            if details and details["image"]:
                # Build the listing in our cache format
                listing = {
                    "title": details["title"],
                    "price": details["price"],
                    "image": details["image"],
                    "url": details["url"],
                    "seller": "pacsun",     # brand name as seller
                    "slug": path.split("/")[-1].replace(".html", ""),
                    "query": search_term,
                    "_gender": gender,
                    "_source": "pacsun",
                }
                # Dedup check: skip any listing whose URL is already in the
                # cache (or already seen earlier in this run).
                if listing["url"] in existing_urls:
                    print(f"    ⟳ Already in cache, skipping: {listing['title']}")
                    time.sleep(DELAY_SECS)
                    continue
                existing_urls.add(listing["url"])  # add so we don't dupe within this run
                listings.append(listing)
                print(f"    ✓ {details['title']} — {details['price']}")

            time.sleep(DELAY_SECS)

        # Step 3: Insert into database
        # Use a consistent cache key so re-runs append rather than duplicate
        cache_key = f"pacsun {search_term}"
        upsert_to_db(conn, cache_key, aesthetic, garment_type, gender, listings)
        total_inserted += len(listings)

    conn.close()
    print(f"\n{'=' * 60}")
    print(f"Done! Inserted {total_inserted} products total")


if __name__ == "__main__":
    main()
