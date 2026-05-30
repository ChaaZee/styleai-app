"""
scrape_shopify.py — Fetch products from any Shopify-based brand and insert into Stitch cache
===========================================================================

HOW TO USE:
    1. pip install requests psycopg2-binary
    2. Edit SHOPIFY_STORES below to add/remove brands
    3. Run:  python scripts/python/scrape_shopify.py

HOW IT WORKS:
    Shopify stores expose a FREE public API at /products.json — no cookies,
    no authentication, no bot protection. Works from any machine including
    the server.

CURRENTLY CONFIGURED BRANDS:
    - Civil Regime (streetwear/graphic tees)
    - MNML (minimalist/slim menswear)
    - Union LA (premium streetwear)

ADD MORE BRANDS:
    Any Shopify store works. Just add its domain to SHOPIFY_STORES below.
    To check if a store is Shopify, visit: https://brand.com/products.json
    If you see JSON, it works!
===========================================================================
"""

import requests
import psycopg2
import psycopg2.extras
import json
import time


# ── DATABASE ──────────────────────────────────────────────────────────────────
# Your Supabase connection string — don't share this publicly
DB_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# ── SHOPIFY STORES TO SCRAPE ──────────────────────────────────────────────────
# Format: { "domain": "brand.com", "aesthetic": "Streetwear", "gender": "male"/"female"/"both" }
# aesthetic must match one of the 41 aesthetics in the app exactly
# gender: "male" = mens only, "female" = womens only, "both" = show to everyone
SHOPIFY_STORES = [
    {
        "domain": "www.civilregime.com",
        "aesthetic": "Streetwear",
        "gender": "both",        # Civil Regime sells mens + womens
        "limit": 50,             # how many products to fetch per brand
    },
    {
        "domain": "www.mnml.la",
        "aesthetic": "Minimalist",
        "gender": "male",        # MNML is primarily menswear
        "limit": 50,
    },
    {
        "domain": "www.unionlosangeles.com",
        "aesthetic": "Streetwear",
        "gender": "both",
        "limit": 30,
    },
]


# ── CONFIG ────────────────────────────────────────────────────────────────────
DELAY_BETWEEN_REQUESTS = 1.5    # seconds to wait between brand fetches (be polite)
DRY_RUN = False                  # set to True to test without writing to DB


# ── HEADERS ──────────────────────────────────────────────────────────────────
# Minimal headers — Shopify's products.json doesn't need cookies or special headers
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
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


def fetch_shopify_products(domain, limit=50):
    """
    Fetch products from a Shopify store's public /products.json endpoint.
    Returns a list of raw product dicts from Shopify's API.

    Shopify paginates at 250 products max per request.
    We loop through pages using the ?page= param until we have enough.
    """
    products = []
    page = 1

    while len(products) < limit:
        # Build the URL — Shopify's public products endpoint, no auth needed
        url = f"https://{domain}/products.json?limit=250&page={page}"

        print(f"  Fetching page {page}: {url}")
        resp = requests.get(url, headers=HEADERS, timeout=15)

        # If we get blocked or the store doesn't exist, stop
        if resp.status_code != 200:
            print(f"  ✗ Got status {resp.status_code} — stopping")
            break

        data = resp.json()
        batch = data.get("products", [])

        # If Shopify returns an empty page, we've hit the end
        if not batch:
            print(f"  No more products on page {page}")
            break

        products.extend(batch)
        print(f"  Got {len(batch)} products (total: {len(products)})")

        # If this page had fewer than 250, it's the last page
        if len(batch) < 250:
            break

        page += 1

    # Return only up to the limit we wanted
    return products[:limit]


def parse_product(raw, aesthetic, default_gender):
    """
    Convert a raw Shopify product dict into the format our depop_cache table expects.

    Shopify product fields we use:
        title       — product name
        handle      — URL slug (e.g. "full-zip-hoodie-black")
        variants[0].price — price in USD
        images[0].src    — first product image URL
        product_type     — category like "Hoodie", "Tee", "Pants"
        tags             — list of tag strings (we check for gender hints)
    """
    title = raw.get("title", "").strip()
    handle = raw.get("handle", "")
    product_type = raw.get("product_type", "").lower()
    tags = [t.lower() for t in raw.get("tags", [])]

    # Skip products with no title or no images
    if not title or not raw.get("images"):
        return None

    # Get the first variant's price (Shopify stores price as a string like "55.00")
    variants = raw.get("variants", [])
    price = f"${variants[0]['price']}" if variants and variants[0].get("price") else "N/A"

    # Skip free/sale items with $0 price (usually out of stock or misconfigured)
    if price == "$0.00":
        return None

    # Get the first product image URL
    image_url = raw["images"][0]["src"]

    # Build the product page URL from the handle
    domain = raw.get("_domain", "")  # we'll inject this before calling parse_product
    product_url = f"https://{domain}/products/{handle}"

    # ── Gender detection ──────────────────────────────────────────────────────
    # Check title and tags for explicit gender signals
    # We check tags like "mens", "womens", "unisex" that brands commonly use
    gender = default_gender  # start with the brand-level default

    title_lower = title.lower()
    all_text = title_lower + " " + " ".join(tags)

    # If there are explicit womens signals, override to female
    if any(w in all_text for w in ["women", "womens", "woman", "girls", "ladies", "female"]):
        gender = "female"
    # If there are explicit mens signals, override to male
    elif any(w in all_text for w in ["men", "mens", "man", "boys", "male"]):
        gender = "male"

    # ── Garment type detection ────────────────────────────────────────────────
    # Map Shopify product_type to our cache's garment_type values
    garment_map = {
        "hoodie": "tops",
        "sweatshirt": "tops",
        "tee": "tops",
        "t-shirt": "tops",
        "shirt": "tops",
        "jacket": "outerwear",
        "coat": "outerwear",
        "pants": "bottoms",
        "jeans": "bottoms",
        "shorts": "bottoms",
        "sweatpants": "bottoms",
        "sneaker": "shoes",
        "shoe": "shoes",
        "boot": "shoes",
        "hat": "accessories",
        "bag": "accessories",
        "accessory": "accessories",
    }

    garment_type = "tops"  # default
    for keyword, gtype in garment_map.items():
        if keyword in product_type or keyword in title_lower:
            garment_type = gtype
            break

    # ── Build the listing object ──────────────────────────────────────────────
    # This matches the shape of listings stored in the depop_cache table
    listing = {
        "title": title,
        "price": price,
        "image": image_url,
        "url": product_url,
        "seller": domain.replace("www.", ""),  # brand name as the "seller"
        "slug": handle,
        "query": f"{aesthetic.lower()} {garment_type}",
        "_gender": gender,
        "_source": "shopify",  # track where this came from
    }

    return {
        "query": f"{aesthetic} {garment_type} shopify",
        "aesthetic": aesthetic,
        "garment_type": garment_type,
        "gender": gender,
        "listing": listing,
    }


