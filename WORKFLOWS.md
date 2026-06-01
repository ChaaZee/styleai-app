# WORKFLOWS.md — Agentic Workflows for Stitch

Step-by-step workflows for common tasks on this project. Designed to be handed to an AI agent
(Perplexity Computer, Claude, etc.) with minimal back-and-forth. Each workflow includes what to
research, what to build, and how to verify it works before pushing.

---

## Table of Contents

1. [Adding a New Scraper](#1-adding-a-new-scraper)
2. [Research: Finding New Data Sources](#2-research-finding-new-data-sources)
3. [Seeding the Cache (Full Run)](#3-seeding-the-cache-full-run)
4. [Cleaning Up Dead Links](#4-cleaning-up-dead-links)
5. [Adding a New Aesthetic or Aesthetic Variant](#5-adding-a-new-aesthetic-or-aesthetic-variant)
6. [Adding a New Product Source to the App](#6-adding-a-new-product-source-to-the-app)
7. [Debugging a Broken API Endpoint](#7-debugging-a-broken-api-endpoint)
8. [Improving the Recommendation Algorithm](#8-improving-the-recommendation-algorithm)
9. [Adding a New App Feature](#9-adding-a-new-app-feature)
10. [Deploy & Verify](#10-deploy--verify)
11. [Weekly Cache Maintenance](#11-weekly-cache-maintenance)

---

## 1. Adding a New Scraper

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

---

## 2. Research: Finding New Data Sources

Use when I ask "find more fashion sites we could scrape" or "what other secondhand platforms exist".

### What to research
1. **Secondhand / resale platforms** — any site where individual sellers list clothing
   - Key question: does it have a public API or search endpoint?
   - Key question: does it ship to the US?
   - Examples to benchmark against: Depop, Grailed, Poshmark, Vinted, ThredUp, Mercari

2. **Brand Shopify stores** — independent fashion brands with public `/products.json`
   - Ideal: streetwear, minimalist, workwear, Y2K, vintage aesthetics
   - Already have: Civil Regime, MNML, Union LA, Carhartt WIP
   - Already know work: Volcom, Champion, RIPNDIP, Brixton, Cactus Plant Flea Market, Ksubi, Wax London

3. **Wholesale / fast fashion** — ASOS-style marketplaces with JSON APIs
   - Already have: ASOS, Pacsun
   - Candidates: SSENSE, Farfetch (luxury), Revolve, Urban Outfitters

### Research checklist for each candidate
- [ ] Shipping to US?
- [ ] Has a usable API or structured HTML?
- [ ] Can it be scraped without a paid account?
- [ ] Does it have a Shopify store? (test `site.com/products.json`)
- [ ] What aesthetics does it cover? (map to our 41-aesthetic taxonomy)
- [ ] Bot protection level? (None / basic / heavy Cloudflare / DataDome)
- [ ] Terms of service — does it prohibit scraping?

### Output format
Present findings as a table:
| Site | Type | API | Cookies needed | Aesthetics | Notes |
|------|------|-----|---------------|------------|-------|

---

## 3. Seeding the Cache (Full Run)

Use after deleting Depop listings, or when the cache needs a refresh.
Run all scripts in order on your home computer (not a server).

```powershell
# 1. Export what users have actually scanned (optional, helps prioritise queries)
python scripts/python/export_scanned_clothes.py

# 2. Run scrapers (order doesn't matter, but do all of them)
python scripts/python/scrape_shopify.py            # no cookies needed
python scripts/python/scrape_asos.py               # no cookies needed
python scripts/python/scrape_pacsun.py             # needs fresh Pacsun cookies
python scripts/python/scrape_grailed.py            # needs fresh Grailed cookies
python scripts/python/depop_seed.py                # needs fresh Depop cookies

# 3. Clean up junk
python scripts/python/purge_junk.py --delete       # remove low quality

# 4. Fix gender tags (re-run after any scrape)
python scripts/python/retag_gender.py

# 5. Generate embeddings (MUST be last — new items invisible until this runs)
python scripts/python/reembed.py
```

### Getting fresh cookies
For any scraper that needs cookies:
1. Open the site in Chrome
2. DevTools (F12) → Network tab
3. Refresh the page or browse for a moment
4. Click any request to the site's domain → Headers tab
5. Find the `cookie:` request header → copy the entire value
6. Paste into `COOKIE_RAW = ""` at the top of the script

Cookies expire. Depop `cf_clearance` lasts ~1 hour. If you get 403s, get fresh cookies.

### Checking cache health
```sql
-- Total listings by source
SELECT listing->>'_source' AS source, COUNT(*) AS count
FROM depop_cache, jsonb_array_elements(listings) AS listing
WHERE jsonb_typeof(listings) = 'array'
GROUP BY source ORDER BY count DESC;

-- Coverage by aesthetic
SELECT aesthetic, COUNT(*) AS rows,
       SUM(jsonb_array_length(listings)) AS total_listings
FROM depop_cache
WHERE jsonb_typeof(listings) = 'array'
GROUP BY aesthetic ORDER BY total_listings DESC;
```

---

## 4. Cleaning Up Dead Links

Use when users report dead/broken product links, or on a regular schedule.

```powershell
# Step 1: Get fresh Depop cookie (see "Getting fresh cookies" above)
# Step 2: Paste it into DEPOP_COOKIE = "" at top of cleanup.py

# Step 3: Dry run — see what would be removed
python scripts/python/cleanup.py

# Step 4: Review the output. If it looks right:
python scripts/python/cleanup.py --delete
```

**What cleanup.py checks:**
- Depop: searches for the product slug via the v3 API — if slug not in results, listing is dead
- ASOS: GET request, checks for 404 or redirect to ASOS homepage
- Shopify brands: hits `/products/{handle}.json` — 404 = dead
- Everything else: HEAD request, GET fallback

**Must run from your home computer** — cloud IPs get 403'd by retailer WAFs.

---

## 5. Adding a New Aesthetic or Aesthetic Variant

Use when I say "add X aesthetic" or "we need more Y content".

### Step 1 — Add seed queries
In `depop_seed.py`, find the `QUERIES` list and add new entries:
```python
("aesthetic name", "garment type", "gender", "depop search query"),
```

### Step 2 — Add to the aesthetic taxonomy (if it's a new aesthetic)
In `server/routes.ts`, find the `AESTHETICS` array (41 entries) and add the new label.
In `client/src/components/OnboardingModal.tsx`, add it to the Style Shuffle if it has outfit photos.

### Step 3 — Add female-only blocking if needed
In `server/storage.ts`, find `FEMALE_ONLY_AESTHETICS` and add the new aesthetic if it should
never appear for male users.

### Step 4 — Seed queries for the new aesthetic
```powershell
python scripts/python/depop_seed.py  # will pick up new queries
python scripts/python/reembed.py     # don't forget embeddings
```

---

## 6. Adding a New Product Source to the App

Use when I want a new site's products to appear in the recommendation UI (not just in the cache).

This is mostly automatic — the cache is source-agnostic. The `_source` field on each listing
drives the round-robin diversity bucketing in `getForYouRecommendations`.

The only things that need changing:
1. Add the new source to `detect_source()` in `cleanup.py` so dead links get checked correctly
2. If the source has a custom URL pattern for dead-link detection, add a `check_newsite()` function
3. Update `docs/SCRAPERS.md` with the new source

---

## 7. Debugging a Broken API Endpoint

Use when a feature stops working on the live app.

### Step 1 — Check Render logs
Go to https://dashboard.render.com → your service → Logs
Look for:
- `ERROR` or `Unhandled` lines near the time of the failure
- Postgres error codes (57014 = timeout, 42703 = column doesn't exist, 23505 = unique violation)
- Stack traces pointing to a file and line number

### Step 2 — Reproduce locally
```powershell
# Start the dev server
npm run dev

# Test the endpoint with curl
curl -X POST http://localhost:5000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Step 3 — Common fixes by error code
| Error | Cause | Fix |
|-------|-------|-----|
| `57014` | Postgres statement timeout | Defer slow queries, add `SET statement_timeout = 0` |
| `42703` | Column doesn't exist | Add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `initDB()` |
| `InvalidParameterValue` | `jsonb_array_length` on scalar | Filter in Python, not SQL |
| `23505` | Duplicate key on insert | Use `ON CONFLICT DO NOTHING` or `DO UPDATE` |
| `Received instance of Array` | jsonb serializer bug | Ensure `prepare: false` on postgres client |
| `403` from Depop | WAF block | Use Cloudflare Worker proxy or run from home IP |

### Step 4 — Test fix locally, then push
Never push a fix without testing it locally first.
```bash
git add <files>
git commit -m "fix: description of what was broken and how it's fixed"
git push origin main
```

---

## 8. Improving the Recommendation Algorithm

Use when I say "recommendations feel off" or "I keep seeing the same stuff".

### Current algorithm (for context)
1. Get user's taste clusters (k=3 centroids of liked item embeddings)
2. Query depop_cache by cosine distance per cluster
3. Merge, bucket by `_source`, round-robin interleave
4. Filter by gender, return top `limit` items
5. On every like/skip: update taste_vector with temporal decay (0.95), recompute clusters every 5 interactions

### Things worth trying
- **Increase k** — try k=5 clusters for users with many likes (> 20 interactions)
- **Source weighting** — let users implicitly signal source preference (if they always like ASOS, weight ASOS higher)
- **Recency of listings** — prefer newer scrapes over older ones (would need `scraped_at` timestamp)
- **Exploration vs exploitation** — occasionally surface items from outside the user's clusters (epsilon-greedy)
- **Negative signal** — skipped items should push the taste vector away, not just fail to move it toward

### When researching algorithm improvements
Look at:
- How Spotify's Discover Weekly works (collaborative filtering + content-based)
- How Pinterest's homefeed works (interest graphs + visual similarity)
- Papers on fashion recommendation systems (search: "fashion recommendation system cold start")

---

## 9. Adding a New App Feature

Use when I describe a new UI feature I want.

### Decision tree before writing any code
1. **Does this need a new DB column?**
   → Yes → add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to `initDB()` in `storage.ts`
   → Also update the relevant TypeScript interface in `storage.ts` and Drizzle schema in `schema.ts`

2. **Does this need a new API endpoint?**
   → Yes → add to `server/routes.ts`
   → Keep routes thin — all DB logic goes in `storage.ts`

3. **Does this touch the For You feed or recommendations?**
   → Check `getForYouRecommendations()` in `storage.ts`
   → Test with Chaz's real user ID: `u_2znaqxnrq49mp5y5r5g`

4. **Does this change the onboarding flow?**
   → `client/src/components/OnboardingModal.tsx`
   → Style Shuffle is Step 0, aesthetic picker is Step 1, gender is Step 2

### Frontend checklist
- [ ] New page → add to `client/src/pages/` and register route in `App.tsx`
- [ ] New component → add to `client/src/components/`
- [ ] Hash routing: use `<Link href="/new-page">` not `<a href="...">`
- [ ] No `localStorage` for server data — use `useQuery`/`apiRequest`
- [ ] Add `data-testid` attributes to interactive elements
- [ ] Test dark mode — everything must work with and without `.dark` class
- [ ] Pull-to-refresh: if the page has a feed, add `onRefresh` support

### Build and verify
```powershell
npm run build   # must pass with 0 TypeScript errors
npm run dev     # test locally at localhost:5000
```

---

## 10. Deploy & Verify

After any code change.

```bash
# 1. Build (catches TypeScript errors)
npm run build

# 2. Commit
git add <changed files>
git commit -m "type: description"

# 3. Push (triggers Render auto-deploy)
git push origin main

# 4. Wait ~8 minutes for Render deploy to complete
# Monitor: https://dashboard.render.com → Logs

# 5. Verify on live app
# Open https://shopstitch.app on your phone
# Test the specific feature you changed
```

### What to check after every deploy
- [ ] App loads (no white screen / JS error)
- [ ] Home page shows product cards
- [ ] Scan page loads camera
- [ ] Affiliate cards appear (Sovrn first, then Nexbie shoes)
- [ ] No new errors in Render logs

### Render-specific gotchas
- The server gets a new instance on every deploy — `initDB()` runs again
  → Index creation is deferred so it doesn't crash startup
- If the deploy fails, Render keeps the last working version running
- Cold starts take ~2s on the free plan — the loading screen covers this

---

## 11. Weekly Cache Maintenance

Run this once a week to keep the cache healthy.

```powershell
# 1. Clean dead links (Depop items sell fast)
# Get fresh Depop cookie first
python scripts/python/cleanup.py --delete

# 2. Remove junk listings (bad images, no price, etc.)
python scripts/python/purge_junk.py --delete

# 3. Re-seed Depop with fresh items for popular aesthetics
python scripts/python/depop_seed.py

# 4. Re-tag gender (in case retag logic improved)
python scripts/python/retag_gender.py

# 5. Reembed any new/changed listings
python scripts/python/reembed.py
```

Check cache health after:
```sql
SELECT COUNT(*) FROM depop_cache WHERE jsonb_typeof(listings) = 'array';
SELECT SUM(jsonb_array_length(listings)) FROM depop_cache WHERE jsonb_typeof(listings) = 'array';
```

Target: > 40,000 total listings across > 800 cache rows.

---

## Quick Reference: Credential Locations

| Credential | Where to find it | Used in |
|-----------|-----------------|---------|
| Depop cookie | Chrome DevTools → Network → any depop.com request → cookie header | `depop_seed.py`, `cleanup.py` |
| Pacsun cookie | Chrome DevTools → Network → any pacsun.com request → cookie header | `scrape_pacsun.py` |
| Grailed cookie | Chrome DevTools → Network → any grailed.com request → cookie header | `scrape_grailed.py` |
| DB URL | `.env` file or hardcoded at top of Python scripts | All Python scripts |
| OpenAI key | `.env` or top of `reembed.py` | `reembed.py` |
| Render dashboard | https://dashboard.render.com | Deploy logs, env vars |
| Supabase dashboard | https://supabase.com/dashboard | DB tables, SQL editor |
| Cloudflare dashboard | https://dash.cloudflare.com | Worker logs, env vars |

---

## Agent Instructions (for AI assistants running these workflows)

When given a task on this project:

1. **Read CLAUDE.md first** — understand the stack and my preferences
2. **Check existing code before writing new code** — the pattern is almost certainly already established somewhere
3. **Dry run before committing** — any destructive script should be tested with `--delete` flag absent
4. **Syntax check before pushing** — `python -W error -m py_compile script.py` or `npm run build`
5. **Write a clear commit message** — `type: what changed and why`
6. **Update docs if you add something new** — SCRAPERS.md for scrapers, relevant docs/ file for features
7. **Never push to `master`** — always `main`
8. **One thing at a time** — don't bundle unrelated changes in one commit
9. **If a DB query crashes** — check for the jsonb scalar bug before anything else
10. **If Depop returns 403 everywhere** — that's the WAF, not a code bug
