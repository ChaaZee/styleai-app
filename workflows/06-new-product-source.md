# 6. Adding a New Product Source to the App

Use when I want a new site's products to appear in the recommendation UI (not just in the cache).

This is mostly automatic — the cache is source-agnostic. The `_source` field on each listing
drives the round-robin diversity bucketing in `getForYouRecommendations`.

The only things that need changing:
1. Add the new source to `detect_source()` in `cleanup.py` so dead links get checked correctly
2. If the source has a custom URL pattern for dead-link detection, add a `check_newsite()` function
3. Update `docs/SCRAPERS.md` with the new source
