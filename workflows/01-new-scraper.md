# 1. Adding a New Scraper

Use when I ask "can you web scrape X" for a new fashion site.

### Step 1 — Research the site's API
Browse the site in Chrome, open DevTools → Network → Fetch/XHR tab.
Navigate to a product listing page. Look for:
- JSON responses containing product arrays (title, price, image, url fields)
- Pagination parameters (page=, offset=, start=, cursor=, etc.)
- Whether requests work in an Incognito tab (no cookies) — if yes, no cookies needed

Key things to check:
- Does the site use a Shopify store? Test `https://site.com/products.json` — if it returns JSON, use `scrape_shopify.py` as template.
- Does the site have bot protection (PerimeterX, Cloudflare, DataDome)? If yes, requires browser cookies.
- Is there a public search/category API that returns JSON? (Like ASOS's `/api/product/search/v2/categories/{id}`)

### Step 2 — Find the right endpoint
```
DevTools → Network → Filter: Fetch/XHR
Scroll through the product grid in the browser
Find the request that returns product data as JSON
Right-click → Copy as cURL
```
Paste the cURL into the chat so the agent can see the exact headers, cookies, and params.

### Step 3 — Write the scraper
Template structure every scraper must follow:
```python
DB_URL = "postgresql://..."
COOKIE_RAW = ""  # paste if needed

def load_existing_urls(conn) -> set:
    # Returns all URLs already in depop_cache to avoid duplicates

def fetch_products(query, page, ...) -> list[dict]:
    # Hits the API, returns list of raw product dicts

def parse_listing(raw) -> dict | None:
    # Converts raw → standard listing format:
    # { title, price, image, url, seller, slug, query, _gender, _source }

def upsert_to_db(conn, query_key, aesthetic, garment_type, gender, listings):
    # INSERT INTO depop_cache ... ON CONFLICT DO UPDATE (append listings)

def main():
    # Loop over categories/queries, fetch, parse, upsert
    # Stop when: page returns 0 results, or 2 consecutive pages with 0 new items
```

Gender tagging rule (critical — check this before pushing):
```python
import re
FEMALE = re.compile(r"\b(women[''']?s?|woman|ladies|lady|girls?|female|womenswear)\b", re.I)
MALE   = re.compile(r"\b(men[''']?s?|man|male|boys?|menswear)\b", re.I)

def tag_gender(title):
    has_f = bool(FEMALE.search(title))
    has_m = bool(MALE.search(title))
    if has_f and not has_m: return "female"
    if has_m and not has_f: return "male"
    return "both"
```

### Step 4 — Dry run first
```powershell
python scripts/python/scrape_newsite.py  # no --commit flag → prints without saving
```
Check that:
- At least one page of products is returned
- Titles look real (not slugs or IDs)
- Prices are formatted as `$XX.XX`
- Images are accessible URLs (open one in browser to verify)
- Gender tags look correct for a sample of titles

### Step 5 — Commit the run
```powershell
python scripts/python/scrape_newsite.py --commit
```

### Step 6 — Reembed
```powershell
python scripts/python/reembed.py
```
New items won't appear in recommendations until they have embeddings.

### Step 7 — Add to docs
Add a section in `docs/SCRAPERS.md` describing:
- Whether cookies are needed and how to get them
- The endpoint it hits
- Any pagination quirks
- Config options at the top of the file

### Step 8 — Commit and push
```bash
git add scripts/python/scrape_newsite.py docs/SCRAPERS.md
git commit -m "scripts: add scrape_newsite.py scraper"
git push origin main
```
