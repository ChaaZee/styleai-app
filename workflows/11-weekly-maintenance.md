# 11. Weekly Cache Maintenance

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
