# Stitch — Python Scripts

These scripts help you manage the Depop listing cache that powers the Stitch app.
They all connect directly to the Supabase database.

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

**Requires your Depop cookie** (expires every ~1 hour):
1. Open [depop.com](https://www.depop.com) in Chrome and search for anything
2. DevTools (F12) → Network tab → find a GET to `www.depop.com/api/v3/search/products/`
3. Right-click → Copy as cURL → find the `-b "..."` value
4. Paste it into the `COOKIE = ""` line at the top of `seed.py`

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
