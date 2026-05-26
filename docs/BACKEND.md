# Stitch — Backend Reference

The backend is a single Express.js application written in TypeScript. It runs on Node.js and lives entirely in the `server/` directory. All API logic, database queries, AI calls, and static file serving happen here.

---

## Entry Point: `server/index.ts`

This is where the Express app is created and the server starts. Think of it like Flask's `app = Flask(__name__)` block, but more explicit.

### What it does, line by line

```typescript
const app = express();          // create the app (like Flask(__name__))
const httpServer = createServer(app);  // wrap in raw HTTP server (needed for Vite HMR)
```

### Middleware stack

Middleware in Express is like Flask's `before_request` hooks or WSGI middleware — functions that run on every request before your route handlers. In `index.ts`:

**1. CORS** (Cross-Origin Resource Sharing):
```typescript
app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? ["https://styleai-app-i25n.onrender.com", "https://shopstitch.app", "https://www.shopstitch.app"]
    : true,  // allow all in dev
  methods: ["GET", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "x-device-id"],
}));
```
In Python terms: this is like setting `Access-Control-Allow-Origin` headers. Without this, browsers refuse to load API responses from a different origin.

**2. JSON body parser**:
```typescript
app.use(express.json({ limit: "10mb" }));
```
This parses incoming `Content-Type: application/json` request bodies into `req.body`. The 10MB limit is needed because scan images are uploaded as base64 strings (~700KB each).

**3. Request logger** (custom middleware):
```typescript
app.use((req, res, next) => {
  const start = Date.now();
  // ... monkey-patches res.json to capture the response body
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });
  next();
});
```
This logs every API request with timing. The `res.on("finish")` trick captures the response after it's sent.

### Startup sequence

```typescript
(async () => {
  await registerRoutes(httpServer, app);  // mount all API routes

  // Error handler MUST be registered after routes
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);   // serve built React app
  } else {
    await setupVite(httpServer, app);  // Vite HMR in dev
  }

  httpServer.listen({ port: 5000, host: "0.0.0.0" }, () => {
    triggerSeedIfEmpty();      // auto-seed discover feed if DB is empty
    startDailyRefreshCron();   // daily job to prune stale cards
  });
})();
```

The `(async () => { ... })()` pattern is an Immediately Invoked Async Function — equivalent to Python's `asyncio.run(main())`. It's needed because the top level of a Node.js module can't use `await` without this wrapper.

---

## Static File Serving: `server/static.ts`

In production, after all API routes are mounted, Express serves the React app:

```typescript
app.use(express.static(distPath));         // serve JS/CSS/images
app.use("/{*path}", (req, res) => {
  res.sendFile(path.resolve(distPath, "index.html"));  // SPA fallback
});
```

