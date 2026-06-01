# CLAUDE.md — Stitch Project Context

This file is for AI assistants (Claude, Perplexity Computer, Gemini, etc.) working on this codebase.
Read this before writing any code or making any decisions.

---

## Who I Am

I'm a Computer Science undergraduate (AI concentration) at Michigan State University, building Stitch
as a real product while learning full-stack development. I'm comfortable in Python but still learning
JavaScript/TypeScript — I understand the concepts but sometimes need things explained in terms I know
(Flask ≈ Express, psycopg2 ≈ postgres.js, SQLAlchemy ≈ Drizzle). I work fast and ship often.

**My working style:**
- I like concise explanations alongside code — short inline comments, not essays
- I run scripts locally from `scripts/python/` on Windows (PowerShell), so paths use Windows
- I prefer dry-run defaults on any destructive script (`--delete` to apply)
- I always test before pushing — run a feedback loop until things work, then commit
- I push to `main` branch only (never `master`) on `ChaaZee/styleai-app`
- I'm cost-conscious: prefer cheaper AI models (Flash-Lite for Pass 1, Flash for Pass 2)
- When in doubt, ask me one specific question rather than making assumptions

---

## The App: Stitch

**Live URL:** https://shopstitch.app
**GitHub:** https://github.com/ChaaZee/styleai-app (branch: `main`)
**Deployed on:** Render.com ($7/month plan, auto-deploys ~8 min after push)
**Database:** Supabase Postgres (pgvector extension enabled)
**Custom domain:** shopstitch.app → Render CNAME

