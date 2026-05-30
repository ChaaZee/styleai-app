"""
scrape_asos.py — Fetch products from ASOS by category and insert into Stitch cache
===========================================================================

HOW TO USE:
    1. pip install requests psycopg2-binary
    2. Get fresh cookies from your browser:
         - Go to asos.com in Chrome and browse around for a minute
         - Press F12 → Network tab → Fetch/XHR
         - Click any asos.com request → Headers → copy the full "cookie:" value
         - Paste it below as COOKIE
    3. Edit CATEGORIES below to control what to fetch
    4. Run:  python scripts/python/scrape_asos.py

HOW TO FIND CATEGORY IDs:
    1. Go to asos.com and click into any clothing category
       (e.g. Men → Hoodies & Sweatshirts)
    2. Look at the URL — the number after "cid=" IS the category ID
       Example: https://www.asos.com/us/men/hoodies-sweatshirts/cat/?cid=4172
                                                                        ^^^^
                                                                        ID = 4172
    3. Add that ID + its aesthetic/garment_type/gender to CATEGORIES below

HOW IT WORKS:
    Instead of searching by keyword, we fetch entire ASOS categories using
    their category page URL with pagination. Each page returns up to 72 items.
    We loop through pages until we hit MAX_ITEMS_PER_CATEGORY.

    Must be run locally (your home IP + cookies) — NOT from the Render server.

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
# Get from: asos.com → DevTools (F12) → Network → any request → Headers → cookie:
COOKIE = ""  # <-- paste here


# ── DATABASE ──────────────────────────────────────────────────────────────────
DB_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# ── CATEGORIES TO FETCH ───────────────────────────────────────────────────────
# Format: (category_id, label, aesthetic, garment_type, gender)
#
# HOW TO FIND IDs: browse asos.com → click a category → copy the cid= number from the URL
# Example URL: https://www.asos.com/us/men/hoodies-sweatshirts/cat/?cid=4172
#
# aesthetic must match one of the 41 aesthetics in the Stitch app exactly
# garment_type: "tops", "bottoms", "outerwear", "shoes", "accessories"
# gender: "male", "female", "both"
CATEGORIES = [
    # ── MENS ──────────────────────────────────────────────────────────────────
    (4172,  "mens hoodies sweatshirts", "Streetwear",  "tops",        "male"),
    (4169,  "mens t-shirts",            "Streetwear",  "tops",        "male"),
    (4329,  "mens jackets coats",       "Streetwear",  "outerwear",   "male"),
    (4347,  "mens trousers",            "Streetwear",  "bottoms",     "male"),
    (4208,  "mens jeans",               "Streetwear",  "bottoms",     "male"),
    (4207,  "mens shirts",              "Minimalist",  "tops",        "male"),
    (4365,  "mens knitwear",            "Minimalist",  "tops",        "male"),
    (4206,  "mens shorts",              "Streetwear",  "bottoms",     "male"),
    (4205,  "mens tracksuits",          "Sporty",      "tops",        "male"),
    (4922,  "mens sneakers",            "Streetwear",  "shoes",       "male"),

    # ── WOMENS ────────────────────────────────────────────────────────────────
    (4174,  "womens tops",              "Coquette",    "tops",        "female"),
    (8799,  "womens dresses",           "Coquette",    "tops",        "female"),
    (4169,  "womens t-shirts",          "Y2K",         "tops",        "female"),
    (4172,  "womens hoodies",           "Soft Girl",   "tops",        "female"),
    (4176,  "womens jeans",             "Y2K",         "bottoms",     "female"),
    (4177,  "womens trousers",          "Minimalist",  "bottoms",     "female"),
    (4175,  "womens skirts",            "Coquette",    "bottoms",     "female"),
    (4330,  "womens jackets coats",     "Streetwear",  "outerwear",   "female"),
    (4921,  "womens sneakers",          "Sporty",      "shoes",       "female"),
]


# ── CONFIG ────────────────────────────────────────────────────────────────────
MAX_ITEMS_PER_CATEGORY = 72     # max products to fetch per category (72 = 1 page)
                                # increase to 144, 216, etc. for more (multiples of 72)
PAGE_SIZE = 72                  # ASOS max per page is 72
DELAY_SECS = 2.5                # wait between requests (be polite)
DRY_RUN = False                 # set True to test without writing to DB


def make_headers(referer="https://www.asos.com/"):
    """Headers that mimic a real Chrome browser visiting ASOS."""
    return {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cookie": COOKIE,
        "referer": referer,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    }


def load_existing_urls(conn):
    """
    Load all product URLs already in the cache into a Python set.
    Used for O(1) dedup checking — if a URL is in this set, skip it.
    """
    cur = conn.cursor()
    # Guard against rows where listings is not a JSON array
    cur.execute("""
        SELECT listing->>'url'
        FROM depop_cache,
        jsonb_array_elements(listings) AS listing
        WHERE jsonb_typeof(listings) = 'array'
          AND listing->>'url' IS NOT NULL
    """)
    rows = cur.fetchall()
    cur.close()
    return set(row[0] for row in rows)


def fetch_category_page(category_id, offset, label):
    """
    Fetch one page of products from an ASOS category.

    ASOS category pages use this URL format:
        https://www.asos.com/us/men/hoodies-sweatshirts/cat/?cid=4172&offset=0&currentpage=1

    The page HTML contains a __NEXT_DATA__ JSON blob with all product data.
    We parse that JSON to get clean product objects without messy HTML parsing.

    Returns a list of raw product dicts (or empty list on failure).
    """
    # Build the category URL — offset controls which page we're on
    # ASOS uses offset (not page number): page 1 = offset 0, page 2 = offset 72, etc.
    url = f"https://www.asos.com/us/cat/?cid={category_id}&offset={offset}&currentpage={offset // PAGE_SIZE + 1}"

    referer = f"https://www.asos.com/us/cat/?cid={category_id}"
    resp = requests.get(url, headers=make_headers(referer), timeout=20)

    if resp.status_code != 200 or len(resp.text) < 500:
        print(f"    ✗ Status {resp.status_code} / empty — cookies may be expired")
        return []

    html = resp.text

    # ASOS uses Next.js — all initial page data is in this script tag as JSON
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.+?)</script>', html, re.DOTALL)
    if not match:
        print(f"    ✗ No __NEXT_DATA__ found on page")
        return []

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        print(f"    ✗ Failed to parse __NEXT_DATA__")
        return []

    # Drill into Next.js page props to find the product list
    page_props = data.get("props", {}).get("pageProps", {})

    # ASOS stores products under different keys depending on the page type
    products = (
        page_props.get("products") or
        page_props.get("items") or
        page_props.get("categoryProducts", {}).get("products") or
        page_props.get("searchResults", {}).get("products") or
        []
    )

    # If the structured path didn't work, try regex on the raw JSON
    if not products:
        raw_json = match.group(1)
        # Look for arrays of product objects with productId fields
        array_match = re.search(r'"products"\s*:\s*(\[\{.+?\}\])', raw_json, re.DOTALL)
        if array_match:
            try:
                products = json.loads(array_match.group(1))
            except Exception:
                pass

    return products


def parse_asos_product(raw, label, aesthetic, garment_type, gender):
    """
    Convert a raw ASOS product object into our cache listing format.

    ASOS product fields we use:
        productId / id  — numeric product ID
        name            — product title
        price           — nested dict: { current: { text: "$35.00", value: 35 } }
        imageUrl        — CDN image URL (sometimes without https:)
        url             — relative product URL like /asos-design/hoodie/prd/123
        brandName       — brand name (ASOS Design, Nike, etc.)
    """
    title = raw.get("name") or raw.get("title") or raw.get("productName", "")
    if not title:
        return None

    product_id = raw.get("productId") or raw.get("id", "")

    # Price is a nested object in ASOS — dig into current.text for the formatted string
    price_obj = raw.get("price", {})
    if isinstance(price_obj, dict):
        current = price_obj.get("current", {})
        price = current.get("text") or f"${current.get('value', 'N/A')}"
    elif price_obj:
        price = f"${price_obj}"
    else:
        price = "N/A"

    # Image URL — ASOS CDN sometimes omits the https: protocol
    image = raw.get("imageUrl") or raw.get("image", {}).get("url", "")
    if image and not image.startswith("http"):
        image = f"https:{image}"

    # Product URL — ASOS gives relative URLs like /asos-design/prd/123
    product_url = raw.get("url") or raw.get("productUrl", "")
    if product_url and not product_url.startswith("http"):
        product_url = f"https://www.asos.com{product_url}"

    # Skip products with no image or URL — can't show them as cards
    if not image or not product_url:
        return None

    return {
        "title": title,
        "price": price,
        "image": image,
        "url": product_url,
        "seller": "asos",
        "slug": str(product_id),
        "query": label,
        "_gender": gender,
        "_source": "asos",
    }


def upsert_to_db(conn, query_key, aesthetic, garment_type, gender, listings):
    """Insert listings into depop_cache, appending to existing rows."""
    if not listings or DRY_RUN:
        if DRY_RUN:
            print(f"    [DRY RUN] Would insert {len(listings)} listings")
        return

    cur = conn.cursor()
    cur.execute("""
        INSERT INTO depop_cache (query, listings, aesthetic, garment_type, permanent, created_at)
        VALUES (%s, %s::jsonb, %s, %s, true, NOW())
        ON CONFLICT (query) DO UPDATE
        SET listings = depop_cache.listings || EXCLUDED.listings::jsonb
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
    print("Stitch — ASOS Category Scraper")
    print("=" * 60)

    conn = psycopg2.connect(DB_URL, sslmode="require")
    print("✓ Connected to database\n")

    # Load all cached URLs once upfront for fast dedup checking
    existing_urls = load_existing_urls(conn)
    print(f"✓ Loaded {len(existing_urls)} existing URLs from cache\n")

    total_inserted = 0

    for category_id, label, aesthetic, garment_type, gender in CATEGORIES:
        print(f"\n── Category {category_id}: '{label}' → {aesthetic}/{garment_type}/{gender} ──")

        all_listings = []
        offset = 0

        # Paginate through the category until we hit our limit
        while offset < MAX_ITEMS_PER_CATEGORY:
            print(f"  Fetching offset {offset}...")
            raw_products = fetch_category_page(category_id, offset, label)

            if not raw_products:
                print(f"  No products returned — stopping pagination")
                break

            print(f"  Got {len(raw_products)} products from page")

            for raw in raw_products:
                listing = parse_asos_product(raw, label, aesthetic, garment_type, gender)
                if not listing:
                    continue

                # Skip if URL already in cache or seen earlier this run
                if listing["url"] in existing_urls:
                    print(f"    ⟳ Already cached: {listing['title'][:50]}")
                    continue

                existing_urls.add(listing["url"])
                all_listings.append(listing)
                print(f"    ✓ {listing['title'][:60]} — {listing['price']}")

            # If ASOS returned fewer items than PAGE_SIZE, we've hit the last page
            if len(raw_products) < PAGE_SIZE:
                break

            offset += PAGE_SIZE
            time.sleep(DELAY_SECS)

        # Insert all listings for this category into DB
        cache_key = f"asos {label}"
        upsert_to_db(conn, cache_key, aesthetic, garment_type, gender, all_listings)
        total_inserted += len(all_listings)

        time.sleep(DELAY_SECS)

    conn.close()
    print(f"\n{'=' * 60}")
    print(f"Done! Inserted {total_inserted} products total")


if __name__ == "__main__":
    main()
