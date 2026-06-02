"""
seed.py — Add fresh Depop listings to the Stitch cache database.

HOW IT WORKS:
  1. Loops through a list of search queries (defined in SEED_QUERIES below)
  2. For each query, hits the Depop search API using your browser cookies
  3. Saves the results into the depop_cache table in Supabase
  4. Skips queries that are already cached (safe to re-run anytime)

HOW TO GET YOUR COOKIE:
  1. Open depop.com in Chrome and search for anything (e.g. "vintage jacket")
  2. Open DevTools (F12) → Network tab
  3. Find a GET request to www.depop.com/api/v3/search/products/
  4. Right-click it → Copy → Copy as cURL (cmd)
  5. Find the -b "..." part — that entire string is your cookie
  6. Set it as the DEPOP_COOKIE env var (PowerShell: $env:DEPOP_COOKIE = "...")

USAGE (PowerShell):
  pip install requests psycopg2-binary
  python scripts/python/seed.py

ADD NEW QUERIES:
  Edit the SEED_QUERIES list below. Each entry needs:
  - query: what to search on Depop
  - aesthetic: which style category it belongs to
  - garment_type: type of clothing (tops, bottoms, outerwear, shoes, accessories)
"""

import os
import requests
import psycopg2
import psycopg2.extras
import json
import time
import re

# ── COOKIE ────────────────────────────────────────────────────────────────────
# Read the Depop cookie from the DEPOP_COOKIE env var (never hardcode it).
# Get it from DevTools → Network → copy as cURL → find the -b "..." value.
# The cf_clearance cookie expires after ~1 hour, so grab a fresh one if you get 403s.
# PowerShell:  $env:DEPOP_COOKIE = Get-Content "cookie.txt" -Raw
DEPOP_COOKIE = os.environ.get("DEPOP_COOKIE", "")
if not DEPOP_COOKIE:
    print("[warn] DEPOP_COOKIE env var not set — Depop API calls may fail")

# ── CONFIG ────────────────────────────────────────────────────────────────────
DEVICE_ID   = "199707a3-3c09-408b-ab30-6d036c7d6b64"  # your Depop device ID
SESSION_ID  = "dbc61275-5cbd-46ce-8258-e19e984803b0"   # your Depop session ID
ITEMS_PER_QUERY = 12    # how many listings to fetch per query
DELAY_SECS  = 2.5       # wait between requests (be polite to Depop)

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres",
)