Stitch is a mobile-first fashion discovery app. Users upload an outfit photo, Gemini AI analyses
the style, and the app returns:
1. A full aesthetic breakdown (what they're wearing, what vibes it gives)
2. Matching secondhand clothing recommendations from the cache (Depop, ASOS, Pacsun, Shopify brands)
3. A personalised "For You" feed that learns from their likes over time

The target user is someone into fashion who wants to identify their aesthetic and find similar pieces
without paying full retail. Think Shazam but for clothes.

---

## What I Want the App to Be

### Core Experience
- **Scan** → Upload a photo (outfit, inspo pic, anything) → get a detailed style breakdown
- **For You** → A personalised feed of clothing recommendations that gets smarter as you like items
- **Discover** → A curated feed of aesthetic outfit inspo pulled from Reddit/Pinterest
- **Wardrobe** → Save and organise your own clothes
- **History** → See all past scans with the ability to delete them

### Recommendation Philosophy
- Recommendations should come from the cache only (no live scraping on user request)
- Diversity of sources matters — don't just recommend 10 things from one site
- Gender filtering is strict: women's-only aesthetics (Coquette, Soft Girl, etc.) never show to male users
- Recommendations should use semantic vector similarity, not keyword matching
- The For You feed uses multi-cluster taste vectors (k=3 clusters of liked items)

### Product Rules
- No Amazon or eBay product cards — only Depop, ASOS, Pacsun, Shopify brands for now
- Sovrn affiliate card always appears as the first card on the Fits tab
- Nexbie shoe cards (3 of them) appear at positions 2-4 after Sovrn
- When footwear is detected in an analysis, inject Nexbie shoe cards into results
- When displaying Depop items, always use the real title — never the slug

### Design System (non-negotiable)
- Background: `#F8F7FF` (White Rain) in light mode, `#0E0F16` in dark mode
- Primary/accent: `#5088B8` (Stitch blue)
- Dark mode is the default aesthetic — the whole app feels dark and editorial
- Fonts: Cormorant Garamond (display), Jost (labels/nav), DM Sans (body), Bebas Neue (logo only)
- The logo is always rendered as the SVG text "ST|TCH" with a diagonal line through the I — never a PNG

### Things I've Explicitly Asked For
- Pull-to-refresh on the home page
- Delete scans from history tab
- Delete liked items from wardrobe
- Gender blocking on female-only aesthetics
- "Keep adding Depop cards so there's wide variety for all aesthetics"
- After analysis → only show Depop cards from cache (no Amazon etc.)
- Track all pieces scanned to use as seed queries for more Depop cards
- Only Depop for secondhand (no eBay)
- Style Shuffle onboarding (swipe through outfits to seed taste vector before quiz)

---

## Tech Stack

### Frontend
- **React + Vite + TypeScript** — component-based, hot module reload in dev
- **Tailwind CSS + shadcn/ui** — utility-first styling, pre-built components
- **Wouter** with `useHashLocation` — hash-based routing (`/#/scan`, `/#/for-you`)
  - IMPORTANT: always use `<Router hook={useHashLocation}>` — not on `<Switch>`
- **TanStack Query** — all API calls go through `useQuery`/`useMutation`
  - Always use `apiRequest` from `@/lib/queryClient`, never raw `fetch()`
- **No localStorage for server data** — only React state or DB

### Backend
- **Express.js** on Node.js — single server handles both static files and API
- Port 5000 in development and production
- `server/routes.ts` — all API endpoints
- `server/storage.ts` — all database queries (Drizzle ORM + raw postgres.js)
- `server/index.ts` — entry point, middleware setup

### Database
- **Supabase Postgres** with pgvector extension
- Two ORM layers (intentional quirk):
  - Drizzle ORM for `scans`, `wardrobe_items`, `discover_cards` (defined in `shared/schema.ts`)
  - Raw `postgres.js` tagged templates for `depop_cache` and `user_profiles` (need vector columns Drizzle can't handle)
- Connection: `prepare: false` — required to avoid a bug with jsonb arrays on Render

### AI
- **Gemini 2.5 Flash-Lite** — Pass 1 (garment detection, cheap)
- **Gemini 2.5 Flash** — Pass 2 (aesthetic classification, smarter)
- **OpenAI text-embedding-3-small** — embeddings (1536 dimensions) for all vector columns
- Two-pass pattern: Flash-Lite identifies garments factually, Flash interprets aesthetic from those facts

### Python Scripts (run locally, not on server)
All in `scripts/python/`. Run from the project root on your local machine:
- `depop_seed.py` — seed Depop listings into cache (requires browser cookie)
- `cleanup.py` — remove dead/broken listing URLs (requires Depop cookie for Depop rows)
- `delete_depop.py` — bulk delete all Depop listings from cache
- `scrape_asos.py` — fetch ASOS products via JSON API (no cookies needed)
- `scrape_pacsun.py` — fetch Pacsun via Search-ShowAjax (requires browser cookies)
- `scrape_shopify.py` — fetch from Shopify stores via `/products.json` (no cookies)
- `scrape_grailed.py` — Grailed (requires cookies)
- `retag_gender.py` — re-apply gender tags to all cache rows
- `reembed.py` — generate OpenAI embeddings for all cache rows
- `purge_junk.py` — remove low-quality listings
- `export_scanned_clothes.py` — dump scan history to txt file

### Infrastructure
- **Cloudflare Worker** (`cloudflare-worker/worker.js`) — proxies requests to `webapi.depop.com`
  because Render's fixed IP gets blocked by Depop's WAF. Deployed with Wrangler.
- **Render.com** — auto-deploys from `main` branch push, ~8 minutes
- **Sovrn affiliate** — `https://sovrn.co/ccalx03` always pinned as first card
- **Nexbie/Awin** feed — `F3326.csv.zip` for shoe cards, publisher ID `2861005`

---

## Database Schema (Key Tables)

### `depop_cache` — the product catalogue
```sql
query        TEXT PRIMARY KEY   -- e.g. "streetwear oversized hoodie male"
listings     JSONB              -- array of listing objects (see format below)
aesthetic    TEXT               -- e.g. "Streetwear"
garment_type TEXT               -- "tops", "bottoms", "outerwear", "shoes", "accessories"
permanent    BOOLEAN            -- true = never expire
embedding    vector(1536)       -- OpenAI embedding of the query text
```

Each listing object in the `listings` JSONB array:
```json
{
  "title": "Vintage Nike Windbreaker",
  "price": "$45.00",
  "image": "https://...",
  "url": "https://www.depop.com/products/seller-vintage-nike-windbreaker-ab12/",
  "seller": "thrifted_fits",
  "slug": "seller-vintage-nike-windbreaker-ab12",
  "query": "streetwear windbreaker",
  "_gender": "male",
  "_source": "depop"
}
```

**Important**: Some rows have `listings` stored as a double-encoded JSON string (not a JSONB array).
Always parse defensively — never use `jsonb_array_length()` in SQL, filter in Python instead.

### `user_profiles` — personalisation
```sql
user_id           TEXT PRIMARY KEY
taste_vector      vector(1536)          -- average of all liked item embeddings
taste_clusters    jsonb DEFAULT '[]'    -- k=3 centroids for multi-cluster recs
interaction_count INTEGER DEFAULT 0
liked_ids         TEXT[]                -- query strings of liked cache rows
skipped_ids       TEXT[]
gender            TEXT                  -- "male", "female", "both"
onboarded         BOOLEAN
liked_items       jsonb                 -- {itemUrl: {likedAt: timestamp}}
```

### `scans` — scan history
```sql
id             SERIAL PRIMARY KEY
image_data     TEXT          -- base64 encoded image
aesthetic      TEXT          -- e.g. "Streetwear"
confidence     INTEGER       -- 0-100
style_breakdown TEXT
occasions      TEXT
key_pieces     TEXT
color_palette  TEXT
results        TEXT          -- JSON string of Depop results
device_id      TEXT          -- localStorage UUID, no login required
depop_queries  TEXT          -- JSON array of queries used for this scan
created_at     TIMESTAMP
```

### `scanned_pieces` — clothing piece tracker
```sql
piece        TEXT
aesthetic    TEXT
garment_type TEXT
scan_count   INTEGER
last_seen_at TIMESTAMPTZ
PRIMARY KEY (piece, aesthetic)
```
This table feeds `seed-trending` — it knows what real users are actually scanning so the seed
job can fetch more of what matters.

---

## Gender System

Gender filtering is one of the most important correctness requirements.

### Detection (in `storage.ts` and Python scripts)
```
EXPLICIT_FEMALE = /\b(women[''']?s?|woman|womans|ladies|lady|girls?|female|womenswear)\b/i
EXPLICIT_MALE   = /\b(men[''']?s?|man|male|boys?|menswear)\b/i

hasFem && !hasMasc  → "female"
hasMasc && !hasFem  → "male"
else                → "both"
```

**Critical rule**: Use the real product title to detect gender. Brand names never determine gender.
If the title doesn't say women's/men's explicitly, tag it "both".
Watch for apostrophes: match "women's", "women's", "mens'", "men's" (both curly and straight).

### Female-only aesthetics (never show to male users)
Coquette, Soft Girl, Cottagecore, Coastal Grandmother, E-Girl, Clean Girl, Balletcore, Romantic, Fairycore

---

## Recommendation Algorithm

### For You Feed (`getForYouRecommendations`)
1. Fetch user's `taste_clusters` (k=3 centroids). Falls back to single `taste_vector` if < 6 liked items.
2. For each cluster centroid, query `depop_cache` for closest embeddings by cosine distance.
3. Bucket results by `_source` (depop, asos, pacsun, shopify).
4. Round-robin interleave across sources so no single site dominates.
5. Apply gender filter based on user's stored gender preference.

### Temporal Decay (on every like/skip)
```
decay = 0.95
effectiveOldWeight = interactionCount * decay
newVector = (oldVector * effectiveOldWeight + newItemEmbedding * weight) / totalWeight
```
Recent likes matter more than old ones. Clusters are recomputed every 5 interactions.

### After Outfit Analysis
- Build queries from detected garments + aesthetic
- Pull matching rows from `depop_cache` using semantic similarity (embedding `<=>` operator)
- Filter by gender, apply source diversity
- Pin Sovrn card first, Nexbie shoe cards at 2-4 if footwear detected

---

## Style Shuffle (Onboarding Cold Start)

New users who haven't liked anything yet get shown 16 outfit photos (one per aesthetic) in a
Tinder-style swipe interface before the aesthetic quiz. Liked aesthetics pre-populate the quiz
picker (capped at 4). This seeds the taste vector before the first real scan.

Component: `client/src/components/OnboardingModal.tsx` — Step 0 before the aesthetic picker.

---

## Affiliate Integration

### Sovrn
- Always the **first card** on the Fits tab and in analysis results
- Image: `/affiliate-product.jpg`
- Link: `https://sovrn.co/ccalx03`

### Nexbie (Awin)
- **3 shoe cards pinned at positions 2-4** on Fits tab
- Also injected into analysis results when footwear is detected
- Feed URL: `https://ui.awin.com/productdata-darwin-download/publisher/2861005/4341c6f7acfebebd9f1ae032e0329295/1/feed/F3326.csv.zip`
- Awin Publisher ID: `2861005`

---

## Known Gotchas

### Database
- `jsonb_array_length()` crashes on rows where `listings` is a double-encoded string. Always filter in Python, never in SQL.
- `depop_cache` has no `updated_at` column — don't add it to upserts.
- Drizzle's `.get()` / `.all()` pattern is **synchronous** — don't destructure queries directly.
- Always use `prepare: false` on the postgres.js client (Render jsonb serializer bug).

### Indexes
- `CREATE INDEX ... USING ivfflat` on 40k+ rows takes 30-60 seconds.
- Supabase's statement_timeout will kill it mid-build and crash the server (error code 57014).
- All index creation is deferred to a `setTimeout(5s)` fire-and-forget in `initDB()` using `client.reserve()`.

### Depop API
- Depop's WAF blocks all cloud IPs (Render, servers) with 403.
- The only way to hit Depop from a server is through the Cloudflare Worker proxy.
- Cleanup scripts that check if Depop URLs are live **must** run from your home computer with a browser cookie.
- `cleanup.py` requires `DEPOP_COOKIE` to check Depop URLs. Without it, Depop rows are skipped.

### Frontend
- Hash routing: all links use `/#/path`. Never use `href="#section"` for in-page scrolls — it breaks routing. Use `scrollIntoView()` instead.
- `localStorage` is fine for client preferences (theme, user ID). Not for server data.
- Dark mode class is set on `document.documentElement` in a synchronous `<script>` in `index.html` to prevent flash.

### Build
- `npm run build` → `dist/index.cjs` (server) + `dist/public/` (frontend)
- `dist/` is gitignored — never commit it
- Render runs `npm run build` automatically on deploy

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Render + local `.env` | Supabase Postgres connection |
| `GEMINI_API_KEY` | Render | Google AI Studio |
| `OPENAI_API_KEY` | Render + scripts | OpenAI embeddings |
| `WORKER_URL` | Render | Cloudflare Worker endpoint |
| `WORKER_SECRET` | Render + Worker | Shared auth secret |
| `DEPOP_COOKIE` | Local scripts only | Browser cookie for Depop API |
| `NODE_ENV` | Render | Set to `"production"` |

For Python scripts, credentials are hardcoded at the top of each file (not great, but pragmatic
for local dev tools that never run on a server).

---

## Git Conventions

- Branch: always `main` (never `master`)
- Commit format: `type: short description` e.g. `fix:`, `feat:`, `scripts:`, `docs:`
- Push with `git push origin main`
- Render auto-deploys ~8 minutes after push
- The CRON job runs every Monday 7:39 AM UTC: hits `/api/seed-trending`

---

## File Map (Quick Reference)

```
styleai-app/
├── client/
│   ├── index.html              # entry point — theme init script here
│   ├── public/
│   │   ├── manifest.json       # PWA manifest
│   │   ├── sw.js               # Service worker (PWA install prompt)
│   │   ├── icon-192.png        # App icon
│   │   └── icon-512.png        # App icon (large)
│   └── src/
│       ├── App.tsx             # Router, TopBar, LoadingScreen
│       ├── main.tsx            # Entry point, SW registration
│       ├── index.css           # Tailwind + CSS variables (White Rain / dark theme)
│       ├── components/
│       │   ├── NavBar.tsx      # Bottom navigation bar
│       │   ├── InstallPrompt.tsx  # iOS/Android PWA install overlay
│       │   └── OnboardingModal.tsx # Style Shuffle + aesthetic quiz
│       └── pages/
│           ├── home.tsx        # For You feed + affiliate cards
│           ├── scan.tsx        # Camera/upload page
│           ├── results.tsx     # Analysis results + product cards
│           ├── history.tsx     # Scan history with delete
│           ├── wardrobe.tsx    # Saved items
│           ├── profile.tsx     # Gender pref, taste vector info
│           ├── discover.tsx    # Reddit-sourced outfit inspo
│           ├── forYou.tsx      # Personalised product feed
│           ├── howItWorks.tsx  # Explainer page
│           └── styleQuiz.tsx   # Aesthetic picker
├── server/
│   ├── index.ts                # Express setup, middleware, initDB()
│   ├── routes.ts               # ALL API endpoints
│   ├── storage.ts              # ALL DB queries + vector helpers
│   └── static.ts               # Serves built frontend in production
├── shared/
│   └── schema.ts               # Drizzle table definitions (scans, wardrobe, discover)
├── cloudflare-worker/
│   ├── worker.js               # Depop proxy worker
│   └── README.md               # How to deploy with Wrangler
├── scripts/python/             # Local maintenance scripts (run on your PC)
│   ├── README.md
│   ├── depop_seed.py
│   ├── cleanup.py
│   ├── delete_depop.py
│   ├── scrape_asos.py
│   ├── scrape_pacsun.py
│   ├── scrape_shopify.py
│   ├── scrape_grailed.py
│   ├── retag_gender.py
│   ├── reembed.py
│   ├── purge_junk.py
│   └── export_scanned_clothes.py
└── docs/
    ├── OVERVIEW.md             # Architecture deep-dive
    ├── AI.md                   # Gemini + embeddings + recommendation system
    ├── SCRAPERS.md             # All scraper docs + how to add new ones
    ├── SCRIPTS.md              # Maintenance script reference
    ├── DATABASE.md             # Schema reference
    ├── BACKEND.md              # Express routes reference
    └── FRONTEND.md             # React component reference
```
