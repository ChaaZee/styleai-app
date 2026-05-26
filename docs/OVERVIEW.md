# Stitch — Architecture Overview

Stitch is a fashion discovery web app at [shopstitch.app](https://shopstitch.app). Users upload an outfit photo, Gemini AI analyses it in two passes, and the app returns a style breakdown plus matching Depop product recommendations. Over time, the app learns each user's taste through a 1536-dimension vector built from their interactions.

---

## Architecture Diagram (ASCII)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER'S BROWSER                             │
│                                                                     │
│   React + TypeScript (Vite)   ←── hash routing (wouter) ───→       │
│   Pages: Home, Scan, Results, History, Profile, Discover, ForYou   │
│                                                                     │
│   localStorage: device_id, user_id, stitch_profile, style_vector   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │  HTTPS  (same origin — port 5000)
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    RENDER.COM (Node.js / Express)                   │
│                                                                     │
│   server/index.ts   ← entry point, middleware, port 5000           │
│   server/routes.ts  ← ALL API endpoints (~3000 lines)              │
│   server/storage.ts ← ALL database queries + vector helpers        │
│   server/static.ts  ← serves built React app in production         │
│                                                                     │
│   Dev mode: Vite HMR (server/vite.ts) instead of static.ts         │
└──────┬───────────────────┬──────────────────┬───────────────────────┘
       │                   │                  │
       ▼                   ▼                  ▼
┌──────────────┐  ┌────────────────┐  ┌─────────────────────┐
│ SUPABASE     │  │ GOOGLE GEMINI  │  │ OPENAI              │
│ Postgres     │  │                │  │                     │
│              │  │ Flash-Lite     │  │ text-embedding      │
│ pgvector ext │  │ (Pass 1)       │  │ -3-small            │
│              │  │                │  │ 1536-dim vectors    │
│ Tables:      │  │ Flash          │  │                     │
│  scans       │  │ (Pass 2)       │  │ Used for:           │
│  depop_cache │  │                │  │  • depop_cache      │
│  user_profiles│  └────────────────┘  │    embeddings      │
│  discover_cards│                     │  • user taste vec  │
│  wardrobe_items│                     │  • discover card   │
└──────────────┘                     │    embeddings      │
                                     └─────────────────────┘
       │
       ▼
┌───────────────────────────────┐
│   CLOUDFLARE WORKER           │
│   (depop-proxy)               │
│                               │
│   POST /fetch → proxies to    │
│   webapi.depop.com            │
│   Bypasses CF bot detection   │
│   that blocks Render's IPs    │
└───────────────────────────────┘
```

---

## How All Parts Connect

### The Single Server Pattern

One of the most important things to understand: **there is only one server**. In Python web development, you often have a separate frontend build step and a separate API server. Stitch uses a single Express server on port 5000 that does both:

- In **production**: Express serves the compiled React app as static files (`dist/public/`) AND handles all `/api/*` routes.
- In **development**: Vite's dev server runs as middleware inside Express, enabling Hot Module Replacement (HMR) while the API routes work identically.

```
Browser → GET /           → Express → serves dist/public/index.html
Browser → GET /assets/*.js → Express → serves dist/public/assets/
Browser → POST /api/analyze → Express → runs Gemini AI logic → returns JSON
```

This is equivalent to Flask serving both static files and API endpoints from the same `app.run()`.

### Database Access Pattern

The server connects to Supabase Postgres in two ways, which is a quirk worth understanding:

1. **Drizzle ORM** (`db = drizzle(client)`) — used for the three tables defined in `shared/schema.ts` (`scans`, `wardrobe_items`, `discover_cards`). Think of Drizzle like SQLAlchemy: you define table schemas as TypeScript objects, and Drizzle generates type-safe SQL for you.

2. **Raw SQL** (`client\`SELECT ...\``) — used for `depop_cache` and `user_profiles`, which have `vector` columns that Drizzle doesn't yet support natively. The backtick syntax is a PostgreSQL client tagged template literal — it's like Python's `psycopg2.execute()` but with automatic parameterisation.

### Depop Data Flow

Stitch doesn't scrape Depop in real time on every user request (that would be too slow). Instead, it runs a **cache-first** strategy:

```
User requests product recs
        ↓
Check depop_cache table (7,700+ rows, 24-hour TTL or permanent)
        ↓ HIT → return cached listings instantly
        ↓ MISS → fetch from Depop API via one of three paths:
                   1. Direct Depop API (browser cookies in env)
                   2. Cloudflare Worker proxy (bypasses bot detection)
                   3. Residential proxy list (PROXY_LIST env var)
                   4. Apify scraper actor (fallback, slow ~90s)
        ↓ Store result → return to user
```

---

## Request Lifecycle: User Uploads a Photo

Here is what happens step by step when a user hits the Scan page and uploads an outfit photo:

### Step 1 — Client-side (browser)
1. User opens `/scan` (or `/#/scan` with hash routing).
2. They take a photo or pick from their gallery.
3. The browser resizes the image to 1024px max (to keep payload under 4MB).
4. `scan.tsx` converts the image to a `FormData` object and `POST`s it to `/api/analyze`.

### Step 2 — Express receives the request (`routes.ts`)
5. The `multer` middleware validates the file type (JPEG/PNG/WebP/GIF only) and size (4MB max).
6. The `analyzeLimiter` rate limiter checks: max 10 requests per IP per minute.
7. The route handler begins the two-pass Gemini analysis.

### Step 3 — Gemini Pass 1 (garment detection)
8. The image is sent to `gemini-2.5-flash-lite` with a structured JSON schema.
9. Gemini returns: every visible garment with `{ item, color, fabric, fit, details }`, the overall palette, layering description, and perceived gender expression.
10. This output becomes `garmentSummary` — a structured text passed to Pass 2.

### Step 4 — Gemini Pass 2 (aesthetic classification)
11. The image AND `garmentSummary` are sent to `gemini-2.5-flash`.
12. Gemini returns: aesthetic label (one of 41 options), confidence %, style breakdown, occasions, key pieces, colour palette (hex codes), and two sets of product recommendations (get-the-look + complete-the-look).

### Step 5 — Depop product matching
13. From the detected garments, the server builds specific Depop search queries (e.g. `"streetwear tan corduroy trousers"`).
14. For each query, it tries the cache first, then fetches live if needed.
15. Listings are tagged with `_gender` and filtered by the user's gender preference.

### Step 6 — Database write
16. The scan is saved to the `scans` table (image data, aesthetic, all analysis fields, Depop results).
17. The key pieces are upserted into `scanned_pieces` — this table feeds the seed-trending job to keep the cache relevant.

### Step 7 — Response
18. The server returns a JSON object with the scan ID, analysis results, and Depop listings.
19. The browser navigates to `/results/:id`.
20. `results.tsx` fetches the scan by ID and renders the full breakdown.

---

## Deployment Setup

### Render.com

The app is deployed on [Render.com](https://render.com) as a Node.js web service. The `render.yaml` file defines the service. On each deploy:

1. `npm install` — installs dependencies
2. `npm run build` — Vite compiles the React app to `dist/public/`
3. `npm start` — starts `server/index.ts` with `tsx` (TypeScript runner)

The server listens on `process.env.PORT` (set by Render) defaulting to `5000`. All traffic goes through this one port.

### Environment Variables (set in Render dashboard)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `OPENAI_API_KEY` | OpenAI API key (for embeddings) |
| `WORKER_URL` | Cloudflare Worker URL (for Depop proxy) |
| `WORKER_SECRET` | Shared secret for worker auth |
| `DEPOP_COOKIE` | Browser cookie for direct Depop API access |
| `DEPOP_DEVICE_ID` | Depop device ID header |
| `DEPOP_SESSION_ID` | Depop session ID header |
| `PROXY_LIST` | Comma/newline-separated residential proxy list |
| `APIFY_TOKEN` | Apify API token (fallback scraper) |
| `NODE_ENV` | Set to `"production"` on Render |

### Cloudflare Worker

The `cloudflare-worker/worker.js` runs on Cloudflare's global edge network. It accepts `POST /fetch` requests from the Render server, proxies them to `webapi.depop.com`, and returns the response. Because the request originates from a Cloudflare edge IP (not Render's fixed IP), Depop's bot-detection doesn't block it.

The worker is deployed separately using the Wrangler CLI:
```bash
cd cloudflare-worker
wrangler deploy
```

### Domain

The production domain `shopstitch.app` is pointed at the Render service via a DNS CNAME record. Render handles the TLS certificate automatically.

---

## For Python Developers: Express ≈ Flask/FastAPI

If you know Flask or FastAPI, Express will feel immediately familiar. Here's a direct comparison:

### Defining a route

**Flask (Python)**:
```python
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"ok": True})
```

**Express (TypeScript)**:
```typescript
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});
```

### Route parameters

**Flask**:
```python
@app.route("/api/scans/<device_id>")
def get_scans(device_id):
    return jsonify(db.query(...))
```

**Express**:
```typescript
app.get("/api/scans/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  const data = await db.query(...);
  res.json(data);
});
```

### Middleware (like Flask `before_request`)

**Flask**:
```python
@app.before_request
def log_request():
    print(f"{request.method} {request.path}")
```

**Express**:
```typescript
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next(); // must call next() to continue to the next handler
});
```

The key difference from Flask: in Express, `next()` is explicit. If you forget it, the request hangs. In Flask, `before_request` handlers automatically continue unless they return a response.

### Async/await

Express supports `async` route handlers natively. Unlike Flask (which needs `asyncio`), Node.js is built on an event loop where async is the default:

```typescript
app.get("/api/data", async (req, res) => {
  const result = await someAsyncOperation(); // like Python's await
  res.json(result);
});
```

### Error handling

**Flask**:
```python
@app.errorhandler(500)
def handle_error(e):
    return jsonify({"error": str(e)}), 500
```

**Express** (four-argument middleware = error handler):
```typescript
app.use((err, req, res, next) => {
  res.status(500).json({ message: err.message });
});
```

The Express error handler is registered last in `server/index.ts` — after all routes.

---

## Key Architectural Decisions

### Why hash routing?

The app uses `useHashLocation` from wouter, meaning URLs look like `shopstitch.app/#/scan` instead of `shopstitch.app/scan`. This is because in production, Express serves `index.html` for all unmatched routes (the catch-all in `static.ts`). Hash routing avoids any server-side routing complexity — the `#` fragment is never sent to the server, so the browser handles all navigation entirely client-side.

### Why no authentication?

Stitch uses device IDs (UUIDs stored in `localStorage`) instead of user accounts. This means:
- No login friction for users
- No email/password storage
- Each device gets an anonymous stable identity
- Scan history is per-device, not per-person

The "user ID" for the taste vector (`stitch_user_id`) is also a UUID generated client-side and stored in `localStorage`.

### Why a cache-first Depop strategy?

Depop's API has rate limits and anti-bot protection. Fetching live results for every user request would be slow (~2-5 seconds), unreliable, and would quickly exhaust any rate limits. Instead, the `depop_cache` table acts as a pre-populated product catalogue:
- `permanent = TRUE` rows are seeded by the seed-trending job and never expire.
- `permanent = FALSE` rows expire after 24 hours (for one-off searches).
- The 7,700+ rows cover all major aesthetics × garment types × colour variants.

### Why two Gemini passes?

Pass 1 (Flash-Lite) is cheap and fast — it lists every visible garment factually. Pass 2 (Flash) is expensive and smart — it interprets the aesthetic from those facts. Separating them:
1. Keeps costs down (Flash-Lite is ~10x cheaper than Flash)
2. Grounds the aesthetic classification in observed facts rather than vibes
3. Makes the Pass 2 classification more consistent and calibrated
