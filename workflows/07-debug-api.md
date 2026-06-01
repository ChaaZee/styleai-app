# 7. Debugging a Broken API Endpoint

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