# ── QUERIES TO SEED ───────────────────────────────────────────────────────────
# Add or remove entries here to control what gets seeded.
# Format: {"query": "...", "aesthetic": "...", "garment_type": "..."}
SEED_QUERIES = [
    # Streetwear — mens
    {"query": "mens streetwear cargo pants",    "aesthetic": "Streetwear",     "garment_type": "bottoms"},
    {"query": "mens oversized graphic hoodie",  "aesthetic": "Streetwear",     "garment_type": "tops"},
    {"query": "mens baggy jeans streetwear",    "aesthetic": "Streetwear",     "garment_type": "bottoms"},
    {"query": "mens jordan sneakers",           "aesthetic": "Streetwear",     "garment_type": "shoes"},
    {"query": "mens bomber jacket streetwear",  "aesthetic": "Streetwear",     "garment_type": "outerwear"},
    {"query": "mens graphic tee streetwear",    "aesthetic": "Streetwear",     "garment_type": "tops"},
    {"query": "mens balaclava streetwear",      "aesthetic": "Streetwear",     "garment_type": "accessories"},

    # Minimalist — mens
    {"query": "mens minimalist linen shirt",    "aesthetic": "Minimalist",     "garment_type": "tops"},
    {"query": "mens slim fit chinos",           "aesthetic": "Minimalist",     "garment_type": "bottoms"},
    {"query": "mens white leather sneakers",    "aesthetic": "Minimalist",     "garment_type": "shoes"},
    {"query": "mens neutral toned coat",        "aesthetic": "Minimalist",     "garment_type": "outerwear"},
    {"query": "mens minimalist crew neck",      "aesthetic": "Minimalist",     "garment_type": "tops"},

    # Vintage
    {"query": "mens vintage polo shirt",        "aesthetic": "Vintage",        "garment_type": "tops"},
    {"query": "mens vintage corduroy pants",    "aesthetic": "Vintage",        "garment_type": "bottoms"},
    {"query": "mens vintage windbreaker",       "aesthetic": "Vintage",        "garment_type": "outerwear"},
    {"query": "mens vintage leather belt",      "aesthetic": "Vintage",        "garment_type": "accessories"},

    # Old Money
    {"query": "mens vintage blazer",            "aesthetic": "Old Money",      "garment_type": "outerwear"},
    {"query": "mens preppy sweater vest",       "aesthetic": "Old Money",      "garment_type": "tops"},
    {"query": "mens oxford shirt",              "aesthetic": "Old Money",      "garment_type": "tops"},
    {"query": "mens loafers brown leather",     "aesthetic": "Old Money",      "garment_type": "shoes"},

    # Y2K
    {"query": "mens y2k windbreaker",           "aesthetic": "Y2K",            "garment_type": "outerwear"},
    {"query": "mens y2k baggy jeans",           "aesthetic": "Y2K",            "garment_type": "bottoms"},
    {"query": "mens y2k jersey",                "aesthetic": "Y2K",            "garment_type": "tops"},

    # Dark Academia
    {"query": "mens dark academia trench coat", "aesthetic": "Dark Academia",  "garment_type": "outerwear"},
    {"query": "mens dark academia turtleneck",  "aesthetic": "Dark Academia",  "garment_type": "tops"},
    {"query": "mens wool trousers",             "aesthetic": "Dark Academia",  "garment_type": "bottoms"},

    # Techwear
    {"query": "mens techwear jacket",           "aesthetic": "Techwear",       "garment_type": "outerwear"},
    {"query": "mens techwear cargo pants",      "aesthetic": "Techwear",       "garment_type": "bottoms"},
    {"query": "mens techwear vest",             "aesthetic": "Techwear",       "garment_type": "tops"},

    # Grunge / Skater
    {"query": "mens grunge flannel shirt",      "aesthetic": "Grunge",         "garment_type": "tops"},
    {"query": "mens skater jeans",              "aesthetic": "Skater",         "garment_type": "bottoms"},
    {"query": "mens vans skate shoes",          "aesthetic": "Skater",         "garment_type": "shoes"},
    {"query": "mens band tee vintage",          "aesthetic": "Grunge",         "garment_type": "tops"},

    # Boho
    {"query": "mens boho linen pants",          "aesthetic": "Boho",           "garment_type": "bottoms"},
    {"query": "mens linen shirt summer",        "aesthetic": "Boho",           "garment_type": "tops"},

    # Preppy
    {"query": "mens rugby shirt",               "aesthetic": "Preppy",         "garment_type": "tops"},
    {"query": "mens chino shorts",              "aesthetic": "Preppy",         "garment_type": "bottoms"},
]


# ── GENDER DETECTION ──────────────────────────────────────────────────────────
# Reads the listing title and URL slug to detect if it's mens, womens, or both
FEMALE_RE = re.compile(r"\b(women[\u2019\u2018']?s?|woman|womans|ladies|lady|girls?|female|womenswear)\b", re.IGNORECASE)
MALE_RE   = re.compile(r"\b(men[\u2019\u2018']?s?|man|male|boys?|menswear)\b", re.IGNORECASE)

def detect_gender(listing):
    """Returns 'male', 'female', or 'both' based on title + URL slug."""
    title = listing.get("title", "") or ""
    url = listing.get("url", "") or ""
    # Extract words from URL slug (e.g. /products/seller-mens-jacket-a1b2/ → "mens jacket")
    slug_match = re.search(r"/products/([^/?#]+)", url)
    slug_words = slug_match.group(1).replace("-", " ") if slug_match else ""
    text = f"{title} {slug_words}"
    has_female = bool(FEMALE_RE.search(text))
    has_male   = bool(MALE_RE.search(text))
    if has_female and not has_male:
        return "female"
    if has_male and not has_female:
        return "male"
    return "both"  # neutral, unisex, or no gender word found


