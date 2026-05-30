"""
scrape_pacsun.py — Fetch ALL products from Pacsun by category and insert into Stitch cache
===========================================================================

HOW TO USE:
    1. pip install requests psycopg2-binary beautifulsoup4
    2. Get fresh cookies from your browser:
         - Go to pacsun.com/mens/ in Chrome and browse around
         - Press F12 -> Network tab -> Fetch/XHR
         - Click any pacsun.com request -> Headers -> copy the full "cookie:" value
         - Paste it below as COOKIE_RAW (Windows CMD escaping is cleaned automatically)
    3. Run:  python scripts/python/scrape_pacsun.py

HOW IT WORKS:
    Uses Pacsun's Search-ShowAjax endpoint which loads category pages in bulk.
    Each request returns a page of HTML containing product cards.
    We parse the product data (title, price, image, URL) from that HTML.
    Pagination is controlled by the ?page=0, ?page=1, etc. parameter.

    URL format:
        GET /on/demandware.store/Sites-pacsun-Site/default/Search-ShowAjax
            ?cgid=mens-clothing&page=0&selectedUrl=...

    Requires your browser cookies (PerimeterX bot protection).
    Must be run from your home computer, not a server.

HOW TO FIND CATEGORY IDs (cgid):
    1. Go to pacsun.com and click a category (e.g. Mens -> Clothing)
    2. Look at the URL — the part after /mens/ or /womens/ is the cgid
       Example: https://www.pacsun.com/mens/clothing/  -> cgid = mens-clothing
    3. Or check the Network tab for Search-ShowAjax requests and look at
       the cgid= param in the request URL

IMPORTANT:
    Don't commit your cookie string to GitHub!
===========================================================================
"""

import requests
import psycopg2
import json
import re
import time
from bs4 import BeautifulSoup


# ── PASTE YOUR COOKIE STRING HERE ─────────────────────────────────────────────
# Get from: pacsun.com -> DevTools (F12) -> Network -> any request -> Headers -> cookie:
# Windows CMD cURL escaping (^%^, ^\^") is cleaned automatically.
COOKIE_RAW = ""  # <-- paste here


def _clean_cookie(raw: str) -> str:
    """Strip Windows CMD cURL escape sequences from a pasted cookie string."""
    c = raw
    c = c.replace("^%^", "%")
    c = c.replace(r'^\"', '"')
    c = c.replace(r'^\^"', '"')
    c = c.replace('^"', "")
    c = c.replace("^&", "&")
    c = c.replace("^{", "{")
    c = c.replace("^}", "}")
    c = c.replace("^[", "[")
    c = c.replace("^]", "]")
    c = c.strip('"').strip("'")
    return c


COOKIE = _clean_cookie(COOKIE_RAW)


# ── DATABASE ──────────────────────────────────────────────────────────────────
DB_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# ── CATEGORIES TO FETCH ───────────────────────────────────────────────────────
# Format: (cgid, label, aesthetic, garment_type, gender)
#
# cgid = the category ID used in Pacsun's Search-ShowAjax URL
# Find it: browse pacsun.com -> click a category -> check the URL or Network tab
#
# aesthetic must match one of the 41 aesthetics in the Stitch app exactly
# garment_type: "tops", "bottoms", "outerwear", "shoes", "accessories"
# gender: "male", "female", "both"
CATEGORIES = [
    # ── MENS ──────────────────────────────────────────────────────────────────
    ("mens-clothing",          "mens clothing",         "Streetwear",  "tops",      "male"),
    ("mens-graphic-tees",      "mens graphic tees",     "Streetwear",  "tops",      "male"),
    ("mens-hoodies-sweatshirts","mens hoodies",         "Streetwear",  "tops",      "male"),
    ("mens-jeans",             "mens jeans",            "Streetwear",  "bottoms",   "male"),
    ("mens-pants",             "mens pants",            "Streetwear",  "bottoms",   "male"),
    ("mens-shorts",            "mens shorts",           "Streetwear",  "bottoms",   "male"),
    ("mens-jackets",           "mens jackets",          "Streetwear",  "outerwear", "male"),
    ("mens-shirts",            "mens shirts",           "Minimalist",  "tops",      "male"),
    ("mens-sweaters",          "mens sweaters",         "Minimalist",  "tops",      "male"),
    ("mens-shoes",             "mens shoes",            "Streetwear",  "shoes",     "male"),

    # ── WOMENS ────────────────────────────────────────────────────────────────
    ("womens-clothing",        "womens clothing",       "Y2K",         "tops",      "female"),
    ("womens-graphic-tees",    "womens graphic tees",   "Y2K",         "tops",      "female"),
    ("womens-hoodies-sweatshirts","womens hoodies",     "Soft Girl",   "tops",      "female"),
    ("womens-jeans",           "womens jeans",          "Y2K",         "bottoms",   "female"),
    ("womens-pants",           "womens pants",          "Y2K",         "bottoms",   "female"),
    ("womens-shorts",          "womens shorts",         "Y2K",         "bottoms",   "female"),
    ("womens-jackets",         "womens jackets",        "Streetwear",  "outerwear", "female"),
    ("womens-dresses",         "womens dresses",        "Coquette",    "tops",      "female"),
    ("womens-shoes",           "womens shoes",          "Y2K",         "shoes",     "female"),
]


