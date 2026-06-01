# 5. Adding a New Aesthetic or Aesthetic Variant

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
