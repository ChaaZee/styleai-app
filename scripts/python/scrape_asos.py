"""
scrape_asos.py — Fetch products from ASOS by category and insert into Stitch cache
===========================================================================

HOW TO USE:
    1. pip install requests psycopg2-binary
    2. Edit CATEGORIES below to control what to fetch (or add new ones)
    3. Run:  python scripts/python/scrape_asos.py

    NO COOKIES NEEDED — this script uses ASOS's internal JSON API directly,
    which is publicly accessible and returns clean structured data.

HOW TO FIND CATEGORY IDs:
    IMPORTANT: The API uses different IDs from the cid= values in page URLs!
    1. Go to asos.com/us/men/ or /us/women/ and click a category in the nav
    2. Open DevTools (F12) -> Network tab -> filter Fetch/XHR
    3. Look for a request to /api/product/search/v2/categories/XXXXXX
    4. That XXXXXX is the correct API category ID to add to CATEGORIES below

    Do NOT use the cid= number from the page URL — those are different IDs
    and many are now stale/reassigned on the ASOS US site.

HOW IT WORKS:
    Instead of loading web pages, we call ASOS's product search API directly:
        https://www.asos.com/api/product/search/v2/categories/{category_id}

    This returns clean JSON with up to 72 products per page. We paginate
    through pages until we hit MAX_ITEMS_PER_CATEGORY.

    Can be run from anywhere — no IP restrictions, no cookies needed.
===========================================================================
"""

import requests
import psycopg2
import json
import time


# ── DATABASE ──────────────────────────────────────────────────────────────────
DB_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# ── CATEGORIES TO FETCH ───────────────────────────────────────────────────────
# Format: (category_id, label, aesthetic, garment_type, gender)
#
# HOW TO FIND IDs:
#   IMPORTANT: The API uses different IDs from the cid= in page URLs.
#   To find the correct API ID for a category:
#     1. Go to asos.com/us/men/ or /us/women/ and click a category in the nav
#     2. Open DevTools (F12) -> Network tab -> filter Fetch/XHR
#     3. Look for a request to /api/product/search/v2/categories/XXXXXX
#     4. That XXXXXX number is the API category ID to use here
#
# aesthetic must match one of the 41 aesthetics in the Stitch app exactly
# garment_type: "tops", "bottoms", "outerwear", "shoes", "accessories"
# gender: "male", "female", "both"
CATEGORIES = [
    # ── MENS ──────────────────────────────────────────────────────────────────
    # IDs confirmed May 2026 via DevTools network capture on asos.com/us/men/
    (5668,  "mens hoodies sweatshirts", "Streetwear",  "tops",        "male"),
    (7616,  "mens t-shirts",            "Streetwear",  "tops",        "male"),
    (3606,  "mens jackets coats",       "Streetwear",  "outerwear",   "male"),
    (4208,  "mens jeans",               "Streetwear",  "bottoms",     "male"),
    (3602,  "mens shirts",              "Minimalist",  "tops",        "male"),
    (7617,  "mens knitwear",            "Minimalist",  "tops",        "male"),
    (7078,  "mens shorts",              "Streetwear",  "bottoms",     "male"),
    (26776, "mens tracksuits",          "Sporty",      "tops",        "male"),
    (5775,  "mens sneakers",            "Streetwear",  "shoes",       "male"),

    # ── WOMENS ────────────────────────────────────────────────────────────────
    # IDs confirmed May 2026 via DevTools network capture on asos.com/us/women/
    (4174,  "womens tops",              "Coquette",    "tops",        "female"),
    (8799,  "womens dresses",           "Coquette",    "tops",        "female"),
    (4176,  "womens jeans",             "Y2K",         "bottoms",     "female"),
    (4177,  "womens trousers",          "Minimalist",  "bottoms",     "female"),
    (4175,  "womens skirts",            "Coquette",    "bottoms",     "female"),
    (4330,  "womens jackets coats",     "Streetwear",  "outerwear",   "female"),
    (4209,  "womens shoes",             "Sporty",      "shoes",       "female"),
]


# ── CONFIG ────────────────────────────────────────────────────────────────────
MAX_ITEMS_PER_CATEGORY = 72     # max products to fetch per category (72 = 1 page)
                                # increase to 144, 216, etc. for more (multiples of 72)