The `/{*path}` catch-all is critical for single-page apps. Without it, refreshing the page at `/scan` would give a 404 (Express doesn't know about React routes). The catch-all sends `index.html` for any unmatched path, and React's client-side router takes over.

---

## Routes: `server/routes.ts`

This is the largest file (~3000 lines). All API endpoints live here. The `registerRoutes` function mounts them all and is called from `index.ts`.

### Python analogy recap

```python
# Flask
@app.route("/api/analyze", methods=["POST"])
def analyze():
    ...

# Express equivalent
app.post("/api/analyze", async (req, res) => {
    ...
});
```

---

## API Endpoints by Feature

### Health

#### `GET /api/health`

Registered directly in `index.ts` (before routes). Used by the loading screen to detect when the server is ready.

- **Returns**: `{ ok: true }`
- **Why it matters**: The React loading screen polls this endpoint on startup. On Render, the server takes a few seconds to boot from a cold start. This endpoint lets the UI show a spinner until the server responds.

---

### Outfit Analysis

#### `POST /api/analyze`

The main feature endpoint. Accepts a multipart form upload, runs two-pass Gemini analysis, fetches Depop listings, saves the scan, and returns everything.

**Middleware applied**:
- `analyzeLimiter` — rate limits to 10 requests/IP/minute
- `upload.single("image")` — multer file upload, 4MB max, JPEG/PNG/WebP/GIF only

**Request**: `multipart/form-data` with field `image` (file)

**Response**:
```json
{
  "id": 42,
  "aesthetic": "Dark Academia",
  "confidence": 87,
  "styleBreakdown": [
    { "label": "Dark Academia", "score": 87 },
    { "label": "Vintage / Thrift", "score": 31 }
  ],
  "occasions": ["Campus", "Library trip", "Evening lecture"],
  "keyPieces": ["Tweed blazer", "Corduroy trousers", "Oxford brogues"],
  "colorPalette": ["#4a3728", "#2c3e50", "#8b7355"],
  "results": [...],        // mock Amazon recommendations (8 items)
  "depopResults": [...]    // real Depop listings from cache (up to 32 items)
}
```

**Two-pass flow** (see `AI.md` for full detail):
1. Pass 1 → `gemini-2.5-flash-lite` → garment inventory JSON
2. Pass 2 → `gemini-2.5-flash` → aesthetic + recommendations JSON
3. Build Depop queries from detected garments
4. For each query → try `depopCache` → fetch live if miss → tag gender
5. Save scan to DB → upsert scanned_pieces
6. Return assembled response

**Error handling**:
- Returns 400 if no image provided
- Returns 500 if Gemini API key missing
- On Gemini 503/429: retries up to 3 times with exponential backoff (2s, 4s)

---

### Depop Search

#### `GET /api/depop-search?q=<query>&aesthetic=<aesthetic>&gender=<gender>`

Searches the Depop cache for a specific query. Used when the user wants to search beyond the auto-generated queries.

**Query params**:
- `q` — search term (e.g. `"vintage leather jacket"`)
- `aesthetic` — filter by aesthetic
- `gender` — `"male"` | `"female"` | `"both"`

**Response**: `{ listings: [...] }`

Each listing has: `{ id, title, brand, price, currency, size, image, url, _gender }`

---

### Scan History

#### `GET /api/scans/:deviceId`

Returns all scans for a given device (browser), newest first.

**Note**: Image data is excluded from list queries to avoid loading megabytes of base64 on every call. Images are only returned in `GET /api/scans/:deviceId/:id` (individual scan lookup).

**Response**:
```json
[
  {
    "id": 42,
    "deviceId": "abc-123",
    "aesthetic": "Streetwear",
    "confidence": 91,
    "styleBreakdown": "[{\"label\":\"Streetwear\",\"score\":91}]",
    "createdAt": "2026-05-25T10:30:00Z"
  }
]
```

**Note on JSON strings**: The `styleBreakdown`, `occasions`, `keyPieces`, `colorPalette`, and `results` fields are stored as JSON *strings* in the database (due to the Drizzle schema using `text` columns). The frontend parses them with `JSON.parse()`.

#### `DELETE /api/scans/:id`

Deletes a single scan by its numeric ID.

---

### For You (Personalised Feed)

#### `GET /api/for-you/:userId?offset=0`

Returns personalised Depop recommendations based on the user's taste vector. Uses cosine similarity between the user's 1536-dim vector and all `depop_cache` embeddings.

**Params**: `userId` — the UUID from `localStorage`

**Query params**: `offset` — for pagination (default 0)

**Returns 404 if**: User profile doesn't exist or `onboarded = FALSE`.

**Response**:
```json
{
  "items": [
    {
      "title": "Oversized Flannel Overshirt",
      "image": "https://...",
      "price": 25,
      "url": "https://www.depop.com/products/...",
      "_aesthetic": "Streetwear",
      "_gender": "both"
    }
  ],
  "hasMore": true,
  "interactionCount": 14
}
```

The items are the raw Depop listings from the `depop_cache.listings` JSONB array, augmented with `_aesthetic` (which cache row they came from).

---

### Onboarding

#### `POST /api/onboarding`

Called when a new user completes the style quiz. Takes their aesthetic picks and builds an initial taste vector.

**Body**:
```json
{
  "userId": "uuid-here",
  "aesthetics": ["Dark Academia", "Streetwear", "Vintage / Thrift"],
  "gender": "both"
}
```

**What it does**:
1. Fetches existing `depop_cache` rows whose aesthetic matches the picks
2. Averages their embeddings → initial taste vector
3. If gender is set, filters rows so the seed vector skews gender-appropriate
4. Saves to `user_profiles` with `onboarded = TRUE`

**Response**: `{ success: true, aesthetics: [...], dimensions: 1536 }`

---

### Interactions

#### `POST /api/interact`

The most important personalisation endpoint. Called whenever a user likes, saves, or skips a Depop listing. Updates their taste vector using a weighted running average.

**Body**:
```json
{
  "userId": "uuid",
  "itemId": "https://www.depop.com/products/...",
  "action": "like",
  "query": "streetwear cargo pants",
  "item": { ...full listing object... }
}
```

**Action weights**:
- `save` → weight +3 (strongest positive signal)
- `like` → weight +1
- `skip` → weight -0.5 (mild negative signal)

**Vector update formula**:
```
new_vector = (old_vector * n + item_embedding * weight) / (n + |weight|)
```
Then normalised to unit length so cosine similarity stays numerically stable.

**Also does**: If action is `like` or `save`, the full item object is appended to `user_profiles.liked_items` (JSONB array) for the history tab.

**Response**: `{ success: true, updated: true, action: "like", interactionCount: 15 }`

---

### User Profile

#### `GET /api/user-profile/:userId`

Check if a user exists and is onboarded.

**Response**: `{ exists: true, onboarded: true, interactionCount: 14, gender: "both" }`

#### `POST /api/user-profile/:userId`

Upsert a user profile. Used to save gender and other preferences.

#### `PATCH /api/user-gender/:userId`

Updates gender preference and re-seeds the taste vector from gender-appropriate default aesthetics.

**Body**: `{ "gender": "male" | "female" | "both" }`

When gender changes, the server rebuilds the taste vector from a gender-appropriate default aesthetic set:
- `male`: Streetwear, Old Money, Vintage, Grunge, Dark Academia
- `female`: Coquette, Soft Girl, Old Money, Vintage, Minimalist
- `both`: Vintage, Old Money, Minimalist, Streetwear, Grunge

---

### Liked Items

#### `GET /api/liked-items/:userId`

Returns all liked/saved Depop items for the History tab's saved section.

**Response**: `{ items: [...liked item objects, newest first...] }`

#### `DELETE /api/liked-items/:userId`

Remove a single liked item by its key (URL or ID).

**Body**: `{ "itemKey": "https://www.depop.com/products/..." }`

---

### Discover Feed

#### `GET /api/discover?userId=<uuid>`

Returns discover cards (outfit images from Reddit, pre-analysed by Gemini). If the user has a taste vector, cards are ordered by cosine similarity. Otherwise ordered by `likes_count`.

Applies gender filtering: male users never see cards with `FEMALE_ONLY_AESTHETICS`.

#### `POST /api/discover/:cardId/like`

Increments `likes_count` for a discover card and fires an interaction signal to update the taste vector.

---

### Seed / Admin Endpoints

#### `GET /api/seed-trending`

Triggers the background job that seeds the `depop_cache` with trending fashion items. Runs the curated base list (600+ queries × 8 items each), Google Trends fashion terms, and real pieces from recent user scans.

- `GET /api/seed-trending` — starts in background, returns immediately
- `GET /api/seed-trending?wait=1` — blocks until complete (use for cron jobs)

**Only works if**: `WORKER_URL`, `PROXY_URL`, or `APIFY_TOKEN` is configured.

#### `POST /api/seed-wave`

Seeds a custom list of queries. Currently runs in cache-only mode (reports what's cached, no live scraping).

**Body**:
```json
{
  "queries": [
    { "query": "black cargo pants", "aesthetic": "Streetwear", "garmentType": "bottoms" }
  ]
}
```

#### `GET /api/cache-stats`

Returns statistics about the `depop_cache` table — total rows, total listings, breakdown by aesthetic and permanent flag. Useful for monitoring the cache health.

#### `POST /api/backfill-embeddings`

One-time endpoint to generate OpenAI embeddings for all cache rows that don't have one yet. Runs in the background.

---

### Debug Endpoints

These are diagnostic endpoints for checking subsystem health:

| Endpoint | Purpose |
|---|---|
| `GET /api/debug-proxy?q=<query>` | Test the proxy list — sends a search request through each proxy |
| `GET /api/debug-worker?q=<query>` | Test the Cloudflare Worker proxy |
| `GET /api/debug-depop-direct?q=<query>` | Test direct Depop API access (no proxy) |
| `GET /api/debug-apify?q=<query>` | Test Apify scraper actor |
| `GET /api/debug-cache-type` | Check what `getDepopCacheByType` returns for a given aesthetic + garment type |
| `GET /api/scanned-pieces` | List all pieces ever scanned, sorted by frequency |

---

## Rate Limiting

The `/api/analyze` endpoint is rate-limited using the `express-rate-limit` middleware:

```typescript
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute window
  max: 10,              // max 10 requests per IP per window
  standardHeaders: true,
  message: { error: "Too many requests — please wait a moment." }
});
```

In Python/Flask, you'd achieve this with `flask-limiter`. Here it's Express middleware applied to a single route:

```typescript
app.post("/api/analyze", analyzeLimiter, upload.single("image"), async (req, res) => {
  // analyzeLimiter runs first, then upload.single("image"), then this handler
});
```

Multiple middleware can be chained as positional arguments — they run left to right.

---

## File Upload Handling (multer)

Unlike Flask where you'd use `request.files["image"]`, Express uses the `multer` middleware for multipart form data:

```typescript
// Python / Flask equivalent:
# file = request.files["image"]
# data = file.read()

// TypeScript / Express with multer:
const upload = multer({ limits: { fileSize: 4 * 1024 * 1024 } });
// Then in the route:
app.post("/api/analyze", upload.single("image"), (req, res) => {
  const file = req.file;       // multer populates req.file
  const base64 = file.buffer.toString("base64");
});
```

Multer stores the file in memory (not on disk) using `memoryStorage` — the default. `file.buffer` is a `Buffer` object (Node.js equivalent of Python's `bytes`).

---

## Depop Fetching: Three Paths

The `scrapeDepopDirect` function (called by `fetchDepopListings` on cache miss) tries three methods in order:

### Path 0: Direct API with browser cookies
```typescript
const r = await fetch("https://www.depop.com/api/v3/search/products/...", {
  headers: {
    "cookie": process.env.DEPOP_COOKIE,
    "depop-device-id": process.env.DEPOP_DEVICE_ID,
    ...
  }
});
```
This impersonates a real browser session. Works as long as the `cf_clearance` cookie is fresh (expires ~1 hour). When the cookie expires, you get 403 errors — that's when you need to update `DEPOP_COOKIE` in the Render environment.

### Path 1: Cloudflare Worker
```typescript
const r = await fetch(`${workerUrl}/fetch`, {
  method: "POST",
  body: JSON.stringify({ url: "https://webapi.depop.com/..." })
});
```
The worker runs on CF's edge and can hit Depop's API because it looks like a legitimate browser-adjacent request. This is the most reliable path and doesn't need cookie rotation.

### Path 2: Residential proxy list
Uses the `undici` library's `ProxyAgent` to route requests through residential IP addresses. Tries up to 3 proxies in round-robin order.

### Fallback: Apify
An async scraper actor that takes 30-90 seconds. Only used if no proxy/worker is configured.

---

## The `normaliseDepopObject` Function

This function takes raw Depop API responses (which come in two different shapes — v2 and v3) and converts them to a consistent internal format:

```typescript
{
  id: 0,              // sequential index within the search results
  title: "...",       // product title (from API or derived from URL slug)
  brand: "...",       // seller's brand name
  price: 25,          // numeric USD price
  currency: "USD",
  size: "M",
  image: "https://...",  // highest-resolution image URL
  url: "https://www.depop.com/products/username-product-name-ab12/"
}
```

The slug extraction is important: Depop URLs encode the product name as a slug (`username-product-name-hash`). The function strips the username (first part) and trailing hash (4-hex-char last part) to derive a human-readable title when the API doesn't return one.

---

## The Daily Refresh Cron

`startDailyRefreshCron()` (called from `index.ts` on startup) uses `setInterval` to run a nightly job at 3am server time:

1. **Hot sort** — re-sorts discover cards by `likes_count DESC` to surface popular ones
2. **Prune stale cards** — deletes discover cards older than 30 days that have zero likes

This keeps the Discover feed fresh without manual intervention.

---

## TypeScript vs Python Type Annotations

One thing Python developers will notice: TypeScript types are everywhere. In Python, types are optional annotations:

```python
def get_scan(id: int) -> dict | None:
    ...
```

In TypeScript, types are enforced at compile time:

```typescript
async function getScan(id: number): Promise<Scan | undefined> {
    ...
}
```

The `Promise<T>` wrapper indicates the function is async and will eventually return type `T`. This is like Python's `Awaitable[T]` from `typing` — but it's the required pattern for all async functions in TypeScript.

When you see `as any` in the code (like `GARMENT_SCHEMA as any`), it's TypeScript's escape hatch — telling the compiler "trust me, I know the type." It's like Python's `# type: ignore`.
