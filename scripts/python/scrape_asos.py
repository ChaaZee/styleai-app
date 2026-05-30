"""
scrape_asos.py — Fetch products from ASOS and insert into Stitch cache
===========================================================================

HOW TO USE:
    1. pip install requests psycopg2-binary
    2. Get fresh cookies from your browser:
         - Go to asos.com in Chrome
         - Press F12 → Network tab → Fetch/XHR
         - Search for a product (e.g. "hoodie")
         - Click any asos.com request → Headers → copy the "cookie:" value
         - Paste it below as COOKIE
    3. Run:  python scripts/python/scrape_asos.py

WHY COOKIES ARE NEEDED:
    ASOS uses Cloudflare bot protection. Without real browser cookies,
    the response comes back empty (0 bytes). Like Pacsun, this must be
    run locally, NOT from the Render server.

ASOS STRUCTURE:
    ASOS renders products server-side inside a __NEXT_DATA__ JSON blob
    embedded in the HTML. We extract that JSON to get clean product data
    without needing to parse messy HTML.

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
# Get from: asos.com → DevTools → any request → Headers → cookie:
COOKIE = ""  # <-- paste here


# ── DATABASE ──────────────────────────────────────────────────────────────────
DB_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# ── SEARCH QUERIES ────────────────────────────────────────────────────────────
# (search_term, aesthetic, garment_type, gender)
SEARCH_QUERIES = [
    ("mens oversized hoodie",     "Streetwear",  "tops",      "male"),
    ("mens cargo trousers",       "Streetwear",  "bottoms",   "male"),
    ("mens graphic tee",          "Streetwear",  "tops",      "male"),
    ("mens bomber jacket",        "Streetwear",  "outerwear", "male"),
    ("womens oversized hoodie",   "Coquette",    "tops",      "female"),
    ("womens mini dress",         "Coquette",    "tops",      "female"),
    ("mens slim trousers",        "Minimalist",  "bottoms",   "male"),
    ("mens plain white tee",      "Minimalist",  "tops",      "male"),
]


# ── CONFIG ────────────────────────────────────────────────────────────────────
ITEMS_PER_QUERY = 12
DELAY_SECS = 2.0
DRY_RUN = False


def make_headers(referer="https://www.asos.com/"):
    """Build headers that mimic a real Chrome browser on ASOS."""
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
    # Guard against rows where listings is not a JSON array (e.g. null or object)
    # jsonb_typeof checks the type before calling jsonb_array_elements to avoid crashes
    cur.execute("""
        SELECT listing->>'url'
        FROM depop_cache,
        jsonb_array_elements(listings) AS listing
        WHERE jsonb_typeof(listings) = 'array'
          AND listing->>'url' IS NOT NULL
    """)
    rows = cur.fetchall()
    cur.close()
    return set(row[0] for row in rows)  # a set of URL strings


def search_asos(query, limit=12):
    """
    Fetch ASOS search results page and extract product data from the
    embedded __NEXT_DATA__ JSON blob.

    ASOS uses Next.js, which embeds the initial page data as a JSON object
    in a <script id="__NEXT_DATA__"> tag. This is much cleaner than parsing
    HTML — it gives us structured product objects directly.

    Returns a list of parsed product dicts.
    """
    encoded = requests.utils.quote(query)
    url = f"https://www.asos.com/us/search/?q={encoded}"

    print(f"  Searching: {url}")
    resp = requests.get(url, headers=make_headers(), timeout=15)

    if resp.status_code != 200 or len(resp.text) < 100:
        print(f"  ✗ Status {resp.status_code} / empty response — try refreshing cookies")
        return []

    html = resp.text

    # Find the __NEXT_DATA__ script tag — it contains all page data as JSON
    # This is a standard Next.js pattern: <script id="__NEXT_DATA__">{ ... }</script>
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.+?)</script>', html, re.DOTALL)
    if not match:
        print("  ✗ No __NEXT_DATA__ found — ASOS may have changed their page structure")
        return []

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as e:
        print(f"  ✗ Failed to parse __NEXT_DATA__: {e}")
        return []

    # Drill into the Next.js data structure to find product listings
    # The path may vary — ASOS sometimes restructures this
    page_props = data.get("props", {}).get("pageProps", {})

    # Try several possible locations for the product list
    products = (
        page_props.get("products") or
        page_props.get("items") or
        page_props.get("searchResults", {}).get("products") or
        []
    )

    if not products:
        # Fall back to searching the raw JSON for product-looking objects
        raw = match.group(1)
        # Look for objects with productId, name, and price fields
        product_blocks = re.findall(r'\{[^{}]*"productId"\s*:\s*\d+[^{}]*"name"\s*:\s*"[^"]+"[^{}]*\}', raw)
        print(f"  Found {len(product_blocks)} product blocks via regex fallback")
        for block in product_blocks[:limit]:
            try:
                products.append(json.loads(block))
            except Exception:
                pass

    print(f"  Found {len(products)} products")
    return products[:limit]


def parse_asos_product(raw, query, aesthetic, garment_type, gender):
    """
    Convert a raw ASOS product object into our cache listing format.

    ASOS product objects typically have:
        productId   — numeric ID
        name        — product title
        price       — dict with current/previous prices
        imageUrl    — product image URL
        url         — relative product URL
        brandName   — brand
    """
    # ASOS uses different field names depending on the endpoint/page
    title = raw.get("name") or raw.get("title") or raw.get("productName", "")
    if not title:
        return None

    product_id = raw.get("productId") or raw.get("id", "")

    # Price — ASOS stores this as a nested object
    price_obj = raw.get("price", {})
    if isinstance(price_obj, dict):
        # current.value is the sale price, original.value is the original
        current = price_obj.get("current", {})
        price = current.get("text") or f"${current.get('value', 'N/A')}"
    else:
        price = f"${price_obj}" if price_obj else "N/A"

    # Image URL — ASOS CDN
    image = raw.get("imageUrl") or raw.get("image", {}).get("url", "")
    if image and not image.startswith("http"):
        image = f"https:{image}"  # ASOS sometimes omits the protocol

    # Product URL
    product_url = raw.get("url") or raw.get("productUrl", "")
    if product_url and not product_url.startswith("http"):
        product_url = f"https://www.asos.com{product_url}"

    if not image or not product_url:
        return None

    return {
        "title": title,
        "price": price,
        "image": image,
        "url": product_url,
        "seller": "asos",
        "slug": str(product_id),
        "query": query,
        "_gender": gender,
        "_source": "asos",
    }


def upsert_to_db(conn, query_key, aesthetic, garment_type, gender, listings):
    """
    Insert listings into depop_cache, appending to any existing rows.
    Duplicates were already filtered out via existing_urls before we got here;
    the ON CONFLICT append remains as a safety net for truly new listings.
    """
    if not listings or DRY_RUN:
        if DRY_RUN:
            print(f"    [DRY RUN] Would insert {len(listings)} listings")
        return

    cur = conn.cursor()
    cur.execute("""
        INSERT INTO depop_cache (query, listings, aesthetic, garment_type, permanent, created_at)
        VALUES (%s, %s::jsonb, %s, %s, true, NOW())
        ON CONFLICT (query) DO UPDATE
        SET listings = depop_cache.listings || EXCLUDED.listings::jsonb,
            updated_at = NOW()
    """, (query_key, json.dumps(listings), aesthetic, garment_type))
    conn.commit()
    cur.close()
    print(f"    ✓ Inserted {len(listings)} listings")


def main():
    if not COOKIE:
        print("ERROR: Paste your ASOS cookie string into COOKIE = \"\" at the top")
        print("Get it: asos.com → DevTools (F12) → Network → any request → Headers → cookie:")
        return

    print("=" * 60)
    print("Stitch — ASOS Scraper")
    print("=" * 60)

    conn = psycopg2.connect(DB_URL, sslmode="require")
    print("✓ Connected to database\n")

    # Load every URL already in the cache ONCE up front so we can skip
    # listings we've already stored (prevents duplicate entries).
    existing_urls = load_existing_urls(conn)
    print(f"✓ Loaded {len(existing_urls)} existing URLs from cache\n")

    total_inserted = 0

    for search_term, aesthetic, garment_type, gender in SEARCH_QUERIES:
        print(f"\n── '{search_term}' → {aesthetic}/{garment_type}/{gender} ──")

        raw_products = search_asos(search_term, limit=ITEMS_PER_QUERY)

        listings = []
        for raw in raw_products:
            listing = parse_asos_product(raw, search_term, aesthetic, garment_type, gender)
            if listing:
                # Dedup check: skip any listing whose URL is already in the
                # cache (or already seen earlier in this run).
                if listing["url"] in existing_urls:
                    print(f"  ⟳ Already in cache, skipping: {listing['title']}")
                    continue
                existing_urls.add(listing["url"])  # add so we don't dupe within this run
                listings.append(listing)
                print(f"  ✓ {listing['title']} — {listing['price']}")

        cache_key = f"asos {search_term}"
        upsert_to_db(conn, cache_key, aesthetic, garment_type, gender, listings)
        total_inserted += len(listings)

        time.sleep(DELAY_SECS)

    conn.close()
    print(f"\n{'=' * 60}")
    print(f"Done! Inserted {total_inserted} products total")


if __name__ == "__main__":
    main()
