# Stitch — Python Scripts

These scripts help you manage the Depop listing cache that powers the Stitch app.
They all connect directly to the Supabase database.

---

## Environment Variables

Scripts read their credentials from environment variables — nothing is hardcoded.

- **`DEPOP_COOKIE`** — required for the Depop scripts (`depop_seed.py`, `cleanup.py`,
  `fix_depop_titles.py`). Get it from DevTools → Network → any `depop.com` request →
  copy the `cookie:` header value. Set it in PowerShell with:
  ```powershell
  $env:DEPOP_COOKIE = Get-Content "cookie.txt" -Raw
  ```
  If it's unset, each Depop script prints `[warn] DEPOP_COOKIE env var not set` at
  startup and Depop API calls may fail (the WAF blocks cookieless requests).
- **`DATABASE_URL`** — optional. Defaults to the Supabase connection string already
  baked into each script, so you only need to set it to point at a different database.

---

## Setup (run once)

```powershell
pip install requests psycopg2-binary openai
```

---

## Scripts

### `seed.py` — Add fresh listings to the cache

Searches Depop for a list of queries and saves the results to the database.
Run this whenever you want to add new listings or refresh stale ones.

**Requires the `DEPOP_COOKIE` env var** (cookie expires every ~1 hour):
1. Open [depop.com](https://www.depop.com) in Chrome and search for anything
2. DevTools (F12) → Network tab → find a GET to `www.depop.com/api/v3/search/products/`
3. Right-click → Copy as cURL → find the `-b "..."` value
4. Set it as `DEPOP_COOKIE` (see [Environment Variables](#environment-variables))

```powershell
python scripts/python/seed.py
```

To add new search queries, edit the `SEED_QUERIES` list in the file.

---

### `cleanup.py` — Remove dead/sold listings

Checks every cached listing URL and removes any that return 404 (deleted/sold).

> ⚠️ **Run this from your home internet** — Depop blocks server IPs with 403.
> Running locally gets real 200/404 responses.

```powershell
# Dry run first — see what would be removed
python scripts/python/cleanup.py

# Actually remove dead listings
python scripts/python/cleanup.py --delete
```

---

### `fix_depop_titles.py` — Replace slug titles with real Depop titles

Some Depop listings have a URL slug as their title (e.g. `vintage-nike-hoodie-abc123`)
instead of the real one (`Men's Vintage Nike Hoodie Size M`). This fetches the real
title from the Depop product detail API and updates the cache.

No cookie required for product detail fetches (but `DEPOP_COOKIE` is supported if the
WAF ever demands one). Rate-limited to ~0.3s between calls.

```powershell
# Dry run first — see what would change
python scripts/python/fix_depop_titles.py

# Actually write the corrected titles
python scripts/python/fix_depop_titles.py --apply
```

---

### `tag_sources.py` — Backfill the `_source` field from listing URLs

Every listing carries a `_source` field ("depop", "asos", "pacsun", "grailed",
"vinted", "shopify") used for source-diversity in recommendations. Older listings
predate this field and a few have the wrong value. This script detects the source
from each listing's URL and fills in any that are missing or `"unknown"`, and warns
+ corrects any that disagree with the URL.

No cookie required — it only reads URLs already in the cache.

```powershell
# Dry run first — see what would change
python scripts/python/tag_sources.py

# Actually write the source tags
python scripts/python/tag_sources.py --apply
```

---

### `retag_gender.py` — Fix gender tags on listings

Every listing has a `_gender` field ("male", "female", or "both") that controls
which users see it. Run this if:
- You seeded new listings and want to make sure gender is correct
- You changed the gender detection logic
- Wrong-gendered clothes are appearing in the app

```powershell
python scripts/python/retag_gender.py
```

---

### `reembed.py` — Regenerate search embeddings

Each cache row has a vector embedding used for semantic recommendations.
Run this after seeding new listings so they show up in recommendations.

Cost: ~$0.01 for all rows (very cheap).

```powershell
python scripts/python/reembed.py
```

---

### `purge_junk.py` — Remove non-clothing items

Removes listings that are clearly not clothing (trading cards, phone cases, etc.)
and spam listings that appear in too many rows.

```powershell
# Dry run — see what would be removed
python scripts/python/purge_junk.py

# Actually remove junk
python scripts/python/purge_junk.py --delete
```

---

### `export_scanned_clothes.py` — Export what users have actually scanned

Reads every outfit scan in the database and extracts the clothing items
Gemini detected. Saves them to two files:

- `scanned_clothes.txt` — plain list, one item per line (read by scraper scripts)
- `scanned_clothes_stats.txt` — same list with scan counts (for your reference)

Run this before running the scraper scripts so they search for items
your users actually wear instead of a hardcoded list.

```powershell
python scripts/python/export_scanned_clothes.py
```

---

### `scrape_shopify.py` — Fetch products from Shopify brands (no cookies needed)

Fetches products from Civil Regime, MNML, and Union LA using Shopify's free
public API. Works from any machine — no cookies, no bot protection.
Add any other Shopify brand by adding their domain to `SHOPIFY_STORES`.

```powershell
python scripts/python/scrape_shopify.py
```

---

### `scrape_pacsun.py` — Fetch products from Pacsun (requires cookies)

Scrapes Pacsun search results for clothing items. Requires fresh browser
cookies — run locally, NOT from the Render server.

```powershell
python scripts/python/scrape_pacsun.py
```

---

### `scrape_asos.py` — Fetch products from ASOS (requires cookies)

Fetches ASOS listings from their Next.js embedded JSON data.
Requires fresh browser cookies — run locally only.

```powershell
python scripts/python/scrape_asos.py
```

---

### `scrape_grailed.py` — Fetch listings from Grailed (requires cookies)

Hits Grailed's internal search API to pull secondhand/designer menswear.
Requires fresh browser cookies — run locally only.

```powershell
python scripts/python/scrape_grailed.py
```

---

## Recommended workflow after seeding

Run these in order after adding new listings:

```powershell
# 1. Seed new listings
python scripts/python/seed.py

# 2. Remove junk (non-clothing items)
python scripts/python/purge_junk.py --delete

# 3. Fix gender tags
python scripts/python/retag_gender.py

# 4. Regenerate embeddings so new listings appear in recommendations
python scripts/python/reembed.py
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `HTTP 403` in seed.py | Cookie expired — grab a fresh one from DevTools |
| `connection refused` | Check your internet connection |
| `ssl error` | Normal — the DB uses SSL, should work automatically |
| `openai.AuthenticationError` | Check your OpenAI API key in reembed.py |