# ── DEPOP API ─────────────────────────────────────────────────────────────────
def fetch_depop(query, limit, existing_urls):
    """
    Hits the Depop search API and returns a list of normalised listing dicts.
    Returns empty list on failure.

    existing_urls is a set of product URLs already in the cache; any listing
    whose URL is already present is skipped so we never store a duplicate.
    """
    url = "https://www.depop.com/api/v3/search/products/"
    headers = {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
        "cookie": DEPOP_COOKIE,
        "depop-device-id": DEVICE_ID,
        "depop-session-id": SESSION_ID,
        "origin": "https://www.depop.com",
        "referer": f"https://www.depop.com/search/?q={requests.utils.quote(query)}",
        "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "x-cached-sizes": "true",
    }
    params = {
        "what": query,
        "items_per_page": limit,
        "country": "us",
        "currency": "USD",
        "from": "in_country_search",
        "include_like_count": "true",
        "force_fee_calculation": "false",
    }
    resp = requests.get(url, headers=headers, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    raw_items = data.get("products") or data.get("objects") or []
    listings = []
    for item in raw_items:
        # Build URL from slug
        slug = item.get("slug", "")
        item_url = f"https://www.depop.com/products/{slug}/" if slug else ""
        # Get image URL from nested preview object
        preview = (item.get("preview") or [None])[0] or {}
        image = preview.get("url") or preview.get("src") or ""
        # Get price
        price_obj = item.get("price") or {}
        price_amount = price_obj.get("priceAmount", "")
        price = f"${int(price_amount) / 100:.2f}" if price_amount else ""
        listing = {
            "title": item.get("title") or item.get("name") or "",
            "image": image,
            "price": price,
            "url": item_url,
            "seller": (item.get("seller") or {}).get("username", ""),
            "slug": slug,
            "query": query,
        }
        # Only keep listings that have an image and URL
        if listing["image"] and listing["url"]:
            # Dedup check: skip any listing whose URL is already in the
            # cache (or already seen earlier in this run).
            if listing["url"] in existing_urls:
                print(f"  ⟳ Already in cache, skipping: {listing['title']}")
                continue
            existing_urls.add(listing["url"])  # add so we don't dupe within this run
            listing["_gender"] = detect_gender(listing)
            listings.append(listing)
    return listings


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    """Opens a connection to Supabase Postgres."""
    return psycopg2.connect(DB_URL, sslmode="require")

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

def is_cached(cursor, query):
    """Returns True if this query already has listings in the cache."""
    cursor.execute("SELECT 1 FROM depop_cache WHERE query = %s", (query,))
    return cursor.fetchone() is not None

def save_to_cache(cursor, query, listings, aesthetic, garment_type):
    """
    Inserts or updates a cache row with the fetched listings.
    Duplicate listings are filtered out via existing_urls before they reach
    here; the ON CONFLICT clause remains as a safety net.
    """
    cursor.execute("""
        INSERT INTO depop_cache (query, listings, aesthetic, permanent, garment_type, created_at)
        VALUES (%s, %s::jsonb, %s, true, %s, NOW())
        ON CONFLICT (query) DO UPDATE SET
            listings     = EXCLUDED.listings,
            aesthetic    = EXCLUDED.aesthetic,
            garment_type = EXCLUDED.garment_type,
            created_at   = NOW()
    """, (query, json.dumps(listings), aesthetic, garment_type))


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    if not DEPOP_COOKIE:
        print("❌  DEPOP_COOKIE is empty! Set the DEPOP_COOKIE env var before running.")
        return

    print(f"\n🪡  Stitch Seed Script — {len(SEED_QUERIES)} queries, {ITEMS_PER_QUERY} items each\n")
    conn = get_connection()
    cursor = conn.cursor()

    # Load every URL already in the cache ONCE up front so we can skip
    # listings we've already stored (prevents duplicate entries).
    existing_urls = load_existing_urls(conn)
    print(f"✓ Loaded {len(existing_urls)} existing URLs from cache\n")

    seeded = skipped = failed = 0

    for entry in SEED_QUERIES:
        query       = entry["query"]
        aesthetic   = entry["aesthetic"]
        garment_type = entry["garment_type"]

        # Skip if already in cache
        if is_cached(cursor, query):
            print(f"  ⏭  skip   \"{query}\" (already cached)")
            skipped += 1
            continue

        print(f"  ⬇  fetch  \"{query}\" ... ", end="", flush=True)
        try:
            listings = fetch_depop(query, ITEMS_PER_QUERY, existing_urls)
            if not listings:
                print("0 results")
                failed += 1
            else:
                save_to_cache(cursor, query, listings, aesthetic, garment_type)
                conn.commit()
                print(f"✅  {len(listings)} listings saved")
                seeded += 1
        except requests.HTTPError as e:
            print(f"❌  HTTP {e.response.status_code}")
            if e.response.status_code == 403:
                print("     ⚠️  Cookie expired — grab a fresh one from DevTools and update the DEPOP_COOKIE env var")
                break
            failed += 1
        except Exception as e:
            print(f"❌  {e}")
            failed += 1

        time.sleep(DELAY_SECS)

    cursor.close()
    conn.close()
    print(f"\n✅  Done — seeded: {seeded}, skipped: {skipped}, failed: {failed}\n")

if __name__ == "__main__":
    main()
