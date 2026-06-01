# Scrapers Guide

All scraper scripts live in `scripts/python/`. They populate the `depop_cache` table which powers the Stitch recommendation feed.

## Recommended Run Order

```powershell
python scripts/python/export_scanned_clothes.py   # exports scan history to txt
python scripts/python/scrape_shopify.py            # no cookies needed
python scripts/python/scrape_pacsun.py             # needs browser cookies
python scripts/python/scrape_grailed.py            # needs browser cookies
python scripts/python/scrape_asos.py               # no cookies needed
python scripts/python/purge_junk.py --delete       # removes low-quality listings
python scripts/python/retag_gender.py              # re-applies gender tags
python scripts/python/reembed.py                   # generates OpenAI embeddings
```

Run `reembed.py` last — embeddings are what the recommendation system actually searches against. Scraping without embedding means new items won't appear in the for-you feed.

---

## Existing Scrapers

### scrape_asos.py — No cookies needed
Uses ASOS's internal product search JSON API directly.

**API endpoint:**
```
GET https://www.asos.com/api/product/search/v2/categories/{category_id}
    ?offset=0&limit=72&store=US&lang=en-US&currency=USD
```

**Important:** The API category IDs are different from the `cid=` values in page URLs. Use DevTools to find the correct API ID:
1. Go to `asos.com/us/men/` or `/us/women/` and click a category
2. Open DevTools → Network → Fetch/XHR
3. Look for a request to `/api/product/search/v2/categories/XXXXXX`
4. That number is the API category ID

**Known working category IDs (confirmed June 2026):**

| Category | API ID |
|---|---|
| Mens hoodies | 5668 |
| Mens t-shirts | 7616 |
| Mens jackets | 3606 |
| Mens jeans | 4208 |
| Mens shirts | 3602 |
| Mens knitwear | 7617 |
| Mens shorts | 7078 |
| Mens tracksuits | 26776 |
| Mens sneakers | 5775 |
| Womens tops | 4174 |
| Womens dresses | 8799 |
| Womens jeans | 4176 |
| Womens trousers | 4177 |
| Womens skirts | 4175 |
| Womens jackets | 4330 |
| Womens shoes | 4209 |

**Config:**
```python
MAX_ITEMS_PER_CATEGORY = 10000  # set high to exhaust each category
DELAY_SECS = 1.5
```

---

### scrape_pacsun.py — Needs browser cookies
Uses Pacsun's `Search-ShowAjax` endpoint which returns HTML product tiles per page.

**API endpoint:**
```
GET /on/demandware.store/Sites-pacsun-Site/default/Search-ShowAjax
    ?cgid=mens-clothing&page=0&selectedUrl=...
```

**Getting cookies:**
1. Go to `pacsun.com` in Chrome and browse around for a moment
2. DevTools (F12) → Network → any request → Headers → copy the full `cookie:` value
3. Paste into `COOKIE_RAW = ""` at the top of the script
4. Windows CMD cURL escaping (`^%^`, `^"`) is cleaned automatically

**Why cookies are required:** Pacsun uses PerimeterX bot protection which blocks datacenter IPs. You must run this from your home computer, not a server.

**Pagination:** Stops automatically when:
- A page returns fewer than 24 products (last page)
- 2 consecutive pages have zero new products (all already cached)

**Config:**
```python
MAX_PAGES_PER_CATEGORY = 999  # effectively unlimited
DELAY_SECS = 2.0              # higher delay to avoid bot detection
```

---

### scrape_shopify.py — No cookies needed
Shopify stores expose a public products JSON API at `/products.json`.

**API endpoint:**
```
GET https://{store_domain}/products.json?limit=250&page=1
```

No authentication required — this is a standard Shopify public endpoint.

**Configured brands:**

| Brand | Domain | Aesthetic | Gender |
|---|---|---|---|
| Civil Regime | civilregime.com | Streetwear | both |
| MNML | mnml.la | Minimalist | male |
| Union LA | unionlosangeles.com | Streetwear | both |
| Carhartt WIP | shop.carhartt-wip.com | Workwear | both |

