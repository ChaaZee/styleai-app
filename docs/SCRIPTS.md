# SCRIPTS.md — Stitch Maintenance Scripts

## Table of Contents
1. [Overview](#1-overview)
2. [Prerequisites & Setup](#2-prerequisites--setup)
3. [Script: `seed.py` — Seed the Depop Cache](#3-script-seedpy--seed-the-depop-cache)
4. [Script: `cleanup.py` — Remove Dead Listings](#4-script-cleanuppy--remove-dead-listings)
5. [Script: `retag_gender.py` — Re-run Gender Detection](#5-script-retag_genderpy--re-run-gender-detection)
6. [Script: `reembed.py` — Regenerate OpenAI Embeddings](#6-script-reembedpy--regenerate-openai-embeddings)
7. [Script: `purge_junk.py` — Remove Non-Clothing Items](#7-script-purge_junkpy--remove-non-clothing-items)
8. [When to Run Each Script](#8-when-to-run-each-script)
9. [The Cookie Problem (Depop Anti-Bot)](#9-the-cookie-problem-depop-anti-bot)
10. [Old `.mjs` Scripts (Being Replaced)](#10-old-mjs-scripts-being-replaced)
11. [Script Run Order for a Fresh Database](#11-script-run-order-for-a-fresh-database)
12. [Debugging Tips](#12-debugging-tips)

---

## 1. Overview

The `scripts/python/` directory contains five maintenance scripts. These are **not part of the app's normal operation** — they're run manually (or occasionally via cron) to keep the `depop_cache` table healthy and well-stocked.

```
scripts/
├── python/
│   ├── seed.py           # Populate depop_cache with fresh Depop listings
│   ├── cleanup.py        # Find and remove dead (404/410) listing URLs
│   ├── retag_gender.py   # Re-run gender detection on all cached listings
│   ├── reembed.py        # Regenerate OpenAI embeddings for all cache rows
│   └── purge_junk.py     # Remove non-clothing items and spam listings
│
└── (old .mjs scripts — see section 10)
```

**The relationship between these scripts and the app**:

```
seed.py ──────────────→ depop_cache (rows added)
                              │
retag_gender.py ─────────────┤ (gender field updated)
reembed.py ──────────────────┤ (embedding column populated)
purge_junk.py ───────────────┤ (junk rows removed)
cleanup.py ──────────────────┘ (dead listings removed from JSONB arrays)
                              │
                    App reads depop_cache
                    to serve For You + Trending feeds
```

All five scripts connect directly to the same Supabase PostgreSQL database as the app. They bypass the Express API entirely.

---

## 2. Prerequisites & Setup

### Environment Variables

All scripts read from a `.env` file in the `scripts/python/` directory (or system environment):

```bash
DATABASE_URL=postgresql://postgres.cdjuosvljudidvyxdfwn:...@aws-1-us-east-1.pooler.supabase.com:5432/postgres
OPENAI_API_KEY=sk-...          # Only needed for reembed.py
COOKIE=cf_clearance=...        # Cloudflare clearance cookie for Depop
DEVICE_ID=your-depop-device-id # Depop device ID from browser
SESSION_ID=your-depop-session  # Depop session ID from browser
```

### Python Dependencies

```bash
pip install psycopg2-binary python-dotenv requests openai
```

All scripts use:
- `psycopg2` — PostgreSQL connection (Python's equivalent of the `postgres` npm package)
- `python-dotenv` — loads `.env` files
- `requests` — HTTP calls to Depop API

`reembed.py` additionally needs `openai`.

### Running a Script

```bash
cd scripts/python
python seed.py
python cleanup.py --delete   # note: --delete flag required to actually delete
```

---

## 3. Script: `seed.py` — Seed the Depop Cache

**Purpose**: Fetches Depop listings for a curated list of search queries and stores them in `depop_cache` with `permanent = TRUE`.

**When to run**: 
- When setting up a fresh database (run first)
- When adding new aesthetics or queries to `SEED_QUERIES`
- When permanent cache rows have gone stale (older than 24h and app's daily cron missed them)

### `SEED_QUERIES` — The Query List

The script has a hardcoded list of 37+ queries covering multiple aesthetics. These represent the "core inventory" of Stitch — searches that should always be cached:

```python
SEED_QUERIES = [
    # Dark Academia
    "dark academia blazer women",
    "dark academia turtleneck sweater",
    "dark academia trousers wide leg",
    "corduroy jacket dark academia",
    "oxford shoes dark academia women",
    
    # Streetwear
    "streetwear cargo pants men",
    "oversized hoodie streetwear",
    "streetwear graphic tee vintage",
    
    # Cottagecore
    "cottagecore floral dress women",
    "cottagecore linen top",
    "vintage floral blouse cottagecore",
    
    # Quiet Luxury
    "quiet luxury blazer women",
    "cashmere sweater minimalist",
    "tailored trousers quiet luxury",
    
    # ... 20+ more across all aesthetics
]
```

### How It Works

```python
import requests
import psycopg2
import json
import os
from dotenv import load_dotenv

load_dotenv()

COOKIE = os.environ["COOKIE"]          # cf_clearance=...
DEVICE_ID = os.environ["DEVICE_ID"]
SESSION_ID = os.environ["SESSION_ID"]

def fetch_depop_listings(query: str) -> list[dict]:
    """Call Depop's v3 search API directly."""
    url = "https://api.depop.com/api/v3/search/products/"
    headers = {
        "Cookie": COOKIE,
        "User-Agent": "Mozilla/5.0 ...",
        "Accept": "application/json",
        "depop-device-id": DEVICE_ID,
        "depop-session-id": SESSION_ID,
    }
    params = {
        "q": query,
        "limit": 20,
        "offset": 0,
        "sort": "relevance",
    }
    response = requests.get(url, headers=headers, params=params, timeout=15)
    response.raise_for_status()
    return response.json().get("results", [])

def normalise_listing(raw: dict) -> dict:
    """Convert Depop's raw API response to Stitch's normalised format."""
    preview = raw.get("preview", {})
    seller = raw.get("seller", {})
    price = raw.get("price", {})
    
    title = raw.get("title", "")
    slug = raw.get("slug", "")
    gender = detect_gender(title, slug)  # same logic as TypeScript version
    
    return {
        "id": raw.get("id", ""),
        "title": title,
        "price": price.get("totalAmount", "0"),
        "currency": price.get("currencyCode", "GBP"),
        "imageUrl": preview.get("src", ""),
        "url": f"https://www.depop.com/products/{slug}/",
        "seller": seller.get("username", ""),
        "gender": gender,
        "likes": raw.get("likesCount", 0),
    }

def seed_query(conn, query: str, aesthetic: str) -> None:
    """Fetch listings for one query and upsert into depop_cache."""
    cursor = conn.cursor()
    
    # Check if already cached (skip if exists)
    cursor.execute("SELECT id FROM depop_cache WHERE query = %s", (query,))
    if cursor.fetchone():
        print(f"  Already cached: {query}")
        return
    
    print(f"  Fetching: {query}")
    raw_listings = fetch_depop_listings(query)
    
    if not raw_listings:
        print(f"  No results for: {query}")
        return
    
    normalised = [normalise_listing(r) for r in raw_listings]
    
    cursor.execute("""
        INSERT INTO depop_cache (query, listings, aesthetic, permanent, created_at)
        VALUES (%s, %s::jsonb, %s, TRUE, NOW())
        ON CONFLICT (query) DO UPDATE
        SET listings = EXCLUDED.listings,
            permanent = TRUE,
            created_at = NOW()
    """, (query, json.dumps(normalised), aesthetic))
    
    conn.commit()
    print(f"  Saved {len(normalised)} listings for: {query}")

def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    
    for entry in SEED_QUERIES:
        query = entry["query"]
        aesthetic = entry["aesthetic"]
        try:
            seed_query(conn, query, aesthetic)
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 403:
                print(f"  403 on {query} — cookie may be expired! See section 9.")
                break  # Stop if cookie is dead
            print(f"  Error on {query}: {e}")
    
    conn.close()
    print("Done.")

if __name__ == "__main__":
    main()
```

### Skip-If-Cached Logic

The script checks if a query is already in `depop_cache` before fetching. This makes re-runs safe — if the script is interrupted partway through, you can re-run it and it will skip already-completed queries.

To **force re-fetch** of an already-cached query (e.g. listings are stale), delete the row first:
```sql
DELETE FROM depop_cache WHERE query = 'dark academia blazer women';
```
Then re-run `seed.py`.

---

## 4. Script: `cleanup.py` — Remove Dead Listings

**Purpose**: Checks whether each Depop listing URL is still live. Removes 404/410 (gone) listings from the `listings` JSONB array.

**When to run**: Weekly or monthly — Depop items sell and get deleted frequently.

### The Problem It Solves

A listing stored in `depop_cache` might have been:
- Sold (Depop marks it inactive, URL returns 404)
- Deleted by the seller (404)
- Permanently removed (410 Gone)

Users clicking on a dead listing see a Depop 404 page — bad experience. `cleanup.py` finds and removes these.

### How It Works

```python
import requests
from concurrent.futures import ThreadPoolExecutor
import json
import psycopg2
import argparse

CONCURRENCY = 10  # parallel HTTP requests
TIMEOUT = 8       # seconds per request

def is_listing_dead(url: str) -> bool | None:
    """
    Returns:
    - True: listing is confirmed dead (404/410)
    - False: listing is live (2xx, 3xx)
    - None: ambiguous (403/429/timeout — Depop blocked us from cloud IP)
    """
    try:
        resp = requests.head(url, timeout=TIMEOUT, allow_redirects=True)
        if resp.status_code in (404, 410):
            return True
        if resp.status_code in (403, 429):
            return None  # Depop blocking cloud IPs — assume live
        return False
    except requests.exceptions.Timeout:
        return None  # Timeout → assume live (don't delete on ambiguity)
    except Exception:
        return None

def check_cache_row(row: dict) -> list[dict]:
    """
    Given a depop_cache row, check each listing and return
    only the live ones.
    """
    listings = row["listings"]
    
    def check_one(listing):
        dead = is_listing_dead(listing["url"])
        return listing, dead
    
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        results = list(executor.map(check_one, listings))
    
    live = [listing for listing, dead in results if dead is not True]
    dead_count = sum(1 for _, dead in results if dead is True)
    
    if dead_count > 0:
        print(f"  Removed {dead_count}/{len(listings)} dead listings from '{row['query']}'")
    
    return live

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--delete", action="store_true", 
                        help="Actually delete dead listings. Without this flag, dry run only.")
    args = parser.parse_args()
    
    if not args.delete:
        print("DRY RUN — pass --delete to actually remove listings")
    
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cursor = conn.cursor()
    
    # Fetch all cache rows
    cursor.execute("SELECT id, query, listings FROM depop_cache")
    rows = cursor.fetchall()
    
    for row_id, query, listings_json in rows:
        listings = json.loads(listings_json) if isinstance(listings_json, str) else listings_json
        row = {"query": query, "listings": listings}
        
        live_listings = check_cache_row(row)
        
        if len(live_listings) < len(listings) and args.delete:
            if live_listings:
                # Update row with only live listings
                cursor.execute(
                    "UPDATE depop_cache SET listings = %s::jsonb WHERE id = %s",
                    (json.dumps(live_listings), row_id)
                )
            else:
                # All listings dead — delete the entire cache row
                cursor.execute("DELETE FROM depop_cache WHERE id = %s", (row_id,))
                print(f"  Deleted entire cache row for '{query}' (all listings dead)")
            conn.commit()
    
    conn.close()
    print("Cleanup complete.")

if __name__ == "__main__":
    main()
```

### The `--delete` Flag (Dry Run by Default)

Running `python cleanup.py` without `--delete` shows you what *would* be deleted without making any changes. This is a safety measure — you can audit the output before committing.

```bash
# Dry run (shows what would be deleted, makes no changes)
python cleanup.py

# Actually delete dead listings
python cleanup.py --delete
```

### Why 403/429 Are Treated as "Live"

Depop's infrastructure blocks requests from cloud IP addresses (Render.com, AWS, etc.) with 403 Forbidden. A 403 does NOT mean the listing is dead — it means Depop is blocking the script from checking. Treating 403 as "dead" would incorrectly remove thousands of perfectly live listings.

The safe assumption: if we can't confirm it's dead, keep it.

### `ThreadPoolExecutor` — Concurrent HTTP Requests

```python
# Python concurrent execution — like JavaScript's Promise.all()
with ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(check_one, listings))
```

Without concurrency, checking 20 listings per row × 7,700 rows × 8s timeout = potentially days of runtime. With 10 concurrent workers, each batch of 20 takes only as long as the slowest single request (~8s).

**Python analogy for JS devs**: `ThreadPoolExecutor.map()` is the Python equivalent of `Promise.all()`. It runs multiple functions concurrently and collects results.

---

## 5. Script: `retag_gender.py` — Re-run Gender Detection

**Purpose**: Re-runs the gender detection logic on every listing in `depop_cache` and updates the `gender` field on each listing object.

**When to run**:
- After changing the gender detection regexes in the main app
- After running `seed.py` (to ensure all new listings have gender tags)
- If you notice gender filtering isn't working correctly in the feed

### How It Works

```python
import psycopg2
import json
import re
from concurrent.futures import ThreadPoolExecutor

# Mirror the TypeScript regexes exactly
EXPLICIT_FEMALE = re.compile(
    r"\b(women[''']?s?|woman|womans|womena|ladies|lady|girls?|female|womenswear)\b",
    re.IGNORECASE
)
EXPLICIT_MALE = re.compile(
    r"\b(men[''']?s?|man|male|boys?|menswear)\b",
    re.IGNORECASE
)

def listing_text(title: str, url: str) -> str:
    """Combine title and URL slug words for gender detection."""
    # Extract last path segment from URL and replace hyphens with spaces
    slug = url.rstrip("/").split("/")[-1].replace("-", " ")
    return f"{title} {slug}"

def detect_gender(title: str, url: str) -> str:
    text = listing_text(title, url)
    is_female = bool(EXPLICIT_FEMALE.search(text))
    is_male = bool(EXPLICIT_MALE.search(text))
    
    if is_female and is_male:
        return "both"
    if is_female:
        return "female"
    if is_male:
        return "male"
    return "both"  # No signal → unisex

def retag_row(row_data: tuple) -> tuple[int, list[dict]] | None:
    """Re-detect gender for all listings in a single cache row."""
    row_id, listings_json = row_data
    listings = json.loads(listings_json) if isinstance(listings_json, str) else listings_json
    
    changed = False
    for listing in listings:
        title = listing.get("title", "")
        url = listing.get("url", "")
        new_gender = detect_gender(title, url)
        
        if listing.get("gender") != new_gender:
            listing["gender"] = new_gender
            changed = True
    
    return (row_id, listings) if changed else None

def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cursor = conn.cursor()
    
    print("Fetching all cache rows...")
    cursor.execute("SELECT id, listings FROM depop_cache")
    rows = cursor.fetchall()
    print(f"Found {len(rows)} rows")
    
    # Process concurrently
    with ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(retag_row, rows))
    
    # Write back only changed rows
    changed_count = 0
    for result in results:
        if result is None:
            continue
        row_id, updated_listings = result
        cursor.execute(
            "UPDATE depop_cache SET listings = %s::jsonb WHERE id = %s",
            (json.dumps(updated_listings), row_id)
        )
        changed_count += 1
    
    conn.commit()
    conn.close()
    print(f"Updated {changed_count} rows with new gender tags.")

if __name__ == "__main__":
    main()
```

### Key Design: Only Write Changed Rows

The script checks `if listing.get("gender") != new_gender` before marking a row as changed. This avoids unnecessary database writes — if the gender tags are already correct, nothing is updated.

**In practice**: The first time you run this after seeding, nearly all rows need updating (seed.py might not have run gender detection). Subsequent runs usually update 0–5% of rows (only recently added listings without tags).

---

## 6. Script: `reembed.py` — Regenerate OpenAI Embeddings

**Purpose**: Calls OpenAI's `text-embedding-3-small` model to generate (or regenerate) the `embedding` vector column for every row in `depop_cache`.

**When to run**:
- After `seed.py` (new rows have no embeddings yet)
- After bulk importing rows via any method
- **Never needed after normal app operation** — the app generates embeddings automatically when serving new queries

### How It Works

```python
import psycopg2
import json
import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

ONLY_MISSING = True  # Set to False to re-embed ALL rows (expensive)
BATCH_SIZE = 100     # Process this many rows at once

# Brand names to strip before embedding (subset shown)
BRANDS = {
    "nike", "zara", "hm", "h&m", "asos", "shein", "topshop", "urban outfitters",
    "free people", "levi", "levis", "gap", "old navy", "gucci", "prada",
    "adidas", "puma", "converse", "vans",
    # ... 200+ more
}

def normalize_for_embedding(text: str) -> str:
    """Strip brand names from query before embedding."""
    words = text.lower().split()
    filtered = [w for w in words if w.replace("'", "") not in BRANDS]
    return " ".join(filtered).strip()

def get_embed_text(query: str, listings: list[dict]) -> str:
    """Build the text to embed: '{query}: title1, title2, ..., title5'"""
    top_titles = [l.get("title", "") for l in listings[:5]]
    titles_str = ", ".join(top_titles)
    return f"{query}: {titles_str}"

def get_embedding(text: str) -> list[float]:
    normalised = normalize_for_embedding(text)
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=normalised,
    )
    return response.data[0].embedding  # 1536 floats

def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cursor = conn.cursor()
    
    if ONLY_MISSING:
        cursor.execute(
            "SELECT id, query, listings FROM depop_cache WHERE embedding IS NULL"
        )
    else:
        cursor.execute("SELECT id, query, listings FROM depop_cache")
    
    rows = cursor.fetchall()
    print(f"Rows to embed: {len(rows)}")
    
    total_tokens = 0
    
    for i, (row_id, query, listings_json) in enumerate(rows):
        listings = json.loads(listings_json) if isinstance(listings_json, str) else listings_json
        
        embed_text = get_embed_text(query, listings)
        embedding = get_embedding(embed_text)
        
        # Store vector — note the array format for pgvector
        embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"
        
        cursor.execute(
            "UPDATE depop_cache SET embedding = %s::vector WHERE id = %s",
            (embedding_str, row_id)
        )
        
        if (i + 1) % BATCH_SIZE == 0:
            conn.commit()
            print(f"  Progress: {i + 1}/{len(rows)}")
    
    conn.commit()
    conn.close()
    print(f"Done. Approximate cost: ${len(rows) * 0.00001:.4f}")

if __name__ == "__main__":
    main()
```

### `ONLY_MISSING = True` — Safe Default

By default, only rows with `embedding IS NULL` are processed. This makes re-runs idempotent and prevents re-spending money on already-embedded rows.

Set `ONLY_MISSING = False` only if you've switched embedding models or changed `normalize_for_embedding()` and want all vectors recomputed from scratch.

### Cost Estimate

`text-embedding-3-small` costs $0.02 per million tokens. The embed text per row is roughly 50–100 tokens.

```
7,700 rows × 75 tokens average = 577,500 tokens
577,500 / 1,000,000 × $0.02 = $0.012 (~1 cent for all 7,700 rows)
```

Embeddings are extraordinarily cheap. You could re-embed the entire database daily for under $5/month.

### Vector Storage Format

When writing a vector to PostgreSQL via psycopg2:

```python
# Convert list of floats to pgvector string format
embedding = [0.023, -0.14, 0.87, ...]  # 1536 floats

# Format as pgvector accepts: "[0.023,-0.14,0.87,...]"
embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"

cursor.execute(
    "UPDATE depop_cache SET embedding = %s::vector WHERE id = %s",
    (embedding_str, row_id)  # %s for parameterised query in psycopg2
)
```

---

## 7. Script: `purge_junk.py` — Remove Non-Clothing Items

**Purpose**: Removes listings that are clearly not clothing — trading cards, phone cases, mugs, etc. — and removes spam listings (same URL appearing in 20+ cache rows).

**When to run**:
- After seeding (Depop search results sometimes include tangentially related non-clothing items)
- Periodically to keep the database clean
- After adding new `JUNK_KEYWORDS` patterns

### How It Works

```python
import psycopg2
import json
import argparse
from collections import Counter

# Keywords that indicate a listing is NOT clothing
JUNK_KEYWORDS = [
    "trading card", "pokemon card", "yugioh", "phone case", "phone cover",
    "mug", "cup", "poster", "print", "art print", "sticker", "keychain",
    "wallet", "purse insert", "wig", "hair extension", "false lash",
    "nail", "perfume", "cologne", "makeup", "skincare", "candle",
    "book", "dvd", "cd", "vinyl", "game", "console",
    "figure", "funko", "plush", "stuffed animal", "toy",
    "bag liner", "dust bag",  # accessories rather than clothing
    # ... more
]

def is_junk_listing(listing: dict) -> bool:
    title = listing.get("title", "").lower()
    return any(keyword in title for keyword in JUNK_KEYWORDS)

def find_spam_urls(all_rows: list[dict], threshold: int = 20) -> set[str]:
    """Find listing URLs appearing in >= threshold cache rows (spam indicator)."""
    url_counts = Counter()
    
    for row in all_rows:
        for listing in row["listings"]:
            url = listing.get("url", "")
            if url:
                url_counts[url] += 1
    
    # URLs in 20+ rows are likely spam/bot accounts reposting everywhere
    return {url for url, count in url_counts.items() if count >= threshold}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--delete", action="store_true",
                        help="Actually delete junk. Without this flag, dry run only.")
    args = parser.parse_args()
    
    if not args.delete:
        print("DRY RUN — pass --delete to actually remove junk")
    
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cursor = conn.cursor()
    
    cursor.execute("SELECT id, query, listings FROM depop_cache")
    rows = cursor.fetchall()
    
    all_rows_data = []
    for row_id, query, listings_json in rows:
        listings = json.loads(listings_json) if isinstance(listings_json, str) else listings_json
        all_rows_data.append({"id": row_id, "query": query, "listings": listings})
    
    # Find spam URLs
    spam_urls = find_spam_urls(all_rows_data, threshold=20)
    print(f"Found {len(spam_urls)} spam URLs (appearing in 20+ rows)")
    
    total_removed = 0
    
    for row_data in all_rows_data:
        original_count = len(row_data["listings"])
        
        # Filter out junk keywords AND spam URLs
        clean_listings = [
            listing for listing in row_data["listings"]
            if not is_junk_listing(listing)
            and listing.get("url", "") not in spam_urls
        ]
        
        removed = original_count - len(clean_listings)
        if removed > 0:
            total_removed += removed
            print(f"  '{row_data['query']}': removing {removed} junk listings")
            
            if args.delete:
                if clean_listings:
                    cursor.execute(
                        "UPDATE depop_cache SET listings = %s::jsonb WHERE id = %s",
                        (json.dumps(clean_listings), row_data["id"])
                    )
                else:
                    cursor.execute(
                        "DELETE FROM depop_cache WHERE id = %s",
                        (row_data["id"],)
                    )
    
    if args.delete:
        conn.commit()
        print(f"Removed {total_removed} junk listings total.")
    else:
        print(f"Would remove {total_removed} junk listings (dry run).")
    
    conn.close()

if __name__ == "__main__":
    main()
```

### Spam Detection Logic

A Depop listing URL appearing in 20+ different cache rows is almost certainly a spam account or a reseller bot that posts the same item to every possible search. The threshold of 20 is empirically chosen — legitimate items might appear in 3–5 related searches ("dark academia blazer", "vintage blazer women", "oversized tweed blazer") but not 20+.

```python
url_counts = Counter()
for row in all_rows:
    for listing in row["listings"]:
        url_counts[listing["url"]] += 1

# Any URL in 20+ rows is spam
spam_urls = {url for url, count in url_counts.items() if count >= 20}
```

**Python `Counter`**: Like a `dict` that counts occurrences. `Counter(["a", "b", "a"])` → `{"a": 2, "b": 1}`.

---

## 8. When to Run Each Script

### Initial Database Setup (Fresh Install)

```bash
# 1. Seed the database with base listings
python seed.py

# 2. Tag all listings with gender
python retag_gender.py

# 3. Generate embeddings for all rows
python reembed.py

# 4. Remove any junk that snuck in
python purge_junk.py --delete
```

### Regular Maintenance (Weekly)

```bash
# Check for and remove dead listings
python cleanup.py --delete

# Remove any new junk
python purge_junk.py --delete
```

### After Changing Gender Detection Logic

```bash
# Re-run gender tagging on all listings
python retag_gender.py
```

### After Adding New Queries to `SEED_QUERIES`

```bash
# Fetch new queries (skips already-cached ones)
python seed.py

# Generate embeddings for new rows only (ONLY_MISSING=True default)
python reembed.py
```

### After Changing `normalize_for_embedding()`

```bash
# Set ONLY_MISSING = False in reembed.py first, then:
python reembed.py  # re-embeds ALL rows
```

---

## 9. The Cookie Problem (Depop Anti-Bot)

This is the biggest operational challenge when running `seed.py`.

### Why Cookies Are Needed

Depop uses Cloudflare's bot protection. When you visit Depop in a browser, Cloudflare runs JavaScript challenges to verify you're human, then sets a `cf_clearance` cookie. API requests carrying this cookie are treated as legitimate browser traffic.

Scripts running from cloud IPs (Render, AWS, your laptop without this cookie) get blocked with HTTP 403.

### Cookie Expiry (~1 Hour)

The `cf_clearance` cookie expires in approximately **1 hour**. This means:
- You run `seed.py` → it works for the first 60 minutes
- After 60 minutes: 403 errors, script stops working
- You must manually get a fresh cookie from your browser

### How to Get a Fresh Cookie

1. Open Chrome/Firefox DevTools (F12)
2. Go to `www.depop.com` in your browser
3. Navigate to Network tab, filter by "XHR" or "Fetch"
4. Perform a search on Depop
5. Click any `/api/v3/search/products/` request
6. In Request Headers, find `Cookie:`
7. Copy the value of `cf_clearance=...`
8. Update your `.env` file: `COOKIE=cf_clearance=<new_value>`

Similarly, get `DEVICE_ID` from the `depop-device-id` request header and `SESSION_ID` from `depop-session-id`.

### The Cookie Pattern in seed.py

```python
# seed.py reads cookie from environment at startup
COOKIE = os.environ["COOKIE"]

# All Depop requests use this cookie
headers = {
    "Cookie": COOKIE,           # cf_clearance=...
    "depop-device-id": DEVICE_ID,
    "depop-session-id": SESSION_ID,
}
```

If you get a 403, the script should detect it and stop:
```python
if e.response.status_code == 403:
    print("Cookie expired! Get a fresh cf_clearance from your browser.")
    break
```

### Why The App Itself Doesn't Have This Problem

The production app doesn't call Depop's API directly from the server. Instead, it uses a **Cloudflare Worker** (`cloudflare-worker/worker.js`) that acts as a proxy with its own device credentials. Cloudflare Workers run on Cloudflare's edge network, which is whitelisted by Depop's anti-bot system (or at least has a different reputation than random cloud IPs).

The Python scripts bypass the Worker and hit Depop directly, which is why they need manual browser cookies.

### Long-Term Solutions

Options for avoiding the cookie problem:

1. **Run seed.py locally** (not on a cloud server) — residential IPs are less aggressively blocked
2. **Use a residential proxy** — expensive but reliable
3. **Rate limit seed.py heavily** — add `time.sleep(2)` between requests to look more human
4. **Use the Cloudflare Worker** — refactor seed.py to call the Worker instead of Depop directly (requires adding Worker auth header)

---

## 10. Old `.mjs` Scripts (Being Replaced)

The `scripts/` directory also contains older JavaScript (`.mjs`) scripts. These were written first and are gradually being replaced by the Python scripts. They do the same things but in Node.js.

### Old Scripts

| Old Script | Replaced By |
|-----------|-------------|
| `scripts/seed-local.mjs` | `scripts/python/seed.py` |
| `scripts/cleanup-cache.mjs` | `scripts/python/cleanup.py` |
| `scripts/retag-gender-all.mjs` | `scripts/python/retag_gender.py` |
| `scripts/reembed-all.mjs` | `scripts/python/reembed.py` |
| `scripts/purge-junk.mjs` | `scripts/python/purge_junk.py` |
| `scripts/purge-and-reembed.mjs` | Run `purge_junk.py --delete` then `reembed.py` |
| `scripts/migrate-titles-from-slug.mjs` | One-time migration, done |
| `scripts/migrate-gender-tags.mjs` | One-time migration, done |
| `scripts/migrate-gender-tags-fast.mjs` | One-time migration, done |

### Why Python Instead of JavaScript?

- **Data science tooling**: `numpy`, `pandas`, `Counter` are more natural for data processing
- **Simpler async**: Python's `ThreadPoolExecutor` is easier to reason about than Node.js's event loop for batch scripts
- **Your background**: You know Python well; less cognitive overhead than writing Node.js scripts
- **No build step**: `.mjs` scripts import from `server/` TypeScript files, which require the TypeScript build to be current. Python scripts are self-contained.

### Running Old .mjs Scripts (If Needed)

If you ever need to run one of the old scripts:

```bash
# From the project root
node --experimental-vm-modules scripts/cleanup-cache.mjs

# Or, if they're already compiled:
node scripts/cleanup-cache.mjs
```

**Warning**: The `.mjs` scripts may have hardcoded database URLs or environment variable names that differ from the `.env.example`. Check them carefully before running.

---

## 11. Script Run Order for a Fresh Database

If you're setting up a completely new database (e.g., migrating from one Supabase project to another):

```bash
# Step 0: Set up the schema via Drizzle
# (from project root, not scripts/)
npm run db:push   # applies schema.ts to the new database

# Step 1: Enable pgvector extension
# Run this SQL in the Supabase dashboard or psql:
# CREATE EXTENSION IF NOT EXISTS vector;

# Step 2: Create the IVFFlat index after seeding (needs data first)
# We'll do this in Step 7.

# Step 3: Seed base listings
cd scripts/python
python seed.py

# Step 4: Tag gender on all listings
python retag_gender.py

# Step 5: Remove obvious junk
python purge_junk.py --delete

# Step 6: Generate embeddings
python reembed.py

# Step 7: Create IVFFlat index now that data exists
# Run this SQL (requires 300+ rows):
# CREATE INDEX ON depop_cache USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

# Step 8: Optional cleanup of dead listings
python cleanup.py --delete
```

### Why Create the Index After Seeding?

The IVFFlat index requires training data — it needs at least `lists × 3 = 300` rows with non-null embeddings to build correctly. If you create the index on an empty table and then insert data, PostgreSQL will build the index progressively but the bucket assignments won't be optimal. Better to insert all data first, then create the index in one shot.

---

## 12. Debugging Tips

### Testing Database Connection

```python
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()
try:
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM depop_cache")
    count = cursor.fetchone()[0]
    print(f"Connected! depop_cache has {count} rows")
    conn.close()
except Exception as e:
    print(f"Connection failed: {e}")
```

### Checking Embedding Coverage

```sql
-- How many rows have embeddings?
SELECT
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS has_embedding,
  COUNT(*) FILTER (WHERE embedding IS NULL) AS missing_embedding,
  COUNT(*) AS total
FROM depop_cache;
```

### Checking Gender Tag Distribution

```sql
-- What's the gender breakdown across all listings?
-- (Requires expanding the JSONB array)
SELECT
  listing->>'gender' AS gender,
  COUNT(*) AS count
FROM depop_cache,
     jsonb_array_elements(listings) AS listing
GROUP BY gender;
```

### Manually Inspecting a Cache Row

```python
import psycopg2
import json
import os

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cursor = conn.cursor()

cursor.execute(
    "SELECT query, listings, aesthetic, permanent, created_at FROM depop_cache WHERE query = %s",
    ("dark academia blazer women",)
)
row = cursor.fetchone()
if row:
    query, listings_json, aesthetic, permanent, created_at = row
    listings = listings_json  # psycopg2 auto-parses JSONB to Python
    print(f"Query: {query}")
    print(f"Aesthetic: {aesthetic}")
    print(f"Permanent: {permanent}")
    print(f"Created: {created_at}")
    print(f"Listings count: {len(listings)}")
    print(f"First listing: {json.dumps(listings[0], indent=2)}")
else:
    print("Row not found")
conn.close()
```

**Note**: psycopg2 automatically deserialises JSONB columns to Python dicts/lists, unlike the Node.js `postgres` package which returns strings. So `listings_json` is already a Python list when psycopg2 fetches it — no `json.loads()` needed.

### Checking for Depop API 403 (Cookie Test)

```python
import requests
import os

COOKIE = os.environ["COOKIE"]
DEVICE_ID = os.environ.get("DEVICE_ID", "")

response = requests.get(
    "https://api.depop.com/api/v3/search/products/",
    params={"q": "test", "limit": 1},
    headers={
        "Cookie": COOKIE,
        "depop-device-id": DEVICE_ID,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    timeout=10,
)

print(f"Status: {response.status_code}")
if response.status_code == 200:
    print("Cookie is valid!")
elif response.status_code == 403:
    print("Cookie expired — get a fresh cf_clearance from your browser")
else:
    print(f"Unexpected status: {response.text[:200]}")
```

Run this before starting `seed.py` to verify the cookie is still valid.
