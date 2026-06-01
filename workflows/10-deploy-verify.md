# 10. Deploy & Verify

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
