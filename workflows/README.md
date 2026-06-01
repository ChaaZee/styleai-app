# Workflows — Agentic Workflows for Stitch

Step-by-step workflows for common tasks on this project. Designed to be handed to an AI agent
(Perplexity Computer, Claude, etc.) with minimal back-and-forth. Each workflow includes what to
research, what to build, and how to verify it works before pushing.

---

## Index

1. [Adding a New Scraper](01-new-scraper.md)
2. [Research: Finding New Data Sources](02-research-data-sources.md)
3. [Seeding the Cache (Full Run)](03-seed-cache.md)
4. [Cleaning Up Dead Links](04-cleanup-dead-links.md)
5. [Adding a New Aesthetic or Aesthetic Variant](05-new-aesthetic.md)
6. [Adding a New Product Source to the App](06-new-product-source.md)
7. [Debugging a Broken API Endpoint](07-debug-api.md)
8. [Improving the Recommendation Algorithm](08-improve-recommendations.md)
9. [Adding a New App Feature](09-new-feature.md)
10. [Deploy & Verify](10-deploy-verify.md)
11. [Weekly Cache Maintenance](11-weekly-maintenance.md)

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
