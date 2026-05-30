"""
scrape_grailed.py — Fetch listings from Grailed and insert into Stitch cache
===========================================================================

HOW TO USE:
    1. pip install requests psycopg2-binary
    2. Get fresh cookies from your browser:
         - Go to grailed.com in Chrome and browse some listings
         - Press F12 → Network tab → Fetch/XHR
         - Click any grailed.com request → Headers → copy the "cookie:" value
         - Paste it below as COOKIE
    3. Run:  python scripts/python/scrape_grailed.py

HOW IT WORKS:
    Grailed uses Algolia for search under the hood, but their Algolia API key
    is server-side and not exposed publicly. Instead, we hit their internal
    /api/listings endpoint which powers the search page — it returns clean JSON.

    This must be run locally (your home IP + cookies), NOT from Render.

GRAILED vs DEPOP:
    - Grailed = higher-end/designer secondhand menswear (Supreme, Rick Owens, etc.)
    - Good for Luxury, Avant-Garde, Streetwear aesthetics
    - Listings are real secondhand items with real prices

IMPORTANT:
    Don't commit your cookie string to GitHub!
===========================================================================
"""

import requests
import psycopg2
import json
import time


# ── PASTE YOUR COOKIE STRING HERE ─────────────────────────────────────────────
# Get from: grailed.com → DevTools (F12) → Network → any request → Headers → cookie:
COOKIE = ""  # <-- paste here


# ── DATABASE ──────────────────────────────────────────────────────────────────
DB_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# ── SEARCH QUERIES ────────────────────────────────────────────────────────────
# (search_term, aesthetic, garment_type, gender)
# Grailed skews heavily towards menswear and designer/streetwear
SEARCH_QUERIES = [
    ("vintage hoodie",        "Vintage",     "tops",      "male"),
    ("streetwear jacket",     "Streetwear",  "outerwear", "male"),
    ("designer trousers",     "Avant-Garde", "bottoms",   "male"),
    ("vintage tee",           "Vintage",     "tops",      "male"),
    ("cargo pants",           "Streetwear",  "bottoms",   "male"),
    ("leather jacket",        "Grunge",      "outerwear", "male"),
    ("vintage denim jacket",  "Vintage",     "outerwear", "both"),
    ("workwear jacket",       "Workwear",    "outerwear", "male"),
]


# ── CONFIG ────────────────────────────────────────────────────────────────────
ITEMS_PER_QUERY = 12
DELAY_SECS = 2.0
DRY_RUN = False


def make_headers(referer="https://www.grailed.com/"):
    """Headers that mimic a real Chrome browser visiting Grailed."""
    return {
        "accept": "application/json",
        "accept-language": "en-US,en;q=0.9",
        "cookie": COOKIE,
        "referer": referer,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        "x-requested-with": "XMLHttpRequest",  # tells Grailed this is an AJAX request
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


def search_grailed(query, limit=12):
    """
    Search Grailed listings using their internal API endpoint.

    Grailed's search page at /search?query=hoodie internally calls
    their API to populate listings. We call that same API directly.

    The API returns a list of listing objects with title, price, photos, etc.

    Returns a list of raw listing dicts.
    """
    # Grailed's internal search API — same one their frontend calls
    # query = search term, page = page number (0-indexed), per = results per page
    url = "https://www.grailed.com/api/listings/search"

    payload = {
        "query": query,      # the search term
        "page": 0,           # first page (0-indexed)
        "per": limit,        # number of results to return
        "sort": "relevant",  # sort by relevance (vs "popular", "price_asc", etc.)
    }

    print(f"  Searching Grailed: '{query}'")
    resp = requests.post(
        url,
        headers=make_headers(),
        json=payload,         # send as JSON body (not form data)
        timeout=15,
    )

    if resp.status_code == 401:
        print("  ✗ 401 Unauthorized — paste fresh cookies from DevTools")
        return []
    if resp.status_code != 200:
        print(f"  ✗ Status {resp.status_code}")
        return []

    try:
        data = resp.json()
    except Exception as e:
        print(f"  ✗ Response is not JSON: {e}")
        return []

    # Handle both possible response shapes
    listings = data.get("listings") or data.get("data") or data.get("objects") or []

    # If we got an error object instead
    if isinstance(data, dict) and "error" in data:
        print(f"  ✗ API error: {data['error']}")
        return []

    print(f"  Found {len(listings)} listings")
    return listings[:limit]


def parse_grailed_listing(raw, query, aesthetic, garment_type, gender):
    """
    Convert a raw Grailed listing object into our cache listing format.

    Grailed listing fields:
        id              — numeric listing ID
        title           — listing title (e.g. "Supreme Box Logo Hoodie FW19")
        price           — sale price in cents (e.g. 25000 = $250.00)
        original_price  — original price in cents
        cover_photo     — dict with image URLs
        seller          — dict with username
        category        — e.g. "tops.hoodies_sweatshirts"
    """
    title = raw.get("title", "").strip()
    if not title:
        return None

    listing_id = raw.get("id", "")

    # Price is in cents — divide by 100 to get dollars
    # Some listings store it as a float directly
    raw_price = raw.get("price") or raw.get("sale_price") or 0
    if raw_price > 1000:
        # Likely in cents
        price = f"${raw_price / 100:.0f}"
    else:
        price = f"${raw_price}"

    # Cover photo — Grailed uses a nested structure
    cover = raw.get("cover_photo", {})
    if isinstance(cover, dict):
        # Try to get a medium-sized image URL
        image = (
            cover.get("url") or
            cover.get("image", {}).get("url") or
            cover.get("medium") or
            ""
        )
    elif isinstance(cover, str):
        image = cover
    else:
        image = ""

    if not image:
        return None

    # Product page URL — Grailed listing URLs use the format /listings/ID-title
    slug = raw.get("slug") or str(listing_id)
    product_url = f"https://www.grailed.com/listings/{slug}"

    # Seller username
    seller_obj = raw.get("seller") or raw.get("user") or {}
    seller = seller_obj.get("username") or "grailed" if isinstance(seller_obj, dict) else "grailed"

    return {
        "title": title,
        "price": price,
        "image": image,
        "url": product_url,
        "seller": seller,
        "slug": slug,
        "query": query,
        "_gender": gender,
        "_source": "grailed",
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
        print("ERROR: Paste your Grailed cookie string into COOKIE = \"\" at the top")
        print("Get it: grailed.com → DevTools (F12) → Network → any request → Headers → cookie:")
        return

    print("=" * 60)
    print("Stitch — Grailed Scraper")
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

        raw_listings = search_grailed(search_term, limit=ITEMS_PER_QUERY)

        listings = []
        for raw in raw_listings:
            listing = parse_grailed_listing(raw, search_term, aesthetic, garment_type, gender)
            if listing:
                # Dedup check: skip any listing whose URL is already in the
                # cache (or already seen earlier in this run).
                if listing["url"] in existing_urls:
                    print(f"  ⟳ Already in cache, skipping: {listing['title']}")
                    continue
                existing_urls.add(listing["url"])  # add so we don't dupe within this run
                listings.append(listing)
                print(f"  ✓ {listing['title']} — {listing['price']}")

        cache_key = f"grailed {search_term}"
        upsert_to_db(conn, cache_key, aesthetic, garment_type, gender, listings)
        total_inserted += len(listings)

        time.sleep(DELAY_SECS)

    conn.close()
    print(f"\n{'=' * 60}")
    print(f"Done! Inserted {total_inserted} products total")


if __name__ == "__main__":
    main()