# ── CONFIG ────────────────────────────────────────────────────────────────────
MAX_PAGES_PER_CATEGORY = 999    # effectively unlimited — stops when Pacsun returns no more products
PAGE_SIZE = 24                  # Pacsun returns 24 products per page
DELAY_SECS = 2.0                # seconds between requests (be polite, avoid triggering bot detection)
DRY_RUN = False                 # set True to test without writing to DB

BASE_URL = "https://www.pacsun.com"
AJAX_ENDPOINT = "/on/demandware.store/Sites-pacsun-Site/default/Search-ShowAjax"


def make_headers(referer="https://www.pacsun.com/mens/"):
    """Headers that mimic a real Chrome browser on Windows."""
    return {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "cookie": COOKIE,
        "origin": BASE_URL,
        "referer": referer,
        "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/148.0.0.0 Safari/537.36"
        ),
        "x-requested-with": "XMLHttpRequest",
    }


def load_existing_urls(conn):
    """
    Load all product URLs already in the cache into a set for O(1) dedup lookup.
    """
    cur = conn.cursor()
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


def fetch_category_page(cgid, page):
    """
    Fetch one page of products from Pacsun's Search-ShowAjax endpoint.

    The endpoint returns HTML containing product card markup.
    Each page has up to PAGE_SIZE (24) products.

    Returns the raw HTML string, or None on failure.
    """
    selected_url = f"/on/demandware.store/Sites-pacsun-Site/default/Search-ShowAjax?cgid={cgid}"
    params = {
        "cgid": cgid,
        "page": page,
        "selectedUrl": selected_url,
    }
    referer = f"{BASE_URL}/{cgid.replace('-', '/', 1)}/"  # e.g. /mens/clothing/

    resp = requests.get(
        BASE_URL + AJAX_ENDPOINT,
        headers=make_headers(referer),
        params=params,
        timeout=20,
    )

    if resp.status_code == 403:
        print(f"    ✗ 403 Forbidden — cookies expired, grab fresh ones from DevTools")
        return None
    if resp.status_code != 200:
        print(f"    ✗ HTTP {resp.status_code}")
        return None
    if len(resp.text) < 100:
        return None

    return resp.text


def parse_products_from_html(html, cgid):
    """
    Parse product cards from Pacsun's Search-ShowAjax HTML response.

    Pacsun renders product tiles as HTML. Each tile contains:
    - A link with the product URL (href ending in .html)
    - An <img> tag with the product image
    - Price and title in data attributes or text nodes

    We try multiple extraction strategies in order of reliability:
    1. JSON-LD structured data (<script type="application/ld+json">)
    2. Open Graph meta tags (og:title, og:image, og:price:amount)
    3. HTML data attributes on product tile elements
    4. Regex on raw HTML as last resort

    Returns a list of dicts with title, price, image, url.
    """
    soup = BeautifulSoup(html, "html.parser")
    products = []

    # Strategy 1: Look for product tile links with data attributes
    # Pacsun product tiles have class "product-tile" or similar
    tiles = soup.select("div.product-tile, article.product-tile, div[data-pid]")

    for tile in tiles:
        try:
            # Get product URL from the first <a> link inside the tile
            link = tile.select_one("a[href]")
            if not link:
                continue
            href = link.get("href", "")
            # Pacsun product URLs end with a 13-digit ID before .html
            if not re.search(r"-\d{13}\.html", href):
                continue
            url = href if href.startswith("http") else BASE_URL + href

            # Get title from data-name attribute, alt text, or link text
            title = (
                tile.get("data-name") or
                tile.get("data-product-name") or
                link.get("title") or
                tile.select_one("img[alt]") and tile.select_one("img[alt]").get("alt") or
                tile.select_one(".product-name, .pdp-link a, h2, h3") and
                tile.select_one(".product-name, .pdp-link a, h2, h3").get_text(strip=True) or
                ""
            )

            # Get image URL
            img = tile.select_one("img[src], img[data-src]")
            image = ""
            if img:
                image = img.get("src") or img.get("data-src") or ""
                if image and not image.startswith("http"):
                    image = BASE_URL + image

            # Get price from data attribute or text
            price_raw = (
                tile.get("data-price") or
                tile.select_one(".price .value, .sales .value, span[content]") and
                (tile.select_one(".price .value, .sales .value, span[content]").get("content") or
                 tile.select_one(".price .value, .sales .value").get_text(strip=True)) or
                ""
            )
            price = f"${price_raw}" if price_raw and not str(price_raw).startswith("$") else str(price_raw) or "N/A"

            if not title or not url:
                continue

            products.append({
                "title": title,
                "price": price,
                "image": image,
                "url": url,
            })

        except Exception:
            continue

    # Strategy 2: If tile parsing found nothing, try regex on product links
    if not products:
        # Find all product page links
        link_matches = re.findall(r'href="(https?://[^"]*-\d{13}\.html[^"]*)"', html)
        link_matches += re.findall(r'href="(/[^"]*-\d{13}\.html[^"]*)"', html)

        seen = set()
        for href in link_matches:
            url = href if href.startswith("http") else BASE_URL + href
            if url in seen:
                continue
            seen.add(url)

            # Extract slug as title fallback
            slug = url.split("/")[-1].replace(".html", "")
            title = re.sub(r"-\d{13}$", "", slug).replace("-", " ").title()

            # Find nearby image
            idx = html.find(href)
            nearby = html[max(0, idx-500):idx+500]
            img_match = re.search(r'src="(https://[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"', nearby)
            image = img_match.group(1) if img_match else ""

            # Find price
            price_match = re.search(r'\$(\d+\.\d{2})', nearby)
            price = f"${price_match.group(1)}" if price_match else "N/A"

            products.append({
                "title": title,
                "price": price,
                "image": image,
                "url": url,
            })

    return products


