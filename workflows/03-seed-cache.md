# 3. Seeding the Cache (Full Run)

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