def upsert_to_db(conn, rows):
    """
    Insert product listings into the depop_cache table.

    We group listings by (query, aesthetic, garment_type) and upsert them
    as a batch into a single cache row using Postgres JSONB array append.

    The ON CONFLICT clause means: if this query already exists in the cache,
    append new listings to the existing ones instead of overwriting.
    """
    # Group listings by their cache key (query string)
    from collections import defaultdict
    groups = defaultdict(list)

    for row in rows:
        key = row["query"]
        groups[key].append(row)

    cur = conn.cursor()

    for query_key, items in groups.items():
        # All items in this group share the same aesthetic/garment_type/gender
        aesthetic = items[0]["aesthetic"]
        garment_type = items[0]["garment_type"]
        gender = items[0]["gender"]
        listings = [item["listing"] for item in items]

        print(f"  Upserting {len(listings)} listings for query: '{query_key}'")

        if DRY_RUN:
            print(f"  [DRY RUN] Would upsert: {listings[0]['title']}...")
            continue

        # Upsert: insert the row, or if it exists append new listings to the JSONB array.
        # The || operator in Postgres merges two JSONB arrays.
        # Duplicates were already filtered out via existing_urls before we got here;
        # the ON CONFLICT append remains as a safety net for truly new listings.
        cur.execute("""
            INSERT INTO depop_cache (query, listings, aesthetic, garment_type, permanent, created_at)
            VALUES (%s, %s::jsonb, %s, %s, true, NOW())
            ON CONFLICT (query) DO UPDATE
            SET listings = depop_cache.listings || EXCLUDED.listings::jsonb,
                updated_at = NOW()
        """, (
            query_key,
            json.dumps(listings),   # list of listing objects as JSON
            aesthetic,
            garment_type,
        ))

    conn.commit()
    cur.close()


def main():
    print("=" * 60)
    print("Stitch — Shopify Brand Scraper")
    print("=" * 60)

    # Connect to Supabase Postgres
    # ssl options: rejectUnauthorized=False because Render/this env doesn't have the cert chain
    conn = psycopg2.connect(DB_URL, sslmode="require")
    print("✓ Connected to database\n")

    # Load every URL already in the cache ONCE up front so we can skip
    # listings we've already stored (prevents duplicate entries).
    existing_urls = load_existing_urls(conn)
    print(f"✓ Loaded {len(existing_urls)} existing URLs from cache\n")

    total_inserted = 0

    for store in SHOPIFY_STORES:
        domain = store["domain"]
        aesthetic = store["aesthetic"]
        gender = store["gender"]
        limit = store.get("limit", 50)

        print(f"\n── {domain} ──")
        print(f"   Aesthetic: {aesthetic} | Gender: {gender} | Limit: {limit}")

        # Fetch raw Shopify products
        raw_products = fetch_shopify_products(domain, limit=limit)
        print(f"  Fetched {len(raw_products)} raw products")

        # Inject domain so parse_product can build the URL
        for p in raw_products:
            p["_domain"] = domain

        # Parse each product into our cache format
        parsed = []
        for raw in raw_products:
            result = parse_product(raw, aesthetic, gender)
            if result:
                # Dedup check: skip any listing whose URL is already in the
                # cache (or already seen earlier in this run).
                listing = result["listing"]
                if listing["url"] in existing_urls:
                    print(f"    ⟳ Already in cache, skipping: {listing['title']}")
                    continue
                existing_urls.add(listing["url"])  # add so we don't dupe within this run
                parsed.append(result)

        print(f"  Parsed {len(parsed)} valid products")

        # Insert into DB
        if parsed:
            upsert_to_db(conn, parsed)
            total_inserted += len(parsed)
            print(f"  ✓ Inserted {len(parsed)} products")

        # Wait between brands to be respectful
        time.sleep(DELAY_BETWEEN_REQUESTS)

    conn.close()
    print(f"\n{'=' * 60}")
    print(f"Done! Inserted {total_inserted} products total")
    if DRY_RUN:
        print("(DRY RUN — nothing was actually written to DB)")


if __name__ == "__main__":
    main()
