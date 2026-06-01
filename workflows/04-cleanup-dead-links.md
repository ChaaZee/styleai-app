# 4. Cleaning Up Dead Links

Use when users report dead/broken product links, or on a regular schedule.

```powershell
# Step 1: Get fresh Depop cookie (see "Getting fresh cookies" in the seed-cache workflow)
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