**Adding a new Shopify brand:**
1. Verify the brand uses Shopify: go to `brandname.com/products.json` — if it returns JSON, it works
2. Add an entry to the `BRANDS` list in `scrape_shopify.py`:
```python
("www.brandname.com", "Brand Name", "Aesthetic", "male/female/both"),
```

**Other confirmed working Shopify brands (not yet added):**
Volcom, Champion, Kappa, RIPNDIP, Brixton, Cactus Plant Flea Market, Ksubi, Wax London, Outerknown, I.AM.GIA, Aelfric Eden

---

### scrape_grailed.py — Needs browser cookies
Grailed is a luxury/streetwear resale platform. Requires cookies due to bot protection.

**Getting cookies:** Same process as Pacsun — copy from DevTools Network tab.

---

## Adding a New Scraper

If you want to add a scraper for a new site, here's the pattern every scraper follows:

### 1. Check the site's API
Open DevTools → Network → Fetch/XHR while browsing the site. Look for:
- JSON responses with product arrays (title, price, image, url fields)
- Pagination parameters (`page=`, `offset=`, `start=`, `cursor=`)
- Whether requests work without cookies (try in a private/incognito window)

### 2. Script structure
Every scraper has the same structure:

```python
# 1. Config at top
DB_URL = "postgresql://..."
COOKIE_RAW = ""  # if needed

# 2. load_existing_urls(conn) — dedup check
# Returns a set of all URLs already in depop_cache
# Check this before inserting to avoid duplicates

# 3. Fetch function — hits the API, returns raw product data

# 4. Parse function — converts raw data to listing format:
listing = {
    "title": "...",      # real product title (not slug)
    "price": "$XX.XX",
    "image": "https://...",
    "url": "https://...",
    "seller": "brand-name",
    "slug": "product-slug",
    "query": label,      # the search label / category name
    "_gender": "male" | "female" | "both",
    "_source": "sitename",  # used for feed diversity bucketing
}

# 5. upsert_to_db(conn, query_key, aesthetic, garment_type, gender, listings)
# Inserts into depop_cache with ON CONFLICT DO UPDATE (appends listings)
```

### 3. depop_cache schema
```sql
query        TEXT PRIMARY KEY   -- unique key per category/query
listings     JSONB              -- array of listing objects
aesthetic    TEXT               -- e.g. "Streetwear"
garment_type TEXT               -- "tops", "bottoms", "outerwear", "shoes", "accessories"
permanent    BOOLEAN            -- true = keep forever, false = can be purged
embedding    vector(1536)       -- OpenAI embedding of the query text (run reembed.py after)
```

### 4. Gender tagging
Set `_gender` in each listing based on the product title:
- Contains "women's", "womens", "ladies", "girls", "female" → "female"
- Contains "men's", "mens", "boys", "male" → "male"
- Otherwise → "both"

The `retag_gender.py` script can re-apply this logic to all existing cache rows after the fact.

### 5. After scraping
Always run in this order after adding new products:
```powershell
python scripts/python/purge_junk.py --delete   # remove garbage listings
python scripts/python/retag_gender.py           # fix gender tags
python scripts/python/reembed.py                # generate embeddings (REQUIRED for recommendations)
```

Without embeddings, new items will never appear in the for-you feed — the recommendation system uses vector similarity search, not text search.

---

## Troubleshooting

**"psycopg2.errors.InvalidParameterValue: cannot extract elements from a scalar"**
The `listings` column has a non-array value in some rows. Fixed by the `jsonb_typeof(listings) = 'array'` guard in `load_existing_urls()`.

**"psycopg2.errors.UndefinedColumn: column updated_at does not exist"**
The `depop_cache` table has no `updated_at` column. Remove any reference to it from upsert queries.

**403 Forbidden on every request**
Cookies are expired. Go back to the site in Chrome, browse for a minute, and copy fresh cookies from DevTools.

**"✗ No __NEXT_DATA__ found on page"**
The site loads products client-side via JavaScript, not server-side rendering. You need to find their XHR/Fetch API endpoint instead of parsing HTML. Open DevTools → Network → Fetch/XHR while the product grid loads.

**Script runs but inserts 0 new products**
All products are already in the cache (dedup is working correctly). Check with:
```sql
SELECT COUNT(*) FROM depop_cache WHERE query LIKE '%yoursite%';
```