PAGE_SIZE = 72                  # ASOS max per page is 72
DELAY_SECS = 1.5                # wait between requests
DRY_RUN = False                 # set True to test without writing to DB

# ASOS API store parameters — do not change these
STORE_PARAMS = {
    "store": "US",
    "lang": "en-US",
    "currency": "USD",
    "sizeSchema": "US",
    "keyStoreDataversion": "7qyyrb1-46",
}

# Headers that mimic a real Chrome browser
API_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "origin": "https://www.asos.com",
    "referer": "https://www.asos.com/",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/148.0.0.0 Safari/537.36"
    ),
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


def fetch_category_page(category_id, offset):
    """
    Fetch one page of products from the ASOS product search API.

    API endpoint:
        GET https://www.asos.com/api/product/search/v2/categories/{category_id}
            ?offset=0&limit=72&store=US&lang=en-US&currency=USD&sizeSchema=US

    No authentication or cookies required — this is a public JSON API.

    Returns a tuple of (products list, total item count) or ([], 0) on failure.
    """
    url = f"https://www.asos.com/api/product/search/v2/categories/{category_id}"
    params = {
        **STORE_PARAMS,
        "offset": offset,
        "limit": PAGE_SIZE,
    }

    try:
        resp = requests.get(url, headers=API_HEADERS, params=params, timeout=20)
    except requests.RequestException as e:
        print(f"    ✗ Request failed: {e}")
        return [], 0

    if resp.status_code != 200:
        print(f"    ✗ HTTP {resp.status_code} — skipping")
        return [], 0

    try:
        data = resp.json()
    except ValueError:
        print(f"    ✗ Invalid JSON response")
        return [], 0

    products = data.get("products", [])
    total = data.get("itemCount", 0)
    return products, total


def parse_asos_product(raw, label, aesthetic, garment_type, gender):
    """
    Convert a raw ASOS API product object into our cache listing format.

    ASOS API product fields we use:
        id           — numeric product ID (used to build the product URL)
        name         — product title
        price        — nested dict: { current: { text: "$35.00", value: 35 } }
        imageUrl     — CDN image hostname (without https:)
        url          — relative URL slug like "asos-design/hoodie/prd/123#colourWayId-456"
        brandName    — brand name
    """
    title = raw.get("name") or raw.get("title") or raw.get("productName", "")
    if not title:
        return None

    product_id = raw.get("id") or raw.get("productId", "")

    # Price is a nested object — dig into current.text for the formatted string
    price_obj = raw.get("price", {})
    if isinstance(price_obj, dict):
        current = price_obj.get("current", {})
        price = current.get("text") or f"${current.get('value', 'N/A')}"
    elif price_obj:
        price = f"${price_obj}"
    else:
        price = "N/A"

    # Image URL — ASOS API returns hostname without protocol, and without image extension
    # Full URL format: https://images.asos-media.com/products/{slug}/{id}-1-{color}?$n_480w$
    image_slug = raw.get("imageUrl", "")
    if image_slug:
        # Add protocol if missing
        if not image_slug.startswith("http"):
            image_slug = f"https://{image_slug}"
        # Add size parameter for a reasonable resolution
        image = f"{image_slug}?$n_480w$"
    else:
        return None  # skip products with no image

    # Product URL — API returns a relative slug, build the full URL
    url_slug = raw.get("url", "")
    if url_slug:
        if not url_slug.startswith("http"):
            product_url = f"https://www.asos.com/us/{url_slug}"
        else:
            product_url = url_slug
    elif product_id:
        product_url = f"https://www.asos.com/us/prd/{product_id}"
    else:
        return None  # skip products with no URL

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
    """Insert listings into depop_cache, appending to any existing rows for this query."""
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
    print("=" * 60)
    print("Stitch — ASOS Category Scraper (API mode, no cookies)")
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
            raw_products, total_count = fetch_category_page(category_id, offset)

            if not raw_products:
                print(f"  No products returned — stopping pagination")
                break

            if offset == 0:
                print(f"  Category has {total_count} total products on ASOS")

            print(f"  Got {len(raw_products)} products from API")

            for raw in raw_products:
                listing = parse_asos_product(raw, label, aesthetic, garment_type, gender)
                if not listing:
                    continue

                # Skip if URL already in cache or seen earlier this run
                if listing["url"] in existing_urls:
                    continue  # silent skip to keep output clean

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