def upsert_to_db(conn, query_key, aesthetic, garment_type, gender, listings):
    """Insert listings into depop_cache, appending to existing rows for this key."""
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
    if not COOKIE_RAW:
        print("ERROR: Paste your Pacsun cookie string into COOKIE_RAW = \"\" at the top")
        print("Get it: pacsun.com -> DevTools (F12) -> Network -> any request -> Headers -> cookie:")
        return

    print("=" * 60)
    print("Stitch — Pacsun Category Scraper")
    print("=" * 60)

    conn = psycopg2.connect(DB_URL, sslmode="require")
    print("✓ Connected to database\n")

    existing_urls = load_existing_urls(conn)
    print(f"✓ Loaded {len(existing_urls)} existing URLs from cache\n")

    total_inserted = 0

    for cgid, label, aesthetic, garment_type, gender in CATEGORIES:
        print(f"\n── Category '{cgid}': {label} -> {aesthetic}/{garment_type}/{gender} ──")

        all_listings = []
        consecutive_zero_new = 0

        for page in range(MAX_PAGES_PER_CATEGORY):
            print(f"  Page {page}...")
            html = fetch_category_page(cgid, page)

            if html is None:
                print(f"  Request failed — stopping this category")
                break

            products = parse_products_from_html(html, cgid)

            # No products parsed at all = truly empty page, we're done
            if not products:
                print(f"  No products on page {page} — end of category")
                break

            new_count = 0
            for p in products:
                if not p.get("url"):
                    continue
                if p["url"] in existing_urls:
                    continue  # already cached

                existing_urls.add(p["url"])
                slug = p["url"].split("/")[-1].replace(".html", "")

                listing = {
                    "title": p["title"],
                    "price": p["price"],
                    "image": p["image"],
                    "url": p["url"],
                    "seller": "pacsun",
                    "slug": slug,
                    "query": label,
                    "_gender": gender,
                    "_source": "pacsun",
                }
                all_listings.append(listing)
                new_count += 1
                print(f"    ✓ {p['title'][:60]} — {p['price']}")

            print(f"  Page {page}: {new_count} new / {len(products)} total")

            # Stop if fewer than a full page returned — last page
            if len(products) < PAGE_SIZE:
                print(f"  Last page reached (got {len(products)} < {PAGE_SIZE})")
                break

            # Stop if 2 consecutive pages had zero new products (all already cached)
            if new_count == 0:
                consecutive_zero_new += 1
                if consecutive_zero_new >= 2:
                    print(f"  2 consecutive pages fully cached — stopping")
                    break
            else:
                consecutive_zero_new = 0

            time.sleep(DELAY_SECS)

        # Insert all collected listings for this category
        cache_key = f"pacsun {label}"
        upsert_to_db(conn, cache_key, aesthetic, garment_type, gender, all_listings)
        total_inserted += len(all_listings)

        time.sleep(DELAY_SECS)

    conn.close()
    print(f"\n{'=' * 60}")
    print(f"Done! Inserted {total_inserted} products total")


if __name__ == "__main__":
    main()
