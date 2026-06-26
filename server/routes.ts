// ─────────────────────────────────────────────────────────────────────────────
// routes.ts — All HTTP endpoints for the StyleAI server.
//
// Mental model for a Python dev: this file is roughly the equivalent of a Flask
// `app.py` or a FastAPI `router.py`. Each `app.get(...)` / `app.post(...)` call
// below is the JS/Express equivalent of a `@app.route("/path", methods=["..."])`
// decorator in Python. The handler is the second argument (a function), and
// `req` / `res` are like Flask's `request` / `response` objects — but `res`
// must be called explicitly (`res.json(...)`) rather than returned.
//
// Big picture of what's in this file:
//   1. Middleware setup: rate limiter (express-rate-limit) and file upload
//      handler (multer — Express's equivalent of Flask's `request.files`).
//   2. Mock product catalogs + Unsplash image helpers (legacy MVP fallback).
//   3. Depop scraping logic: hits api.depop.com via Cloudflare Worker / proxy
//      list, with Apify as a fallback. Results are cached in Postgres.
//   4. Gemini prompts + schemas: define the structured JSON shape we want
//      back from Gemini for outfit analysis (two passes: garment detection
//      then aesthetic classification).
//   5. Reddit auto-seeding for the Discover feed.
//   6. `registerRoutes(...)`: the function that wires every endpoint to
//      the Express app. This is the heart of the API.
// ─────────────────────────────────────────────────────────────────────────────

import type { Express } from "express";
import type { Server } from "http";
// Pulls in DB helpers from storage.ts — analogous to importing a Python
// service module (e.g. `from storage import get_user, set_cache, ...`).
import { storage, initDB, getDepopCache, getDepopCacheSince, setDepopCache, getDepopCacheByAesthetic, getDepopCacheByType, getDepopCacheByEmbedding, getUserProfile, upsertUserProfile, appendLikedItem, getLikedItems, removeLikedItem, getForYouRecommendations, recomputeTasteClusters, getAverageEmbeddingForAesthetics, getEmbedding, getDiscoverCardsByTaste, getShopTheLookItems, getWardrobeGapRecommendations, getSimilarDiscoverCards, embedDiscoverCard, FEMALE_ONLY_AESTHETICS, remapAestheticForGender, upsertScannedPieces, getScannedPieces, tagListingGender, genderPassesFilter as listingGenderOk, verifyUserOwnership, isJunkListing } from "./storage";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"; // Gemini client (like `google.generativeai` in Python)
import multer from "multer";           // Multipart/form-data parser (Python equivalent: Werkzeug's `request.files` or FastAPI's `UploadFile`)
import rateLimit from "express-rate-limit"; // Per-IP throttling middleware (Python equivalent: `flask-limiter`)
import cors from "cors";

// ── Rate limiter: 10 analysis requests per IP per minute ─────────────────────
// Like decorating a Flask route with `@limiter.limit("10 per minute")`.
// The returned `analyzeLimiter` is a middleware function we attach to the
// /api/analyze route specifically (see further down).
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,           // 60 seconds — the sliding window for counting requests.
  max: 10,                       // Reject the 11th request from any single IP within that window.
  standardHeaders: true,         // Send `RateLimit-*` headers so the client knows its quota.
  legacyHeaders: false,          // Skip the older `X-RateLimit-*` headers (deprecated).
  message: { error: "Too many requests — please wait a moment before trying again." },
});

// Whitelist of image MIME types we'll accept on uploads. Anything else (PDF,
// HEIC, octet-stream, etc.) is rejected up-front by the multer file filter.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// `upload` is the multer instance — think of it as a configured file-upload
// middleware. We use `upload.single("image")` on routes that expect a single
// file field named "image" (like Flask's `request.files["image"]`).
const upload = multer({
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB cap — client resizes to 1024px before upload, so this is plenty.
  fileFilter: (_req, file, cb) => {
    // multer calls this callback for each uploaded file; we approve or reject.
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true); // Convention: (error, accept). null error + true = accept the file.
    } else {
      cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed."));
    }
  },
});

// Mock product results for MVP (replace with Skimlinks affiliate API)

// Maps a product name (e.g. "Doc Martens", "Slim Chino Trousers") to a stable
// Unsplash photo URL. Used as a fallback image when we don't have a real
// product image. Like a Python dict-of-tuples lookup: walk the list, return
// the first photo whose keyword appears in the name.
function buildImageKeywords(name: string): string {
  const n = name.toLowerCase();
  const map: [string[], string][] = [
    [["sneaker", "trainer", "air force", "stan smith", "vans", "converse", "jordan"], "photo-1542291026-7eec264c27ff"],
    [["boot", "chelsea", "combat", "lug-sole", "doc marten"], "photo-1543163521-1bf539c55dd2"],
    [["loafer", "oxford shoe", "derby", "dress shoe", "mule", "pump", "heel"], "photo-1582588678413-dbf45f4823e9"],
    [["sandal", "slide", "flip flop"], "photo-1603808033176-9d134e6f4b71"],
    [["hoodie", "sweatshirt"], "photo-1556821840-3a63f15732ce"],
    [["cardigan", "knitwear", "knit", "sweater", "pullover", "crewneck", "turtleneck"], "photo-1576566588028-4147f3842f27"],
    [["blazer", "suit jacket", "sport coat"], "photo-1594938298603-c8148e4f4a24"],
    [["jacket", "coat", "trench", "parka", "anorak", "bomber", "puffer", "windbreaker", "vest"], "photo-1539533018447-63fcce2678e3"],
    [["shirt", "button-down", "oxford shirt", "flannel", "polo", "henley", "overshirt"], "photo-1596755094514-f87e34085b2c"],
    [["tee", "t-shirt", "tank", "crop top", "tube top", "blouse", "camisole"], "photo-1598300042247-d088f8ab3a91"],
    [["corset", "bustier"], "photo-1515372039744-b8f02a3ae446"],
    [["jean", "denim"], "photo-1624378439575-d8705ad7ae80"],
    [["trouser", "chino", "pant", "cargo", "jogger", "slack", "wide-leg", "flare"], "photo-1506629082955-511b1aa562c8"],
    [["skirt", "mini skirt", "midi skirt", "maxi skirt"], "photo-1515372039744-b8f02a3ae446"],
    [["short", "bermuda"], "photo-1506629082955-511b1aa562c8"],
    [["dress", "midi", "maxi", "wrap dress", "slip dress"], "photo-1515372039744-b8f02a3ae446"],
    [["bag", "tote", "clutch", "crossbody", "backpack", "purse", "satchel", "pouch"], "photo-1548036328-c9fa89d128fa"],
    [["watch"], "photo-1523275335684-37898b6baf30"],
    [["necklace", "chain", "choker", "pendant"], "photo-1515562141207-7a88fb7ce338"],
    [["earring", "hoop", "stud", "drop earring"], "photo-1515562141207-7a88fb7ce338"],
    [["bracelet", "bangle", "cuff"], "photo-1515562141207-7a88fb7ce338"],
    [["ring"], "photo-1515562141207-7a88fb7ce338"],
    [["sunglasses", "shades", "glasses"], "photo-1511499767150-a48a237f0083"],
    [["hat", "cap", "beanie", "bucket hat", "beret", "balaclava"], "photo-1521369909029-2afed882baee"],
    [["belt"], "photo-1596755094514-f87e34085b2c"],
    [["scarf"], "photo-1576566588028-4147f3842f27"],
    [["sock", "tight", "fishnet", "stocking"], "photo-1542291026-7eec264c27ff"],
  ];
  for (const [terms, photoId] of map) {
    if (terms.some(t => n.includes(t))) return `https://images.unsplash.com/${photoId}?w=400&q=80`;
  }
  // Generic fashion keyword fallback — dynamic Unsplash image by clothing keyword
  // source.unsplash.com is deprecated — use a generic fashion placeholder
  return `https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=400&q=80`;
}

// ── Depop helpers ───────────────────────────────────────────────────
// `normaliseDepopItem` takes one raw item from the Apify Depop scraper and
// converts it to our internal listing shape: { id, title, brand, price,
// currency, size, image, url }. Different scrapers return slightly different
// JSON shapes (image_url vs imageUrl vs images[]), so this function picks
// the first one that actually has data and normalises the result.
// Returns `null` if the item is clearly non-clothing (trading cards, toys,
// etc.) so the caller can filter them out.
function normaliseDepopItem(i: any, idx: number, searchQ: string) {
  let image = "";
  if (Array.isArray(i.image_url)) image = i.image_url.find((u: string) => u?.length) || "";
  else if (typeof i.image_url === "string" && i.image_url.length) image = i.image_url;
  else if (i.imageUrl) image = Array.isArray(i.imageUrl) ? i.imageUrl[0] : i.imageUrl;
  else if (Array.isArray(i.images) && i.images.length) image = i.images[0]?.url || (typeof i.images[0] === 'string' ? i.images[0] : '') || "";
  else if (i.picture) image = i.picture;
  image = image.replace(/\/P10\.jpg$/i, "/P0.jpg").replace(/\/P2\.jpg$/i, "/P0.jpg");

  // Use real product URL first so we can extract the slug from it
  const url = (typeof i.url === "string" && i.url.startsWith("https://www.depop.com/products/"))
    ? i.url
    : `https://www.depop.com/search/?q=${encodeURIComponent(searchQ)}`;

  // Title: prefer real Depop product title from API (the actual h1 text, e.g. "Levi's Women's Brown Trousers").
  // Fall back to slug-derived title. listingText() in storage.ts appends the URL slug at read-time
  // for gender detection, so we don't need to store slug words in the title field.
  const slugFromUrl = url.match(/\/products\/([^/?#]+)/i)?.[1] || i.slug || "";
  let slugTitle = "";
  if (slugFromUrl) {
    const parts = slugFromUrl.split("-");
    const hasHash = parts.length > 1 && /^[a-f0-9]{4}$/i.test(parts[parts.length - 1]);
    const middle = parts.slice(1, hasHash ? -1 : undefined);
    slugTitle = middle.map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  let title = i.title || i.name || slugTitle || i.description || "";
  if (!title) title = searchQ.replace(/\b\w/g, (c: string) => c.toUpperCase());

  // Reject non-clothing items: trading cards, toys, games, electronics, home goods, etc.
  const NON_CLOTHING_SIGNALS = [
    "trading card","pokemon card","yugioh","yu-gi-oh","magic card","sports card",
    "collectible","funko","action figure","figurine","toy",
    "video game","console","phone case","electronics",
    "poster","print","sticker","art print","wall art",
    "candle","mug","cup","pillow","blanket",
    "book","magazine","vinyl record","cd "," dvd",
    "gift card","e-gift","voucher","store credit",
    "mystery box","bundle lot","grab bag","sample pack",
  ];
  const titleLower = title.toLowerCase();
  if (NON_CLOTHING_SIGNALS.some(s => titleLower.includes(s))) return null;

  return {
    id: idx,
    title,  // full slug-derived title, no length cap
    brand: i.brand || "",
    price: typeof i.price === "number" ? i.price : parseFloat(i.price) || 0,
    currency: i.currency || "USD",
    size: i.size || i.sizeLabel || "",
    image,
    url,
  };
}

// ── Direct Depop scraper via residential proxy ──────────────────────────────
// Hits api.depop.com directly, bypassing Cloudflare via a residential proxy IP.
// Falls back to Apify if PROXY_URL is not set.
// Parse PROXY_LIST env var — lines or commas of "ip:port:user:pass" or "ip:port"
//
// In Python this would be roughly:
//   raw = os.environ.get("PROXY_LIST", "")
//   for line in raw.replace(",", "\n").splitlines(): ...
// Each entry becomes a fully-formed http:// URL with URL-encoded creds.
function getProxyList(): string[] {
  const raw = process.env.PROXY_LIST || "";
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      // Expects: ip:port:username:password  OR  ip:port
      const parts = line.split(":");
      if (parts.length >= 4) {
        const [ip, port, user, pass] = parts;
        return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:${port}`;
      } else if (parts.length === 2) {
        return `http://${parts[0]}:${parts[1]}`;
      }
      return "";
    })
    .filter(Boolean);
}

// Shared normaliser for Depop API response items
// Handles both v2 (objects[]) and v3 (products[]) response shapes.
// Similar in spirit to normaliseDepopItem above, but this one handles the
// raw Depop *API* response (which has different keys: `preview` dict,
// `pricing.original_price...`, `sizes` array) vs the Apify scraper output.
function normaliseDepopObject(item: any, idx: number, query: string) {
  // v3: preview is a dict of size->url; v2: preview_pictures or pictures array
  let image = "";
  if (item.preview && typeof item.preview === "object" && !Array.isArray(item.preview)) {
    // v3 shape: pick highest res available
    image = item.preview["960"] || item.preview["640"] || item.preview["480"]
      || item.preview["320"] || Object.values(item.preview)[0] as string || "";
  } else {
    const pics: any[] = item.preview_pictures || item.pictures || [];
    image = pics[0]?.url || pics[0]?.src
      || (typeof pics[0] === "object" ? Object.values(pics[0])[0] as string : "") || "";
  }
  // Always prefer P0/highest res
  image = image.replace(/\/P[2-9]\.jpg$/i, "/P0.jpg").replace(/\/P1[0-9]\.jpg$/i, "/P0.jpg");

  const slug = item.slug || "";
  // v3 slug format: "username-product-name-hash" — username is first segment
  const slugParts = slug.split("-");
  const username = item.seller?.username || item.sellerName || slugParts[0] || "";
  const url = slug
    ? `https://www.depop.com/products/${slug}/`
    : `https://www.depop.com/search/?q=${encodeURIComponent(query)}`;

  // Title: prefer real Depop product title from API. Fall back to slug-derived.
  let slugTitle = "";
  if (slug) {
    const parts = slug.split("-");
    const hasHash = parts.length > 1 && /^[a-f0-9]{4}$/i.test(parts[parts.length - 1]);
    const middle = parts.slice(1, hasHash ? -1 : undefined);
    slugTitle = middle.map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  let title = item.title || item.name || slugTitle || item.description || "";
  if (!title) title = query.replace(/\b\w/g, (c: string) => c.toUpperCase());

  // v3 price: pricing.original_price.price_breakdown.price.amount
  // v2 price: price.amount
  const priceRaw =
    item.pricing?.original_price?.price_breakdown?.price?.amount
    ?? item.pricing?.original_price?.total_price
    ?? item.price?.amount
    ?? item.price
    ?? 0;
  const price = typeof priceRaw === "number" ? priceRaw : parseFloat(priceRaw) || 0;
  const currency = item.pricing?.currency_name || item.price?.currency || "USD";

  // v3 size: sizes[] is string[] e.g. ['S','M']; v2: size.label or sizes[0].label
  const rawSize = item.sizes?.[0];
  const size = (typeof rawSize === "string" ? rawSize : rawSize?.label)
    || item.size?.label || item.sizeLabel || "";

  return {
    id: idx,
    title,  // no length cap — full slug-derived title
    brand: item.brand_name || item.brand?.name || item.brandName || "",
    price,
    currency,
    size,
    image,
    url,
  };
}

// Simple round-robin counter for proxy selection (mutable module-level state;
// the equivalent of a `proxy_round_robin = 0` global in a Python module).
// Each successful proxy use bumps this so the next call hits a different IP.
let proxyRoundRobin = 0;

// Try every path we have to reach Depop's product search API.
// Order of attempts (each falls through to the next on failure):
//   Path 0: Direct fetch with real browser cookies pasted into env vars.
//           Most reliable when fresh — looks like a logged-in browser.
//   Path 1: Cloudflare Worker (hosted on CF edge, so CF doesn't block it).
//   Path 2: Residential proxy list — round-robin up to 3 attempts.
// Throws if all paths fail; the caller catches and falls back to Apify.
async function scrapeDepopDirect(query: string, limit = 6): Promise<any[]> {
  // ── Path 0: Direct fetch with real browser cookies (most reliable) ────────
  const depopCookie = process.env.DEPOP_COOKIE;
  const depopDeviceId = process.env.DEPOP_DEVICE_ID || "89954962-57bb-4300-bef7-91339e5f8281";
  const depopSessionId = process.env.DEPOP_SESSION_ID || "7262fa1b-fdd7-43d4-adc5-222dacd93f5e";
  if (depopCookie) {
    const searchUrl = `https://www.depop.com/api/v3/search/products/?` +
      `what=${encodeURIComponent(query)}&items_per_page=${limit}&country=us&currency=USD&from=in_country_search&include_like_count=true&force_fee_calculation=false`;
    try {
      const r = await fetch(searchUrl, {
        method: "GET",
        headers: {
          "accept": "*/*",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json",
          "cookie": depopCookie,
          "depop-device-id": depopDeviceId,
          "depop-session-id": depopSessionId,
          "origin": "https://www.depop.com",
          "referer": `https://www.depop.com/search/?q=${encodeURIComponent(query)}`,
          "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
          "x-cached-sizes": "true",
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (r.ok) {
        const data = await r.json() as any;
        const objects: any[] = data.objects || data.products || [];
        if (objects.length > 0) {
          console.log(`[depop-direct] success for "${query}" — ${objects.length} results`);
          return objects.map((item: any, j: number) => normaliseDepopObject(item, j, query))
            .filter((l: any) => l.image);
        }
      } else {
        console.log(`[depop-direct] HTTP ${r.status} — falling through to worker`);
      }
    } catch (e: any) {
      console.log(`[depop-direct] failed: ${e.message} — falling through to worker`);
    }
  }

  // ── Path 1: Cloudflare Worker (preferred) ─────────────────────────────────
  // Worker runs on CF edge, so CF won't block its requests to api.depop.com
  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_SECRET;
  if (workerUrl) {
    const searchUrl = `https://webapi.depop.com/api/v3/search/products/?` +
      `what=${encodeURIComponent(query)}&sort=relevance&items_per_page=${limit}&country=us&currency=USD&include_like_count=true`;
    try {
      const r = await fetch(`${workerUrl}/fetch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workerSecret ? { "Authorization": `Bearer ${workerSecret}` } : {}),
        },
        body: JSON.stringify({ url: searchUrl }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`Worker/Depop ${r.status}: ${txt.slice(0, 200)}`);
      }
      const data = await r.json() as any;
      const objects: any[] = data.objects || data.products || [];
      return objects.map((item: any, j: number) => normaliseDepopObject(item, j, query))
        .filter((l: any) => l.image);
    } catch (e: any) {
      console.log(`[worker] failed: ${e.message} — falling back to proxy list`);
      // Fall through to proxy list below
    }
  }

  // ── Path 2: Direct proxy list (fallback) ──────────────────────────────────
  const { ProxyAgent, fetch: undiciFetch } = await import("undici");
  const proxyList = getProxyList();
  const fallbackUrl = process.env.PROXY_URL;
  const proxiesToTry: string[] = proxyList.length > 0
    ? proxyList
    : (fallbackUrl ? [fallbackUrl] : []);

  if (proxiesToTry.length === 0) throw new Error("No proxy configured (WORKER_URL, PROXY_LIST, or PROXY_URL)");

  const searchUrl = `https://webapi.depop.com/api/v3/search/products/?` +
    `what=${encodeURIComponent(query)}&sort=relevance&items_per_page=${limit}&country=us&currency=USD&include_like_count=true`;

  const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.depop.com/search/?q=streetwear",
    "Origin": "https://www.depop.com",
    "depop-client": "web",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "Connection": "keep-alive",
  };

  // Try proxies starting from the round-robin position, try up to 3
  const start = proxyRoundRobin % proxiesToTry.length;
  const attempts = Math.min(3, proxiesToTry.length);
  let lastError: Error | null = null;

  for (let i = 0; i < attempts; i++) {
    const idx = (start + i) % proxiesToTry.length;
    const proxyUri = proxiesToTry[idx];
    try {
      const dispatcher = new ProxyAgent({ uri: proxyUri, connectTimeout: 12_000 });
      const res = await (undiciFetch as any)(searchUrl, {
        dispatcher,
        headers: HEADERS,
        signal: AbortSignal.timeout(18_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Depop API ${res.status}: ${text.slice(0, 200)}`);
      }

      // Advance round-robin on success so next call uses a fresh proxy
      proxyRoundRobin = (idx + 1) % proxiesToTry.length;

      const data = await res.json() as any;
      const objects: any[] = data.objects || data.products || [];
      return objects.map((item: any, j: number) => normaliseDepopObject(item, j, query))
        .filter((l: any) => l.image);
    } catch (e: any) {
      lastError = e;
      if (e.message?.includes("Depop API")) throw e; // HTTP error, don't retry
      console.log(`[proxy] ${proxyUri.replace(/:([^@/]+)@/, ":***@")} failed: ${e.message}`);
    }
  }

  throw lastError || new Error("All proxies failed");
}

// Run a single Depop search: check cache first, else hit Apify + store result.
// This is the single entry point we use everywhere we want listings for a
// given query string. Roughly equivalent to a `@lru_cache`-wrapped Python
// function, except the cache lives in Postgres so it survives restarts.
async function fetchDepopListings(
  query: string,
  aesthetic: string,
  limit = 4,
  permanent = false,
  garmentType?: string
): Promise<any[]> {
  // 1. Cache hit — return instantly
  const cached = await getDepopCache(query);
  if (cached) {
    console.log(`[depop] cache hit for "${query}"`);
    return cached;
  }

  const proxyUrl = process.env.PROXY_URL;
  const workerUrl = process.env.WORKER_URL;
  const token = process.env.APIFY_TOKEN;
  if (!proxyUrl && !workerUrl && !token) return [];

  try {
    let listings: any[] = [];

    // 2a. Try direct scraper via CF Worker or proxy (fast, ~1-2s)
    if (workerUrl || proxyUrl) {
      try {
        listings = await scrapeDepopDirect(query, limit);
        console.log(`[depop] scrape got ${listings.length} listings for "${query}"`);
      } catch (e: any) {
        console.warn(`[depop] scrape failed for "${query}": ${e.message} — falling back to Apify`);
      }
    }

    // 2b. Fall back to Apify if proxy failed or not set.
    // Apify is async: we POST to start a "run", then poll until it succeeds,
    // then fetch the dataset of items. Whole flow can take ~30–60s.
    if (!listings.length && token) {
      const runRes = await fetch(
        `https://api.apify.com/v2/acts/piotrv1001~depop-listings-scraper/runs?token=${token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchQueries: [query], maxItems: limit }),
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!runRes.ok) return [];
      const runData = await runRes.json();
      if (runData.error) {
        console.warn(`[depop] Apify error: ${runData.error?.message}`);
        return [];
      }
      const runId: string = runData.data?.id;
      const datasetId: string = runData.data?.defaultDatasetId;
      if (!runId) return [];

      // Poll until done (max 90s). Like Python's:
      //   while time.time() - start < 90:
      //       time.sleep(4); status = requests.get(...).json()["status"]
      const start = Date.now();
      while (Date.now() - start < 90_000) {
        await new Promise(r => setTimeout(r, 4_000));
        const s = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`,
          { signal: AbortSignal.timeout(8_000) });
        if (!s.ok) continue;
        const sd = await s.json();
        const status: string = sd.data?.status;
        if (status === "SUCCEEDED") break;
        if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) return [];
      }

      const dataRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=${limit}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!dataRes.ok) return [];
      const items: any[] = await dataRes.json();
      listings = items.map((i, idx) => normaliseDepopItem(i, idx, query)).filter((l: any) => l && l.image);
    }

    // 3. Store in cache
    if (listings.length) {
      await setDepopCache(query, listings, aesthetic, permanent, garmentType).catch(e =>
        console.error("[depop] cache write failed:", e.message)
      );
    }
    console.log(`[depop] fetched ${listings.length} listings for "${query}"`);
    return listings;
  } catch (e: any) {
    console.error(`[depop] fetchDepopListings error for "${query}":`, e.message);
    return [];
  }
}

// Generates an Amazon affiliate search URL for a product.
// We earn a small commission when users buy through `tag=styleaiapp-20`.
function amazonUrl(productName: string, brand: string): string {
  const query = encodeURIComponent(`${brand} ${productName}`);
  return `https://www.amazon.com/s?k=${query}&tag=styleaiapp-20`;
}

// Legacy MVP product catalog — removed (contained Amazon URLs which violate product rules).
// All product recommendations now come from depop_cache via semantic vector search.
function generateMockResults(_aesthetic: string) {
  return [];
}

// ─── Gemini response schema (structured output — no regex parsing needed) ───
// `responseSchema` tells Gemini to return JSON conforming to this shape, so
// we never have to scrape natural-language output. Think of these schemas as
// Python TypedDicts / Pydantic models — they constrain the LLM's response.
//
// We use TWO passes because they have different cost/quality tradeoffs:
//   PASS 1 (GARMENT_SCHEMA, gemini-2.5-flash-lite): cheap & fast — just
//          enumerates visible garments objectively, no aesthetic judgement.
//   PASS 2 (ANALYSIS_SCHEMA, gemini-2.5-flash): smarter — uses the Pass 1
//          inventory as grounding and assigns the aesthetic label.
// Two-pass beats single-pass because Pass 2 has concrete garment facts to
// reason over instead of having to do detection + classification in one shot.
// ─── Pass 1: Garment detection schema ────────────────────────────────────────
const GARMENT_SCHEMA = {
  type: SchemaType.OBJECT,
  description: "Structured inventory of all visible garments and accessories in the image",
  properties: {
    garments: {
      type: SchemaType.ARRAY,
      description: "Every visible clothing item and accessory. Be exhaustive — list each piece separately.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          item: {
            type: SchemaType.STRING,
            description: "Specific item name, e.g. 'Wide-leg corduroy trousers', 'Lug-sole platform boots', 'White linen shirt'",
          },
          color: {
            type: SchemaType.STRING,
            description: "Primary color(s) of this item, e.g. 'tan', 'white', 'black and white plaid'",
          },
          fabric: {
            type: SchemaType.STRING,
            description: "Fabric or material if identifiable, e.g. 'corduroy', 'linen', 'leather', 'denim', 'knit'. Use 'unknown' if unclear.",
          },
          fit: {
            type: SchemaType.STRING,
            description: "Fit or silhouette, e.g. 'oversized', 'slim', 'wide-leg', 'fitted', 'cropped', 'relaxed'",
          },
          details: {
            type: SchemaType.STRING,
            description: "Notable details: logos, hardware, embellishments, patterns, distressing, etc. Use 'none' if plain.",
          },
        },
        required: ["item", "color", "fabric", "fit", "details"],
      },
    },
    overallPalette: {
      type: SchemaType.STRING,
      description: "The dominant color story of the whole outfit, e.g. 'warm earth tones — tan, brown, white', 'all black with silver hardware'",
    },
    layering: {
      type: SchemaType.STRING,
      description: "How the outfit is layered, e.g. 'single layer', 'cardigan over tank top', 'jacket over turtleneck'",
    },
    perceivedGender: {
      type: SchemaType.STRING,
      enum: ["masculine", "feminine", "androgynous/neutral", "ambiguous"],
      description: "Perceived gender expression of the styling, based on garments and silhouettes only",
    },
  },
  required: ["garments", "overallPalette", "layering", "perceivedGender"],
};

// System instruction = "persona" sent to Gemini before the user prompt.
// Like the `system` role in an OpenAI chat completion. We tell Pass 1 to be
// a literal observer (no aesthetic judgement) so Pass 2 has clean grounding.
const GARMENT_SYSTEM_INSTRUCTION = `You are a precise fashion analyst. Your job is to inventory every visible garment and accessory in an outfit image.
Be exhaustive and specific. List every item you can see — including items that are partially visible.
Focus on factual observation: what you literally see. No interpretation of style or aesthetic yet — that comes later.
Be specific with names: not "pants" but "wide-leg corduroy trousers". Not "shoes" but "lug-sole platform boots".`;

// Pass 2 response schema — the full outfit analysis.
// Fields like `aesthetic` use an `enum` to constrain Gemini to our known
// 41-aesthetic taxonomy (so it can't invent a new label like "Y4K").
// `outfitRecs` and `similarRecs` produce two distinct kinds of product picks:
// "get the look" replicas vs "complete the look" complements.
const ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  description: "Fashion aesthetic analysis of an outfit image",
  properties: {
    visualSignals: {
      type: SchemaType.ARRAY,
      description:
        "Specific visual cues that support the aesthetic. Be concrete — not 'casual' but 'raw-hem denim jeans'. 3–6 signals.",
      items: { type: SchemaType.STRING },
    },
    evidenceStrength: {
      type: SchemaType.INTEGER,
      description:
        "Count of CLEAR, SPECIFIC signals supporting the primary aesthetic. " +
        "0–1: very weak; 2: moderate; 3–4: strong; 5: definitive.",
    },
    aesthetic: {
      type: SchemaType.STRING,
      enum: [
        // Minimalist & Clean
        "Quiet Luxury",
        "Clean Fit",
        "Classic / Timeless",
        // Soft & Feminine
        "Coquette",
        "Soft Girl / Kawaii",
        "Pink Pilates / Wellness",
        "Dark Feminine",
        // Preppy & Collegiate
        "Old School Preppy",
        "Modern Preppy",
        // Streetwear & Urban
        "Streetwear",
        "Hypebeast",
        "Skatecore",
        "Techwear",
        "Baddie",
        // Nature & Fantasy
        "Cottagecore",
        "Dark Academia",
        "Fairycore",
        "Gorpcore",
        // Vintage & Retro
        "Y2K",
        "90s Grunge",
        "70s-80s Retro",
        "Vintage / Thrift",
        // Bold & Expressive
        "Maximalist",
        "Glam / Party",
        "Rave",
        "E-Girl / Alt",
        // Formal & Power
        "Office Siren",
        "Occasion Wear",
        // Sport & Active
        "Athleisure",
        "Blokecore",
        // Countercultural
        "Goth",
        "Grunge / Punk",
        "Bohemian",
        // Cultural / Regional
        "Western / Americana",
        "K-Fashion",
        // Emerging
        "Retro-Futurism",
        "Historical Romanticism",
        // Hybrid & Crossover
        "Blokette",
        "Indie Sleaze",
        // Academia Sub-styles
        "Light Academia",
        // Wellness & Outdoor
        "Granola Girl",
      ],
      description: "The dominant aesthetic category based on visual evidence.",
    },
    secondaryAesthetic: {
      type: SchemaType.STRING,
      nullable: true,
      description:
        "A secondary aesthetic if clearly and substantially present. Null if the outfit is predominantly one style.",
    },
    confidence: {
      type: SchemaType.INTEGER,
      description:
        "Your raw, honest confidence (0–100) that the primary aesthetic is correct. " +
        "Output the exact unrounded value you calculate. Do not round for convenience — if your true estimate is 73, output 73, not 70 or 75.",
    },
    styleBreakdown: {
      type: SchemaType.ARRAY,
      description: "Top 2 matching aesthetics. Primary score matches confidence. Secondary score reflects how strongly that aesthetic is also present.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          label: { type: SchemaType.STRING },
          score: {
            type: SchemaType.INTEGER,
            description: "Raw honest score 0–100. Do not round for convenience.",
          },
        },
        required: ["label", "score"],
      },
    },
    occasions: {
      type: SchemaType.ARRAY,
      description: "2–3 occasions this outfit suits (e.g. 'Weekend brunch', 'Campus', 'Night out').",
      items: { type: SchemaType.STRING },
    },
    keyPieces: {
      type: SchemaType.ARRAY,
      description: "2–4 standout pieces by specific name (e.g. 'Oversized varsity jacket', 'Wide-brim felt hat').",
      items: { type: SchemaType.STRING },
    },
    colorPalette: {
      type: SchemaType.ARRAY,
      description: "2–4 dominant colors as hex codes derived from what is visually present.",
      items: { type: SchemaType.STRING },
    },
    outfitRecs: {
      type: SchemaType.ARRAY,
      description:
        "4 get-the-look recommendations — items that directly replicate specific pieces VISIBLE in the outfit. " +
        "Each must correspond to an actual garment, shoe, or accessory you can see in the image. " +
        "e.g. if the outfit has a brown leather jacket, recommend a specific brown leather jacket. " +
        "Real brands, specific names, realistic prices.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, description: "Specific product name matching what is worn" },
          brand: { type: SchemaType.STRING, description: "Real brand that sells this exact product type" },
          price: { type: SchemaType.INTEGER, description: "Realistic retail price in USD" },
          reason: { type: SchemaType.STRING, description: "One sentence referencing exactly which piece in the outfit this replicates" },
        },
        required: ["name", "brand", "price", "reason"],
      },
    },
    similarRecs: {
      type: SchemaType.ARRAY,
      description:
        "4 style-adjacent recommendations — items NOT in the outfit but that complement or elevate it. " +
        "Think: what would a stylist add to complete this look? Missing accessory, layering piece, shoe alternative, or bag. " +
        "Real brands, specific names, realistic prices.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, description: "Specific product name" },
          brand: { type: SchemaType.STRING, description: "Real brand that sells this product" },
          price: { type: SchemaType.INTEGER, description: "Realistic retail price in USD" },
          reason: { type: SchemaType.STRING, description: "One sentence: why this complements or elevates the outfit" },
        },
        required: ["name", "brand", "price", "reason"],
      },
    },
  },
  required: [
    "visualSignals",
    "evidenceStrength",
    "aesthetic",
    "confidence",
    "styleBreakdown",
    "occasions",
    "keyPieces",
    "colorPalette",
    "outfitRecs",
    "similarRecs",
  ],
};

// ─── System instruction — 35-category style taxonomy + calibration rules ───
// This is the "persona + rulebook" for Pass 2. It's long because Gemini
// needs concrete disambiguation rules (e.g. "Y2K vs 70s-80s Retro: platforms
// alone don't mean Y2K") to be consistent across users. Treat this like the
// schema documentation — when you change the taxonomy or the disambiguation
// logic, update both this string AND the enum above so they stay in sync.
const SYSTEM_INSTRUCTION = `You are Stitch, an expert fashion stylist and aesthetic analyst specialising in visual outfit classification.

GENDER-INCLUSIVE CLASSIFICATION:
- Fashion aesthetics apply to ALL genders. Classify based on visual garments, silhouettes, and styling — never assume gender from body type alone.
- Every aesthetic below lists both masculine and feminine expressions of that style. Identify whichever expression is visible.
- A man wearing quiet luxury tailoring is Quiet Luxury. A man in ballet flats and pearls is Coquette. A woman in cargo pants and clean sneakers is Streetwear. A person in a Supreme box logo hoodie with Jordan 1s is Hypebeast. Classify what you SEE.
- When unsure of gender from the image, describe the clothing items neutrally and classify by aesthetic — not by assumed gender.

STYLE TAXONOMY — definitions for all 41 supported aesthetics:

── MINIMALIST & CLEAN ──
- Quiet Luxury: Understated wealth signalling. Neutral palette (camel, cream, black, ivory, navy). Quality fabrics — cashmere, wool, silk, fine leather. No visible logos. MASC: tailored trousers, merino crewnecks, suede loafers, unstructured blazers, clean white shirts. FEM: wide-leg trousers, cashmere turtlenecks, ballet flats, structured totes. Brands: The Row, Totême, Loro Piana, Brunello Cucinelli, Auralee.
- Clean Fit: Effortless polished minimalism — basics executed with precision, zero effort visible. Off-white/black/beige/grey palette. MASC: fitted linen shirt, slim chinos or trousers, white low-top sneakers, minimal watch, clean silhouette with no logos or fuss. FEM: white tanks, wide-leg trousers, gold hoops, slicked bun, oversized blazer. KEY DISTINCTION — Clean Fit REQUIRES: (1) clean, unworn, crisp fabrics — no fading, no washing, no distressing; (2) a minimal neutral palette — white, cream, beige, grey, black; (3) simple silhouette with no layering complexity. EXCLUDE if: the outfit has faded/washed denim, thrifted-looking pieces, visible wear or texture, denim-on-denim, or any vintage/retro feel — those are Vintage/Thrift. Clean Fit = polished and pristine. If it looks lived-in → not Clean Fit.
- Classic / Timeless: Structured, heritage-quality, investment dressing. Navy/black/white/grey/camel. MASC: Oxford shirts, slim chinos, leather Oxford shoes, tailored navy blazers, trench coats. FEM: pencil skirts, silk blouses, pointed pumps, structured handbags. Endlessly polished, never trendy.

── SOFT & FEMININE ──
- Coquette: Hyperfeminine romanticism. Bows, lace, pearls, satin slips, corset tops, Mary Janes. Dusty pink, cream, lilac, powder blue. Lana del Rey / Bridgerton energy. Also seen in male fashion as Femboy / soft masc — satin blouses, lace trim, bows. Evolving into Rococo Revival.
- Soft Girl / Kawaii: Pastel-cute, K-pop influenced. Cardigans, pleated mini skirts, heart clips, layered necklaces, cute sneakers. Baby pink, lavender, mint, peach. Also on men as pastel fits, cute prints, feminine silhouettes worn without irony. Gentle and playful.
- Pink Pilates / Wellness: Aspirational wellness aesthetic. Ballet-inspired athleisure, ribbed sets, tennis skirts/shorts, satin scrunchies. Blush pink, cream, mauve, dusty rose. Also on men: blush-toned activewear, pastel zip-ups, clean white training shoes. Fitness meets fashion.
- Dark Feminine: Femme fatale confidence. Corsets, lace midi dresses, satin slips, black boots, statement earrings. Black, deep burgundy, forest green, dark navy. Predominantly feminine expression — villain-era energy.

── PREPPY & COLLEGIATE ──
- Old School Preppy: East Coast elite heritage. Oxford shirts, blazers, chinos, loafers, cable knits. Navy, white, green, red, burgundy, khaki. MASC: quarter-zip sweaters, boat shoes, khaki chinos, club ties, navy blazers. FEM: pearl bracelets, plaid skirts, headbands, polo dresses. Country club / Ivy League.
- Modern Preppy: Gen Z preppy reinvention. Brighter, more playful than classic prep. Vibrant pastels + white. MASC: polo shirts, colourful shorts, clean sneakers, caps worn backwards. FEM: pleated minis, puffer vests, grosgrain headbands, mini totes.

── STREETWEAR & URBAN ──
- Streetwear: Everyday urban culture dress. Relaxed fits, graphic tees, cargo pants, hoodies, clean sneakers. Brands: Carhartt WIP, Stüssy, Nike, New Balance, The North Face, Corteiz. No heavy logo-flex — just cool, comfortable, culturally aware. Worn across all genders.
- Hypebeast: Drop-culture, brand-obsessed, logo-forward. Key signals: visible Supreme, Off-White, Palace, Jordan Brand, or Yeezy branding; hyped sneakers (Jordan 1, Air Max, Dunk); collector-level pieces. The fit is built around the item — often one statement piece anchors the look. DISTINGUISH from Streetwear: Hypebeast = brand signals and resale-value pieces are front and center. Streetwear = culture and silhouette without the logo flex.
- Skatecore: Baggy and anti-fashion. Wide-leg jeans, graphic tees, Vans/DC shoes, caps, overshirts. Washed denim, black, white, earth tones. Skate brand logos. MASC dominant but gender-fluid. Relaxed and deliberate.
- Techwear: Utilitarian futurism. Technical jackets, cargo trousers, tactical vests, trail shoes, dark palette. ACRONYM, Veilance, Stone Island, Arc'teryx Veilance. Modular, functional, all-weather. Predominantly masculine expression but worn by all.
- Baddie: Glamorous urban confidence. Bodycon silhouettes, form-fitting co-ords, high heels, statement bags, fur-trim coats. Black, nude, gold, animal print. Polished, confident, bold. Predominantly feminine expression.

── NATURE & FANTASY ──
- Cottagecore: Pastoral romance. Prairie dresses, floral blouses, linen, crochet, aprons, straw hats. Sage, cream, dusty rose, terracotta. MASC expression: linen shirts, suspenders, knit vests, wicker hats, floral prints. Slow-living, handmade-feeling.
- Dark Academia: Scholarly and moody. Tweed blazers, turtlenecks, plaid, oxfords, trench coats. PALETTE IS CRITICAL: dark brown, forest green, oxblood/burgundy, charcoal, black. NEVER cream or beige as primary colors — those are Light Academia. MASC: tweed blazer + turtleneck + Oxford brogues + leather satchel. FEM: plaid skirts, knee socks, structured bags. Inspired by gothic collegiate buildings, The Secret History, Dead Poets Society. Moody, melancholic, intellectual.
- Light Academia: Scholarly but bright and optimistic — the warmer sibling of Dark Academia. PALETTE IS CRITICAL: cream, ivory, warm beige, oat, camel, muted pastels (dusty rose, pale sage, butter yellow). KEY ITEMS: linen dresses, cream trousers, pastel sweaters, cotton blouses, light knits, soft scarves, wire-frame glasses. DISTINGUISH from Dark Academia by palette — Light Academia is warm/light, never dark or black-dominant. Inspired by sunlit library courtyards, pastoral academia, Brideshead Revisited.
- Fairycore: Mystical and ethereal. Chiffon, floral crowns, lace, platform boots, delicate layered jewellery. Forest green, mushroom brown, dusty purple, cream. Predominantly feminine, but seen on all genders in alt/whimsical fashion.
- Gorpcore: Outdoor technical as everyday wear. Puffer jackets, fleece vests, cargo pants, trail shoes, beanies, fanny packs. Arc'teryx, Patagonia, The North Face. Earth tones + functional details. Very gender-neutral — classify by technical garments, not wearer.
- Granola Girl: Casual wellness-meets-nature lifestyle aesthetic. Softer and more feminine than Gorpcore — less technical, more earthy-lifestyle. KEY SIGNALS: Patagonia or REI fleece, Birkenstocks or Chacos, hiking-inspired casual wear, flowy linen, reusable water bottle implied energy, braided hair, no-makeup. Earth tones: sage green, rust, warm brown, cream, clay. DISTINGUISH from Gorpcore: Granola Girl is more casual/lifestyle, fewer technical pieces. DISTINGUISH from Cottagecore: Granola Girl is outdoorsy/active, not pastoral/romantic.

── VINTAGE & RETRO ERAS ──
- Y2K: Early 2000s pop-culture nostalgia. KEY SIGNALS: low-rise waistbands, rhinestone/bedazzled details, velour tracksuits, butterfly clips, tiny micro bags, baby tees, tube tops. Palette: hot pink, metallics, neon pastels, ice blue, denim-on-denim. MASC Y2K: baggy denim, Von Dutch caps, graphic jersey tees, tinted sunglasses. FEM Y2K: tube tops, low-rise mini skirts, bedazzled belts, velour co-ords. IMPORTANT: Y2K is NOT just "has platform boots" — platforms appear in 70s-80s Retro too. Y2K requires synthetic fabrics, low-rise silhouettes, or rhinestone/logo-heavy details. Earth tones + wide-leg corduroy + platform boots = 70s-80s Retro, NOT Y2K.
- 90s Grunge: Dishevelled rebellion. Flannel shirts, band tees, ripped jeans, Doc Martens. Black, plaid earth tones, faded denim, burgundy. MASC: flannel overshirt + band tee + ripped jeans + Docs. FEM: slip dresses + flannel + chunky boots. Kurt Cobain / Courtney Love energy — equally masculine and feminine.
- 70s-80s Retro: 1970s–1980s decade nostalgia. KEY SIGNALS: wide-leg or flared silhouettes, corduroy fabric, suede, warm earth tone palette (mustard, rust, camel, tan, brown, olive), platform boots or wedges, aviator sunglasses, open-collar printed shirts, gold chains, disco-era details. MASC: flared denim, printed open shirts, suede jackets, platform boots, gold chains, aviator shades, corduroy trousers. FEM: wrap dresses, wide-leg corduroys, corset or bustier tops layered over earth tones, platform boots, suede bags. DISTINCTION: if the outfit has corduroy, warm earth tones (tan/camel/rust/brown), and wide-leg silhouettes → 70s-80s Retro. If it has rhinestones, low-rise waistbands, velour, neon pastels, or baby tees → Y2K.
- Vintage / Thrift: Curated secondhand across any era. KEY SIGNALS: faded or washed denim, thrifted-looking silhouettes, heritage cuts, worn textures, mixed-era layering, lived-in feel. MASC: washed denim jacket, faded wide-leg jeans, white tee, leather mules/loafers — denim-on-denim is a STRONG vintage signal. Vintage band tees, deadstock denim, old-logo caps, thrifted blazers. FEM: floral wrap dresses, vintage blazers, 90s slip dresses. Depop energy. Muted, washed, faded palette. IMPORTANT: a washed denim jacket over a white tee and relaxed light-wash jeans = Vintage/Thrift, NOT Clean Fit. The worn/faded texture is the tell.

── BOLD & EXPRESSIVE ──
- Maximalist: More is more. Clashing prints, bold layers, statement coats, loud accessories. Animal print, jewel tones, all brights. MASC maximalism: bold printed shirts, layered jewellery, patterned suits, colourful trainers. FEM: ruffled dresses, statement coats, stacked accessories. Dopamine dressing — equally expressive across genders.
- Glam / Party: Evening and club wear. Sequins, satin, feather trim, metallic fabrics. Gold, silver, deep red, rich jewel tones. MASC: satin shirts, embellished jackets, velvet blazers, pointed dress shoes. FEM: sequin dresses, strappy heels, metallic bags. Shine and occasion.
- Rave: Festival and club culture. KEY SIGNALS: neon or UV-reactive colours, holographic/iridescent fabrics, fishnet layers, bralettes or mesh tops, tiny shorts or skirts, chunky platform sneakers or boots, kandi bracelets, LED/glow accessories, face gems or body glitter. Palette: neon green, hot pink, electric blue, UV white, holographic silver. Very skin-baring and maximally expressive. DISTINGUISH from Glam/Party: Rave is festival-practical and subculture-coded (comfort for dancing, DIY energy, glow accessories) — not cocktail-polished. DISTINGUISH from E-Girl: Rave centres neon/UV/holographic fabrics and festival accessories, not anime/emo aesthetics. DISTINGUISH from Retro-Futurism: Rave is dance-floor functional with neon energy, not sci-fi sculptural.
- E-Girl / Alt: Internet alt culture. Striped layering tees, plaid, chunky boots, chains, alt accessories. Black, red, pastel accents. MASC expression: E-Boy — striped long-sleeve under graphic tee, chains, straight-leg jeans, skate shoes. FEM: heart clips, plaid skirts, thigh-highs. Anime meets emo.
- Indie Sleaze: Anti-polish 2006–2012 revival, back strong in 2025–2026. Raw, messy, deliberately unkempt. KEY SIGNALS: skinny jeans, leather jacket, fishnet tights, smudged eyeliner (worn deliberately), band tees, Napoleon-style military jacket, multi-layered tops, thrifted pieces worn chaotically. Black, washed-out colours, some metallics. DISTINGUISH from 90s Grunge: Indie Sleaze is skinny/slim fit (not baggy) and rooted in 2000s indie music/MySpace era. DISTINGUISH from E-Girl: Indie Sleaze is less anime-coded, more music-scene energy. The look says "I was at a show last night."

── FORMAL & POWER DRESSING ──
- Office Siren: Polished work dressing with a confident edge. Pencil skirts, structured blazers, silk blouses, heels. Black, white, grey, navy, red. MASC: slim-fit suit, open-collar dress shirt, oxford shoes, structured briefcase. FEM: power suits, pointed mules, corset tops. Corpcore / power dressing with intentional sex appeal.
- Occasion Wear: Elegant event dressing. Structured pieces, elevated fabrics, sophisticated silhouettes. Classic navy, black, ivory, rich colours. MASC: suit, dress shirt, tailored trousers, Oxford shoes, pocket square. FEM: midi dresses, structured coats, heels, clutch bags. Semi-formal to formal.

── SPORT & ACTIVE ──
- Athleisure: Athletic pieces as everyday fashion. Performance fabrics in lifestyle context. Black, grey, white, bright accents. MASC: jogger sets, quarter-zips, track pants, running shoes, performance polos. FEM: leggings, sports bras, bombers, sneakers. Unisex aesthetic — classify by activewear silhouettes and brands (Nike, Adidas, Lululemon, Gymshark).
- Blokecore: Football culture as fashion. Football jerseys, wide-leg jorts, trainers, bucket hats, zip hoodies. Team colours, navy, black, white. British casual meets streetwear. Predominantly masculine but increasingly worn by all genders.
- Blokette: The sporty-feminine hybrid — Blokecore meets Coquette. KEY SIGNAL: masculine sportswear (football jersey, zip hoodie, sports socks) deliberately paired with feminine details (mini skirt, hair bows, Mary Janes, ballet flats, leg warmers, ribbons). DISTINGUISH from Blokecore: Blokette always has feminine accessories or garments. DISTINGUISH from Coquette: Blokette always has a sports/athletic piece. If you see a football jersey + mini skirt + bow = Blokette.

── COUNTERCULTURAL ──
- Goth: Dark subculture. All black, PVC/vinyl, chokers, platform boots, dark makeup, Victorian lace details, chains. Black, deep purple, blood red. MASC goth: all-black fits, trench coats, combat boots, fishnet tops, silver jewellery, black nail polish. FEM goth: velvet dresses, corsets, platform boots, dark makeup. 40+ year subculture.
- Grunge / Punk: Anti-fashion DIY spirit. Flannel, band tees, ripped denim, combat boots, leather jackets, safety pins, studded details. Black, plaid, faded denim. MASC dominant but gender-neutral in practice — classify by the DIY, rebellious garment signals.
- Bohemian: Free-spirited and artisanal. Flowy silhouettes, crochet, fringe, layered jewellery, wide-brim hats, sandals. Rust, olive, warm brown, terracotta. MASC boho: linen shirts, wide-brim hats, fringe vests, layered necklaces, leather sandals. FEM: maxi dresses, crochet tops, fringe bags. Festival and travel energy.

── CULTURAL / REGIONAL ──
- Western / Americana: American West. Cowboy boots, wide-brim hats, denim jackets, fringe, plaid, leather belts. Denim blue, tan, red, brown, cream. MASC: cowboy boots + bootcut jeans + western shirt + belt buckle. FEM: fringe jackets, cowboy boots, denim mini. Country music / Cowboycore — equally worn across genders.
- K-Fashion: Korean street fashion influence. Oversized varsity jackets, coordinated sets, platform shoes, cardigans. Pastel coordinates, black + white, school-uniform tones. MASC K-fashion: oversized blazers, cropped trousers, platform sneakers, soft-colour co-ords, bucket hats. FEM: mini skirts, platform shoes, pastel sets. K-pop / Ulzzang — very common across all genders.

── EMERGING ──
- Retro-Futurism: Future-nostalgia. Metallic, vinyl, bold asymmetric pieces, futuristic silhouettes. Silver, holographic, white, neon, chrome. MASC: metallic bomber, utility cargo in silver/white, futuristic sneakers, chrome accessories. FEM: metallic moto jacket, vinyl flared trousers, holographic boots. Y3K energy, sci-fi inspired.
- Historical Romanticism: Wearable historical fantasy. Corsets, lace blouses, velvet midis, puffed sleeves, pearl headbands. Dusty pink, deep blue, ivory, gold, jewel tones. MASC: ruffled poet shirts, velvet blazers, slim breeches, buckled shoes, lace cuffs. FEM: corsets, puffed sleeves, floral midis. Regencycore / Castlecore.

CALIBRATION RULES:
- Classify from specific visible items only — not vibes.
- Confidence: output your raw honest score. Low if ambiguous, high if certain. No floor or ceiling.
- If two aesthetics nearly equal → confidence <70, populate secondaryAesthetic.
- Choose MOST SPECIFIC category. Don't default to Vintage/Thrift when Y2K, 90s Grunge, or 70s-80s Retro fits.
- Y2K vs 70s-80s Retro: platforms ≠ Y2K. Y2K needs low-rise, rhinestones, velour, neon pastels, baby tee, or micro bag. Corduroy + earth tones + wide-leg = 70s-80s Retro.
- Corset/bustier: look at full outfit context — Y2K (low-rise/metallics), 70s-80s (earth tones), Coquette (bows/lace), Dark Feminine (all-black).
- Dark vs Light Academia: palette decides. Charcoal/oxblood/forest green/black = Dark. Cream/ivory/warm beige/pastels = Light.
- Gorpcore vs Granola Girl: technical gear = Gorpcore. Casual earth-tone lifestyle (fleece, Birkenstocks, linen) = Granola Girl.
- Blokecore vs Blokette: jersey + jorts + trainers = Blokecore. Jersey + feminine item (bow, mini skirt, Mary Janes) = Blokette.
- Rave vs Glam/Party vs E-Girl: Rave = neon/UV/holographic + festival accessories (kandi, glow, fishnet) + skin-baring for dancing. Glam/Party = sequins/satin + heels + polished cocktail energy. E-Girl = striped layers + anime/emo accessories + platforms.
- Streetwear vs Hypebeast: Streetwear = culture/silhouette-driven, no logo flex (Carhartt WIP, Stüssy, clean Nike). Hypebeast = visible luxury/hype branding is the centrepiece (Supreme, Off-White, Jordan 1s, Palace). If you can see the brand logo and it’s the point of the outfit → Hypebeast.
- Indie Sleaze vs 90s Grunge: Indie = slim fit + leather jacket + smudged liner (2000s). Grunge = baggy + flannel + Docs (90s).
- Quiet Luxury vs Clean Fit vs Classic: Quiet Luxury = expensive fabrics, no logos. Clean Fit = crisp casual basics. Classic = structured tailoring + dress shoes.
- Clean Fit vs Vintage/Thrift: FABRIC CONDITION. Crisp/new = Clean Fit. Faded/washed/worn = Vintage/Thrift. Denim-on-denim with faded wash = Vintage/Thrift.
- GENDER: Classify garments and styling, not the wearer.

PRODUCT RECOMMENDATIONS:
Generate two separate sets of 4 recommendations based on what you ACTUALLY SEE.

outfitRecs — GET THE LOOK (4 items):
- Each item must replicate a specific piece VISIBLE in the outfit.
- If you see a brown leather jacket → recommend a specific brown leather jacket. White sneakers → those exact white sneakers.
- reason field: reference the exact piece (e.g. "Replicates the oversized denim jacket worn in the outfit").

similarRecs — COMPLETE THE LOOK (4 items):
- Items NOT visible in the outfit that would complement or elevate it.
- Think like a stylist: missing accessory, bag, shoe alternative, layering piece, or jewellery.
- reason field: explain why it pairs with what's already in the outfit.

Both sets: real brands, specific names (not "jeans" but "Washed Barrel-Fit Jeans"), match gender expression, realistic prices: Zara = 30–100, Levi's = 60–120, Dr. Martens = 140–200, The Row = 300–800.`;

// ── Gemini retry helper ───────────────────────────────────────────────────────
// Retries on 503 / 429 / RESOURCE_EXHAUSTED up to maxAttempts times with
// exponential backoff. Keeps the user on the loading screen throughout.
// `fn: () => Promise<T>` is a generic "thunk": a no-arg function returning a
// promise of any type T. In Python this would be `Callable[[], Awaitable[T]]`.
// We only retry transient errors (overload, quota); 4xx user errors throw immediately.
async function geminiWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 2000
): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg: string = err?.message ?? String(err);
      const isRetryable =
        msg.includes("503") ||
        msg.includes("429") ||
        msg.includes("RESOURCE_EXHAUSTED") ||
        msg.includes("overloaded") ||
        msg.includes("quota");
      if (!isRetryable || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * attempt; // 2s, 4s
      console.warn(`[gemini] attempt ${attempt} failed (${msg.slice(0, 80)}), retrying in ${delay}ms…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── Reddit subreddit → aesthetic map (module-level for auto-seed access) ─────
const SUBREDDIT_MAP: { sub: string; aesthetic: string }[] = [
  { sub: "streetwear",           aesthetic: "Streetwear" },
  { sub: "femalefashionadvice",   aesthetic: "Clean Fit" },
  { sub: "malefashionadvice",     aesthetic: "Quiet Luxury" },
  { sub: "DarkAcademia",          aesthetic: "Dark Academia" },
  { sub: "cottagecore",           aesthetic: "Cottagecore" },
  { sub: "y2kfashion",            aesthetic: "Y2K" },
  { sub: "OUTFITS",               aesthetic: "Clean Fit" },
  { sub: "findfashion",           aesthetic: "Bohemian" },
  { sub: "weddingfashion",        aesthetic: "Historical Romanticism" },
  { sub: "crossdressing",         aesthetic: "Grunge / Punk" },
  { sub: "businessprofessionals", aesthetic: "Office Siren" },
  { sub: "AthleticWear",          aesthetic: "Athleisure" },
  { sub: "FashionAdvice",         aesthetic: "Modern Preppy" },
  { sub: "streetstyle",           aesthetic: "Indie Sleaze" },
  { sub: "Sneakers",              aesthetic: "Hypebeast" },
  { sub: "fashionadvice",         aesthetic: "Granola Girl" },
];

// Fetch top image posts from a subreddit (no auth needed for read-only).
// Uses Reddit's anonymous JSON endpoint — same data as adding `.json` to
// any subreddit URL in a browser. Filters out non-image links and NSFW posts.
async function fetchSubredditImages(
  sub: string,
  limit = 3,
  time: "week" | "month" | "hot" = "week"
): Promise<{ imageUrl: string; postUrl: string; title: string }[]> {
  const url = time === "hot"
    ? `https://www.reddit.com/r/${sub}/hot.json?limit=25`
    : `https://www.reddit.com/r/${sub}/top.json?limit=25&t=${time}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "StitchApp/1.0 (fashion discovery)" },
  });
  if (!res.ok) throw new Error(`Reddit ${sub}: HTTP ${res.status}`);
  const json = await res.json() as any;
  const posts = json?.data?.children ?? [];

  const images: { imageUrl: string; postUrl: string; title: string }[] = [];
  for (const { data: post } of posts) {
    if (images.length >= limit) break;
    const postUrl = (post.url_overridden_by_dest || post.url) as string;
    if (!postUrl) continue;
    const isRedditImg = postUrl.includes("i.redd.it") || postUrl.includes("preview.redd.it");
    const isDirectImg = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(postUrl);
    const isImgur = postUrl.includes("i.imgur.com") && /\.(jpg|jpeg|png|gif|webp)/i.test(postUrl);
    if (!isRedditImg && !isDirectImg && !isImgur) continue;
    if (post.over_18) continue;
    const imageUrl = postUrl.replace("preview.redd.it", "i.redd.it").split("?")[0];
    images.push({
      imageUrl,
      postUrl: `https://reddit.com${post.permalink}`,
      title: post.title,
    });
  }
  return images;
}

// Core analysis + store function (module-level).
// Used by both the auto-seed-from-Reddit flow AND the daily refresh cron.
// Flow:
//   1. Download image bytes and base64-encode for Gemini.
//   2. Gate check: ask Gemini Lite "is this actually an outfit photo?"
//      to filter out memes, product shots, illustrations etc.
//   3. Pass 1 (garment inventory) → Pass 2 (aesthetic classification).
//   4. Insert into discover_cards and trigger background embedding.
// Returns null if the image is not a real outfit photo (meme, product shot, no person, etc.)
async function analyzeAndStore(
  imageUrl: string,
  postUrl: string,
  subreddit: string,
  aesthetic: string,
  genAI: any
): Promise<any | null> {
  const imgRes = await fetch(imageUrl, {
    headers: { "User-Agent": "StitchApp/1.0" },
  });
  if (!imgRes.ok) throw new Error(`Image fetch HTTP ${imgRes.status}`);
  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const mimeType = contentType.startsWith("image/") ? contentType.split(";")[0] : "image/jpeg";
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const imageBase64 = buffer.toString("base64");

  // Gate check: reject memes, product shots, illustrations, non-outfit images
  const gateModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: { responseMimeType: "application/json", temperature: 0.0 },
  });
  const gateResult = await gateModel.generateContent([
    { inlineData: { data: imageBase64, mimeType } },
    `Does this image show a real person or people wearing actual clothing/an outfit? Reply with JSON only: {"pass": true/false, "reason": "brief reason"}. Reject if: meme, text overlay, illustration/drawing, product-only shot (no person), screenshot, collage without outfit focus, or no visible clothing on a real person.`,
  ]);
  const gateText = gateResult.response.text();
  const gateJson = gateText.match(/\{[\s\S]*?\}/);
  if (gateJson) {
    try {
      const gate = JSON.parse(gateJson[0]);
      if (!gate.pass) {
        console.log(`[seed] Skipping ${imageUrl} — gate rejected: ${gate.reason}`);
        return null;
      }
    } catch {}
  }

  // Dedup: skip if this postUrl is already stored
  if (await storage.postUrlExists(postUrl)) {
    console.log(`[seed] Skipping duplicate postUrl: ${postUrl}`);
    return null;
  }

  // Pass 1: garment detection
  const detModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: GARMENT_SYSTEM_INSTRUCTION,
    generationConfig: { responseMimeType: "application/json", responseSchema: GARMENT_SCHEMA as any, temperature: 0.0 },
  });
  const det = await detModel.generateContent([
    { inlineData: { data: imageBase64, mimeType } },
    "List every visible garment and accessory.",
  ]);
  const detJson = det.response.text().match(/\{[\s\S]*\}/);
  if (!detJson) throw new Error("garment parse failed");
  const garmentData = JSON.parse(detJson[0]);
  const garmentSummary = [
    "Detected garments:",
    ...garmentData.garments.map((g: any) =>
      `- ${g.item}: ${g.color}, ${g.fabric}, ${g.fit}${
        g.details !== "none" ? `, ${g.details}` : ""
      }`
    ),
    `Palette: ${garmentData.overallPalette}`,
  ].join("\n");

  // Pass 2: aesthetic classification
  const clsModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: { responseMimeType: "application/json", responseSchema: ANALYSIS_SCHEMA as any, temperature: 0.0 },
  });
  const cls = await clsModel.generateContent([
    { inlineData: { data: imageBase64, mimeType } },
    `Garment inventory:\n${garmentSummary}\n\nClassify the aesthetic. Hint: likely ${aesthetic}.`,
  ]);
  const clsJson = cls.response.text().match(/\{[\s\S]*\}/);
  if (!clsJson) throw new Error("aesthetic parse failed");
  const analysis = JSON.parse(clsJson[0]);

  const palette: string[] = Array.isArray(analysis.colorPalette)
    ? analysis.colorPalette.map((c: any) => typeof c === "string" ? c : c.hex || "#888")
    : [];
  const styleBreakdown = Array.isArray(analysis.styleBreakdown) ? analysis.styleBreakdown : [];
  const tags: string[] = Array.isArray(analysis.occasions) ? analysis.occasions.slice(0, 3) : [];

  const card = await storage.createDiscoverCard({
    imageUrl,
    aesthetic: analysis.aesthetic || aesthetic,
    confidence: analysis.confidence || 80,
    styleBreakdown: JSON.stringify(styleBreakdown),
    keyPieces: JSON.stringify(analysis.keyPieces || []),
    colorPalette: JSON.stringify(palette),
    tags: JSON.stringify(tags),
    source: "reddit",
    postUrl,
    subreddit,
  });

  // Auto-embed the new card for vector search (fire-and-forget)
  if (card?.id) {
    embedDiscoverCard(card.id, card.aesthetic, tags, analysis.keyPieces || []).catch(() => {});
  }

  return card;
}

// ── Auto-seed on startup ─────────────────────────────────────────────────────
// If the discover_cards table is empty when the server boots, pull a couple of
// top-of-month posts from each subreddit in SUBREDDIT_MAP, run them through
// analyzeAndStore, and populate the Discover feed. Best-effort: errors are
// logged but don't crash startup.
export async function triggerSeedIfEmpty() {
  // Cache-only mode — skip auto-seed check entirely. The depop_cache is already
  // populated (3,700+ rows) and we're not doing live scraping, so there's no
  // reason to query the DB here. A COUNT/SELECT on startup was hitting the
  // Postgres statement timeout and crashing the process via unhandled rejection.
  console.log("[seed] Cache-only mode: skipping auto-seed check");
  return;
}

// `registerRoutes` is called once at server startup. It runs DB migrations
// (initDB) and then attaches every endpoint handler to the Express app.
// Think of this as the body of a Flask `create_app()` factory — everything
// inside this function is one-time wiring that happens at boot.
export async function registerRoutes(httpServer: Server, app: Express) {
  await initDB(); // CREATE TABLE IF NOT EXISTS ... for all our tables. See storage.ts.

  // Auto-seed trending cards on startup (background, non-blocking).
  // `setTimeout(fn, 10_000)` is JS's `time.sleep(10)`-then-run equivalent,
  // but non-blocking — the server keeps accepting requests during the delay.
  if (process.env.APIFY_TOKEN) {
    setTimeout(() => {
      fetch(`http://localhost:${process.env.PORT || 5000}/api/seed-trending`)
        .catch(() => {});
    }, 10_000); // wait 10s for server to fully start
  }

  /**
   * POST /api/seed-wave
   * Accept a custom batch of search queries and check (without scraping) which
   * are already in the Depop cache. Returns a hit/miss report.
   *
   * Body: { queries: [{ query, aesthetic, garmentType }], limit? }
   *
   * Like Flask: @app.route("/api/seed-wave", methods=["POST"])
   */
  app.post("/api/seed-wave", async (req, res) => {
    const { queries, limit = 8 } = req.body as { queries: { query: string; aesthetic: string; garmentType: string }[]; limit?: number };
    if (!queries?.length) return res.status(400).json({ error: "queries required" });
    // Cache-only mode: no live scraping, just report what's already cached
    const cached = await Promise.all(queries.map(async ({ query }) => ({
      query,
      hit: !!(await getDepopCache(query).catch(() => null)),
    })));
    const hits = cached.filter(c => c.hit).length;
    console.log(`[seed-wave] cache-only mode: ${hits}/${queries.length} already cached`);
    res.json({ started: false, cached: hits, total: queries.length, message: "cache-only mode — live scraping disabled" });
  });

  /**
   * GET /api/seed-trending
   * Seeds the Depop cache from three sources:
   *   1. Pieces real users have scanned (`scanned_pieces` table) — highest priority.
   *   2. The big `curatedBase` array below: 25 queries × 16 aesthetics = 400 queries.
   *   3. Live Google Trends RSS for fashion (category 185), mapped to aesthetics.
   * Runs every query through fetchDepopListings with permanent=true so rows
   * never expire. By default fires in the background and returns immediately;
   * pass ?wait=1 (used by cron) to block until done.
   *
   * Like Flask: @app.route("/api/seed-trending", methods=["GET"])
   */
  app.get("/api/seed-trending", async (req, res) => {
    if (!process.env.WORKER_URL && !process.env.PROXY_URL && !process.env.APIFY_TOKEN) return res.json({ error: "No scraper configured" });
    const wait = req.query.wait === "1";

    // Google Trends RSS for fashion category (category 185)
    const TRENDS_URL = "https://trends.google.com/trends/trendingsearches/daily/rss?geo=US&cat=185";

    // Aesthetic keyword map — if a trend contains any keyword, tag it with that aesthetic
    const AESTHETIC_MAP: Record<string, string> = {
      "cargo": "Streetwear", "hoodie": "Streetwear", "oversized": "Streetwear", "graphic tee": "Streetwear", "baggy": "Streetwear",
      "linen": "Minimalist", "wide leg": "Minimalist", "neutral": "Minimalist", "minimal": "Minimalist", "clean": "Minimalist",
      "y2k": "Y2K", "low rise": "Y2K", "butterfly": "Y2K", "baby tee": "Y2K", "rhinestone": "Y2K",
      "blazer": "Dark Academia", "turtleneck": "Dark Academia", "plaid": "Dark Academia", "oxford": "Dark Academia",
      "floral": "Cottagecore", "prairie": "Cottagecore", "lace": "Cottagecore", "cottagecore": "Cottagecore",
      "trench": "Old Money", "cashmere": "Old Money", "polo": "Old Money", "loafer": "Old Money", "tailored": "Old Money",
      "vintage": "Vintage", "90s": "Vintage", "retro": "Vintage", "denim jacket": "Vintage",
      "maxi": "Boho", "crochet": "Boho", "fringe": "Boho", "wrap": "Boho",
      "platform": "E-Girl", "mesh": "E-Girl", "choker": "E-Girl",
      "pastel": "Soft Girl", "cardigan": "Soft Girl", "bow": "Coquette", "ballet": "Coquette",
      "windbreaker": "Techwear", "utility": "Techwear", "jogger": "Techwear",
      "flannel": "Grunge", "combat boot": "Grunge", "ripped": "Grunge",
      "skater": "Skater", "vans": "Skater", "beanie": "Skater",
    };

    const getAesthetic = (term: string): string => {
      const lower = term.toLowerCase();
      for (const [kw, aesthetic] of Object.entries(AESTHETIC_MAP)) {
        // Use word-boundary matching so "card" doesn't match inside "cardigan"
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i');
        if (regex.test(lower)) return aesthetic;
      }
      return "Streetwear"; // default fallback
    };

    const run = async () => {
      try {
        // 1. Fetch Google Trends RSS
        const rssRes = await fetch(TRENDS_URL, { signal: AbortSignal.timeout(10_000) });
        const rssText = await rssRes.text();

        // 2. Parse <title> tags from RSS items (skip channel title)
        const titles: string[] = [];
        const re = /<item>[\s\S]*?<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g;
        let m;
        while ((m = re.exec(rssText)) !== null) titles.push(m[1].trim());

        // 3. Filter to fashion-relevant terms and build queries
        const fashionTerms = titles
          .filter(t => Object.keys(AESTHETIC_MAP).some(kw => t.toLowerCase().includes(kw)))
          .slice(0, 20);

        // Also include a curated base set of trending fashion staples (always seeded permanently)
        // 23 queries × 16 aesthetics = 368 total × 10 items = ~3,680 listings
        // Each aesthetic gets enough to fill the entire 135-card homepage
        // Garment-specific queries tagged with aesthetic + garment_type
        // what= searches Depop properly so no aesthetic prefix needed
        // garment_type drives smart post-analysis matching
        const curatedBase: { query: string; aesthetic: string; garmentType: string }[] = [

          // ── STREETWEAR ──────────────────────────────────────────────────
          { query: "oversized graphic hoodie", aesthetic: "Streetwear", garmentType: "tops" },
          { query: "vintage band tee", aesthetic: "Streetwear", garmentType: "tops" },
          { query: "zip up hoodie", aesthetic: "Streetwear", garmentType: "tops" },
          { query: "oversized crewneck sweatshirt", aesthetic: "Streetwear", garmentType: "tops" },
          { query: "boxy graphic tee", aesthetic: "Streetwear", garmentType: "tops" },
          { query: "cargo pants baggy", aesthetic: "Streetwear", garmentType: "bottoms" },
          { query: "baggy jeans wide leg", aesthetic: "Streetwear", garmentType: "bottoms" },
          { query: "jogger sweatpants", aesthetic: "Streetwear", garmentType: "bottoms" },
          { query: "utility cargo shorts", aesthetic: "Streetwear", garmentType: "bottoms" },
          { query: "bomber jacket varsity", aesthetic: "Streetwear", garmentType: "outerwear" },
          { query: "puffer jacket oversized", aesthetic: "Streetwear", garmentType: "outerwear" },
          { query: "windbreaker jacket", aesthetic: "Streetwear", garmentType: "outerwear" },
          { query: "denim jacket oversized", aesthetic: "Streetwear", garmentType: "outerwear" },
          { query: "nike air force 1 sneakers", aesthetic: "Streetwear", garmentType: "shoes" },
          { query: "jordan 1 sneakers", aesthetic: "Streetwear", garmentType: "shoes" },
          { query: "chunky platform sneakers", aesthetic: "Streetwear", garmentType: "shoes" },
          { query: "new balance 550 sneakers", aesthetic: "Streetwear", garmentType: "shoes" },
          { query: "snapback cap", aesthetic: "Streetwear", garmentType: "accessories" },
          { query: "bucket hat", aesthetic: "Streetwear", garmentType: "accessories" },
          { query: "crossbody bag streetwear", aesthetic: "Streetwear", garmentType: "accessories" },
          { query: "adidas track jacket", aesthetic: "Streetwear", garmentType: "outerwear" },
          { query: "balaclava knit", aesthetic: "Streetwear", garmentType: "accessories" },
          { query: "long sleeve thermal", aesthetic: "Streetwear", garmentType: "tops" },
          { query: "tech fleece pants", aesthetic: "Streetwear", garmentType: "bottoms" },
          { query: "black cargo pants", aesthetic: "Streetwear", garmentType: "bottoms" },

          // ── MINIMALIST ───────────────────────────────────────────────────
          { query: "linen wide leg trousers", aesthetic: "Minimalist", garmentType: "bottoms" },
          { query: "straight leg white jeans", aesthetic: "Minimalist", garmentType: "bottoms" },
          { query: "black tailored trousers", aesthetic: "Minimalist", garmentType: "bottoms" },
          { query: "beige linen pants", aesthetic: "Minimalist", garmentType: "bottoms" },
          { query: "midi slip skirt satin", aesthetic: "Minimalist", garmentType: "bottoms" },
          { query: "white button up shirt oversized", aesthetic: "Minimalist", garmentType: "tops" },
          { query: "ribbed tank top", aesthetic: "Minimalist", garmentType: "tops" },
          { query: "silk camisole top", aesthetic: "Minimalist", garmentType: "tops" },
          { query: "mock neck long sleeve", aesthetic: "Minimalist", garmentType: "tops" },
          { query: "boxy linen shirt", aesthetic: "Minimalist", garmentType: "tops" },
          { query: "cream knit vest", aesthetic: "Minimalist", garmentType: "tops" },
          { query: "beige trench coat", aesthetic: "Minimalist", garmentType: "outerwear" },
          { query: "oversized blazer beige", aesthetic: "Minimalist", garmentType: "outerwear" },
          { query: "neutral cardigan", aesthetic: "Minimalist", garmentType: "outerwear" },
          { query: "white slip dress", aesthetic: "Minimalist", garmentType: "dresses" },
          { query: "minimal column maxi dress", aesthetic: "Minimalist", garmentType: "dresses" },
          { query: "white leather sneakers", aesthetic: "Minimalist", garmentType: "shoes" },
          { query: "pointed toe loafers", aesthetic: "Minimalist", garmentType: "shoes" },
          { query: "clean leather mules", aesthetic: "Minimalist", garmentType: "shoes" },
          { query: "canvas tote bag", aesthetic: "Minimalist", garmentType: "accessories" },
          { query: "minimal leather belt", aesthetic: "Minimalist", garmentType: "accessories" },
          { query: "structured leather handbag", aesthetic: "Minimalist", garmentType: "accessories" },
          { query: "black turtleneck", aesthetic: "Minimalist", garmentType: "tops" },
          { query: "oversized white t-shirt", aesthetic: "Minimalist", garmentType: "tops" },
          { query: "straight leg grey jeans", aesthetic: "Minimalist", garmentType: "bottoms" },

          // ── Y2K ──────────────────────────────────────────────────────────
          { query: "low rise jeans y2k", aesthetic: "Y2K", garmentType: "bottoms" },
          { query: "flare jeans y2k", aesthetic: "Y2K", garmentType: "bottoms" },
          { query: "denim mini skirt", aesthetic: "Y2K", garmentType: "bottoms" },
          { query: "low rise cargo pants", aesthetic: "Y2K", garmentType: "bottoms" },
          { query: "baby tee crop top", aesthetic: "Y2K", garmentType: "tops" },
          { query: "butterfly print top", aesthetic: "Y2K", garmentType: "tops" },
          { query: "rhinestone embellished top", aesthetic: "Y2K", garmentType: "tops" },
          { query: "halter top y2k", aesthetic: "Y2K", garmentType: "tops" },
          { query: "tube top stretchy", aesthetic: "Y2K", garmentType: "tops" },
          { query: "mesh top sheer", aesthetic: "Y2K", garmentType: "tops" },
          { query: "velour tracksuit", aesthetic: "Y2K", garmentType: "sets" },
          { query: "juicy couture velour", aesthetic: "Y2K", garmentType: "tops" },
          { query: "platform boots chunky y2k", aesthetic: "Y2K", garmentType: "shoes" },
          { query: "mary jane shoes platform", aesthetic: "Y2K", garmentType: "shoes" },
          { query: "butterfly hair clips", aesthetic: "Y2K", garmentType: "accessories" },
          { query: "mini crossbody bag y2k", aesthetic: "Y2K", garmentType: "accessories" },
          { query: "sparkle rhinestone belt", aesthetic: "Y2K", garmentType: "accessories" },
          { query: "bedazzled denim jacket", aesthetic: "Y2K", garmentType: "outerwear" },
          { query: "cropped zip up jacket", aesthetic: "Y2K", garmentType: "outerwear" },
          { query: "wrap mini dress y2k", aesthetic: "Y2K", garmentType: "dresses" },
          { query: "satin slip dress y2k", aesthetic: "Y2K", garmentType: "dresses" },
          { query: "printed cargo pants y2k", aesthetic: "Y2K", garmentType: "bottoms" },
          { query: "cowl neck satin top", aesthetic: "Y2K", garmentType: "tops" },
          { query: "trucker hat y2k", aesthetic: "Y2K", garmentType: "accessories" },
          { query: "metallic pleated skirt", aesthetic: "Y2K", garmentType: "bottoms" },

          // ── PREPPY ───────────────────────────────────────────────────────
          { query: "plaid mini skirt preppy", aesthetic: "Preppy", garmentType: "bottoms" },
          { query: "tennis skirt white", aesthetic: "Preppy", garmentType: "bottoms" },
          { query: "chino pants khaki", aesthetic: "Preppy", garmentType: "bottoms" },
          { query: "pleated trousers", aesthetic: "Preppy", garmentType: "bottoms" },
          { query: "bermuda shorts preppy", aesthetic: "Preppy", garmentType: "bottoms" },
          { query: "polo shirt ralph lauren", aesthetic: "Preppy", garmentType: "tops" },
          { query: "oxford button down shirt", aesthetic: "Preppy", garmentType: "tops" },
          { query: "peter pan collar blouse", aesthetic: "Preppy", garmentType: "tops" },
          { query: "madras plaid shirt", aesthetic: "Preppy", garmentType: "tops" },
          { query: "seersucker shirt", aesthetic: "Preppy", garmentType: "tops" },
          { query: "cable knit sweater", aesthetic: "Preppy", garmentType: "tops" },
          { query: "argyle knit vest", aesthetic: "Preppy", garmentType: "tops" },
          { query: "navy blazer preppy", aesthetic: "Preppy", garmentType: "outerwear" },
          { query: "striped blazer jacket", aesthetic: "Preppy", garmentType: "outerwear" },
          { query: "puffer vest preppy", aesthetic: "Preppy", garmentType: "outerwear" },
          { query: "varsity jacket letterman", aesthetic: "Preppy", garmentType: "outerwear" },
          { query: "loafers penny preppy", aesthetic: "Preppy", garmentType: "shoes" },
          { query: "boat shoes sperry", aesthetic: "Preppy", garmentType: "shoes" },
          { query: "headband preppy bow", aesthetic: "Preppy", garmentType: "accessories" },
          { query: "ribbon belt preppy", aesthetic: "Preppy", garmentType: "accessories" },
          { query: "plaid blazer jacket", aesthetic: "Preppy", garmentType: "outerwear" },
          { query: "ruffle collar blouse", aesthetic: "Preppy", garmentType: "tops" },
          { query: "striped rugby shirt", aesthetic: "Preppy", garmentType: "tops" },
          { query: "pleat front shorts", aesthetic: "Preppy", garmentType: "bottoms" },
          { query: "smocked sundress preppy", aesthetic: "Preppy", garmentType: "dresses" },

          // ── DARK ACADEMIA ─────────────────────────────────────────────────
          { query: "plaid wool trousers", aesthetic: "Dark Academia", garmentType: "bottoms" },
          { query: "corduroy trousers brown", aesthetic: "Dark Academia", garmentType: "bottoms" },
          { query: "pleated midi skirt plaid", aesthetic: "Dark Academia", garmentType: "bottoms" },
          { query: "pinstripe wide leg pants", aesthetic: "Dark Academia", garmentType: "bottoms" },
          { query: "turtleneck sweater brown", aesthetic: "Dark Academia", garmentType: "tops" },
          { query: "button down oxford shirt brown", aesthetic: "Dark Academia", garmentType: "tops" },
          { query: "vintage knit sweater vest", aesthetic: "Dark Academia", garmentType: "tops" },
          { query: "waistcoat vest tweed", aesthetic: "Dark Academia", garmentType: "tops" },
          { query: "oversized blazer tweed", aesthetic: "Dark Academia", garmentType: "outerwear" },
          { query: "wool overcoat dark", aesthetic: "Dark Academia", garmentType: "outerwear" },
          { query: "long cape coat", aesthetic: "Dark Academia", garmentType: "outerwear" },
          { query: "long cardigan academia", aesthetic: "Dark Academia", garmentType: "outerwear" },
          { query: "oxford shoes brown leather", aesthetic: "Dark Academia", garmentType: "shoes" },
          { query: "lace up ankle boots", aesthetic: "Dark Academia", garmentType: "shoes" },
          { query: "leather loafers dark", aesthetic: "Dark Academia", garmentType: "shoes" },
          { query: "leather satchel bag", aesthetic: "Dark Academia", garmentType: "accessories" },
          { query: "beret hat wool", aesthetic: "Dark Academia", garmentType: "accessories" },
          { query: "suspenders braces", aesthetic: "Dark Academia", garmentType: "accessories" },
          { query: "midi tea dress vintage", aesthetic: "Dark Academia", garmentType: "dresses" },
          { query: "linen shirt dress", aesthetic: "Dark Academia", garmentType: "dresses" },
          { query: "dark floral blouse", aesthetic: "Dark Academia", garmentType: "tops" },
          { query: "knit plaid scarf", aesthetic: "Dark Academia", garmentType: "accessories" },
          { query: "corduroy blazer", aesthetic: "Dark Academia", garmentType: "outerwear" },
          { query: "tartan skirt pleated", aesthetic: "Dark Academia", garmentType: "bottoms" },
          { query: "vintage library cardigan", aesthetic: "Dark Academia", garmentType: "tops" },

          // ── COTTAGE CORE ─────────────────────────────────────────────────
          { query: "floral midi skirt cottagecore", aesthetic: "Cottagecore", garmentType: "bottoms" },
          { query: "prairie maxi skirt", aesthetic: "Cottagecore", garmentType: "bottoms" },
          { query: "linen wide leg pants", aesthetic: "Cottagecore", garmentType: "bottoms" },
          { query: "smocked floral blouse", aesthetic: "Cottagecore", garmentType: "tops" },
          { query: "peasant top puff sleeve", aesthetic: "Cottagecore", garmentType: "tops" },
          { query: "linen ruffle top", aesthetic: "Cottagecore", garmentType: "tops" },
          { query: "vintage floral cardigan", aesthetic: "Cottagecore", garmentType: "outerwear" },
          { query: "linen blazer natural", aesthetic: "Cottagecore", garmentType: "outerwear" },
          { query: "prairie dress floral", aesthetic: "Cottagecore", garmentType: "dresses" },
          { query: "floral sundress midi", aesthetic: "Cottagecore", garmentType: "dresses" },
          { query: "smocked milkmaid dress", aesthetic: "Cottagecore", garmentType: "dresses" },
          { query: "white eyelet dress", aesthetic: "Cottagecore", garmentType: "dresses" },
          { query: "mary jane flats", aesthetic: "Cottagecore", garmentType: "shoes" },
          { query: "brown leather ankle boots", aesthetic: "Cottagecore", garmentType: "shoes" },
          { query: "woven straw hat sun", aesthetic: "Cottagecore", garmentType: "accessories" },
          { query: "wicker basket bag", aesthetic: "Cottagecore", garmentType: "accessories" },
          { query: "floral hair wreath headband", aesthetic: "Cottagecore", garmentType: "accessories" },
          { query: "embroidered linen shirt", aesthetic: "Cottagecore", garmentType: "tops" },
          { query: "lace trim camisole", aesthetic: "Cottagecore", garmentType: "tops" },
          { query: "apron pinafore dress", aesthetic: "Cottagecore", garmentType: "dresses" },
          { query: "ditsy floral wrap dress", aesthetic: "Cottagecore", garmentType: "dresses" },
          { query: "knit cream cardigan", aesthetic: "Cottagecore", garmentType: "outerwear" },
          { query: "woven leather sandals", aesthetic: "Cottagecore", garmentType: "shoes" },
          { query: "linen overalls", aesthetic: "Cottagecore", garmentType: "sets" },
          { query: "floral corset top", aesthetic: "Cottagecore", garmentType: "tops" },

          // ── BOHO ──────────────────────────────────────────────────────────
          { query: "boho flowy maxi skirt", aesthetic: "Boho", garmentType: "bottoms" },
          { query: "printed wide leg pants boho", aesthetic: "Boho", garmentType: "bottoms" },
          { query: "fringe suede skirt", aesthetic: "Boho", garmentType: "bottoms" },
          { query: "crochet crop top", aesthetic: "Boho", garmentType: "tops" },
          { query: "boho embroidered blouse", aesthetic: "Boho", garmentType: "tops" },
          { query: "off shoulder peasant top", aesthetic: "Boho", garmentType: "tops" },
          { query: "kimono boho wrap", aesthetic: "Boho", garmentType: "outerwear" },
          { query: "fringed vest boho", aesthetic: "Boho", garmentType: "outerwear" },
          { query: "suede fringe jacket", aesthetic: "Boho", garmentType: "outerwear" },
          { query: "boho maxi dress floral", aesthetic: "Boho", garmentType: "dresses" },
          { query: "wrap midi dress boho print", aesthetic: "Boho", garmentType: "dresses" },
          { query: "crochet maxi dress", aesthetic: "Boho", garmentType: "dresses" },
          { query: "leather ankle boots boho", aesthetic: "Boho", garmentType: "shoes" },
          { query: "platform sandals boho", aesthetic: "Boho", garmentType: "shoes" },
          { query: "fringe ankle boots", aesthetic: "Boho", garmentType: "shoes" },
          { query: "layered beaded necklace", aesthetic: "Boho", garmentType: "accessories" },
          { query: "woven crossbody bag", aesthetic: "Boho", garmentType: "accessories" },
          { query: "felt wide brim hat", aesthetic: "Boho", garmentType: "accessories" },
          { query: "crochet halter top", aesthetic: "Boho", garmentType: "tops" },
          { query: "lace trim shorts boho", aesthetic: "Boho", garmentType: "bottoms" },
          { query: "boho printed shirt", aesthetic: "Boho", garmentType: "tops" },
          { query: "suede patchwork skirt", aesthetic: "Boho", garmentType: "bottoms" },
          { query: "embroidered denim jacket", aesthetic: "Boho", garmentType: "outerwear" },
          { query: "boho tassel earrings", aesthetic: "Boho", garmentType: "accessories" },
          { query: "tiered ruffle dress", aesthetic: "Boho", garmentType: "dresses" },

          // ── GRUNGE ────────────────────────────────────────────────────────
          { query: "distressed black denim jeans", aesthetic: "Grunge", garmentType: "bottoms" },
          { query: "plaid flannel pants", aesthetic: "Grunge", garmentType: "bottoms" },
          { query: "ripped skinny jeans", aesthetic: "Grunge", garmentType: "bottoms" },
          { query: "band tee vintage", aesthetic: "Grunge", garmentType: "tops" },
          { query: "flannel shirt grunge", aesthetic: "Grunge", garmentType: "tops" },
          { query: "oversized black hoodie", aesthetic: "Grunge", garmentType: "tops" },
          { query: "fishnet top", aesthetic: "Grunge", garmentType: "tops" },
          { query: "distressed graphic tee", aesthetic: "Grunge", garmentType: "tops" },
          { query: "black leather moto jacket", aesthetic: "Grunge", garmentType: "outerwear" },
          { query: "oversized plaid flannel shirt", aesthetic: "Grunge", garmentType: "outerwear" },
          { query: "vintage denim jacket distressed", aesthetic: "Grunge", garmentType: "outerwear" },
          { query: "black doc martens boots", aesthetic: "Grunge", garmentType: "shoes" },
          { query: "platform combat boots", aesthetic: "Grunge", garmentType: "shoes" },
          { query: "chunky boots lug sole", aesthetic: "Grunge", garmentType: "shoes" },
          { query: "studded belt chain", aesthetic: "Grunge", garmentType: "accessories" },
          { query: "choker necklace grunge", aesthetic: "Grunge", garmentType: "accessories" },
          { query: "beanie knit black", aesthetic: "Grunge", garmentType: "accessories" },
          { query: "black mini skirt vinyl", aesthetic: "Grunge", garmentType: "bottoms" },
          { query: "black cargo pants grunge", aesthetic: "Grunge", garmentType: "bottoms" },
          { query: "grunge plaid skirt", aesthetic: "Grunge", garmentType: "bottoms" },
          { query: "black slip dress grunge", aesthetic: "Grunge", garmentType: "dresses" },
          { query: "vintage band crewneck", aesthetic: "Grunge", garmentType: "tops" },
          { query: "fishnet tights", aesthetic: "Grunge", garmentType: "accessories" },
          { query: "black turtleneck grunge", aesthetic: "Grunge", garmentType: "tops" },
          { query: "ripped denim shorts", aesthetic: "Grunge", garmentType: "bottoms" },

          // ── SOFT GIRL ─────────────────────────────────────────────────────
          { query: "pink pleated mini skirt", aesthetic: "Soft Girl", garmentType: "bottoms" },
          { query: "floral ruffle skirt", aesthetic: "Soft Girl", garmentType: "bottoms" },
          { query: "pastel wide leg jeans", aesthetic: "Soft Girl", garmentType: "bottoms" },
          { query: "pink shorts soft girl", aesthetic: "Soft Girl", garmentType: "bottoms" },
          { query: "pastel crop cardigan", aesthetic: "Soft Girl", garmentType: "tops" },
          { query: "baby tee pastel", aesthetic: "Soft Girl", garmentType: "tops" },
          { query: "pink ribbed crop top", aesthetic: "Soft Girl", garmentType: "tops" },
          { query: "floral smocked top", aesthetic: "Soft Girl", garmentType: "tops" },
          { query: "pink puff sleeve blouse", aesthetic: "Soft Girl", garmentType: "tops" },
          { query: "butterfly top pastel", aesthetic: "Soft Girl", garmentType: "tops" },
          { query: "pastel pink hoodie", aesthetic: "Soft Girl", garmentType: "outerwear" },
          { query: "pink denim jacket", aesthetic: "Soft Girl", garmentType: "outerwear" },
          { query: "pink mini dress soft", aesthetic: "Soft Girl", garmentType: "dresses" },
          { query: "floral babydoll dress", aesthetic: "Soft Girl", garmentType: "dresses" },
          { query: "chunky white sneakers", aesthetic: "Soft Girl", garmentType: "shoes" },
          { query: "pastel platform sneakers", aesthetic: "Soft Girl", garmentType: "shoes" },
          { query: "pink mary jane shoes", aesthetic: "Soft Girl", garmentType: "shoes" },
          { query: "butterfly hair clips set", aesthetic: "Soft Girl", garmentType: "accessories" },
          { query: "pearl headband", aesthetic: "Soft Girl", garmentType: "accessories" },
          { query: "pastel mini bag", aesthetic: "Soft Girl", garmentType: "accessories" },
          { query: "cloud print hoodie", aesthetic: "Soft Girl", garmentType: "tops" },
          { query: "strawberry print top", aesthetic: "Soft Girl", garmentType: "tops" },
          { query: "lace trim cami top", aesthetic: "Soft Girl", garmentType: "tops" },
          { query: "pink plaid skirt", aesthetic: "Soft Girl", garmentType: "bottoms" },
          { query: "pastel knit dress", aesthetic: "Soft Girl", garmentType: "dresses" },

          // ── E-GIRL / ALT ──────────────────────────────────────────────────
          { query: "plaid mini skirt egirl", aesthetic: "E-Girl", garmentType: "bottoms" },
          { query: "black ripped fishnets", aesthetic: "E-Girl", garmentType: "accessories" },
          { query: "plaid pants egirl", aesthetic: "E-Girl", garmentType: "bottoms" },
          { query: "black cargo pants egirl", aesthetic: "E-Girl", garmentType: "bottoms" },
          { query: "graphic crop hoodie", aesthetic: "E-Girl", garmentType: "tops" },
          { query: "striped long sleeve egirl", aesthetic: "E-Girl", garmentType: "tops" },
          { query: "anime graphic tee", aesthetic: "E-Girl", garmentType: "tops" },
          { query: "crop band tee", aesthetic: "E-Girl", garmentType: "tops" },
          { query: "black halter top", aesthetic: "E-Girl", garmentType: "tops" },
          { query: "oversized black hoodie egirl", aesthetic: "E-Girl", garmentType: "tops" },
          { query: "black leather jacket egirl", aesthetic: "E-Girl", garmentType: "outerwear" },
          { query: "thrift zip up jacket", aesthetic: "E-Girl", garmentType: "outerwear" },
          { query: "platform boots black", aesthetic: "E-Girl", garmentType: "shoes" },
          { query: "chunky black boots", aesthetic: "E-Girl", garmentType: "shoes" },
          { query: "chain necklace layered", aesthetic: "E-Girl", garmentType: "accessories" },
          { query: "claw clip egirl", aesthetic: "E-Girl", garmentType: "accessories" },
          { query: "black mini skirt egirl", aesthetic: "E-Girl", garmentType: "bottoms" },
          { query: "black slip dress egirl", aesthetic: "E-Girl", garmentType: "dresses" },
          { query: "black mesh top", aesthetic: "E-Girl", garmentType: "tops" },
          { query: "studded accessories punk", aesthetic: "E-Girl", garmentType: "accessories" },
          { query: "graphic skirt plaid", aesthetic: "E-Girl", garmentType: "bottoms" },
          { query: "black combat boots platform", aesthetic: "E-Girl", garmentType: "shoes" },
          { query: "color streak clip hair", aesthetic: "E-Girl", garmentType: "accessories" },
          { query: "heart print crop tee", aesthetic: "E-Girl", garmentType: "tops" },
          { query: "vinyl mini skirt", aesthetic: "E-Girl", garmentType: "bottoms" },

          // ── COQUETTE ─────────────────────────────────────────────────────
          { query: "pink satin mini skirt", aesthetic: "Coquette", garmentType: "bottoms" },
          { query: "lace trim skirt", aesthetic: "Coquette", garmentType: "bottoms" },
          { query: "tulle maxi skirt pink", aesthetic: "Coquette", garmentType: "bottoms" },
          { query: "bow ribbon skirt", aesthetic: "Coquette", garmentType: "bottoms" },
          { query: "lace corset top", aesthetic: "Coquette", garmentType: "tops" },
          { query: "pink bow top", aesthetic: "Coquette", garmentType: "tops" },
          { query: "ruffle blouse pink", aesthetic: "Coquette", garmentType: "tops" },
          { query: "satin cami top", aesthetic: "Coquette", garmentType: "tops" },
          { query: "sheer lace blouse", aesthetic: "Coquette", garmentType: "tops" },
          { query: "balletcore wrap top", aesthetic: "Coquette", garmentType: "tops" },
          { query: "pink faux fur jacket", aesthetic: "Coquette", garmentType: "outerwear" },
          { query: "lace cardigan", aesthetic: "Coquette", garmentType: "outerwear" },
          { query: "pink babydoll dress", aesthetic: "Coquette", garmentType: "dresses" },
          { query: "lace midi dress coquette", aesthetic: "Coquette", garmentType: "dresses" },
          { query: "satin slip dress pink", aesthetic: "Coquette", garmentType: "dresses" },
          { query: "tulle ballerina dress", aesthetic: "Coquette", garmentType: "dresses" },
          { query: "mary jane heels pink", aesthetic: "Coquette", garmentType: "shoes" },
          { query: "ballet flats satin ribbon", aesthetic: "Coquette", garmentType: "shoes" },
          { query: "pink bow hair accessories", aesthetic: "Coquette", garmentType: "accessories" },
          { query: "pearl jewelry set", aesthetic: "Coquette", garmentType: "accessories" },
          { query: "pink satin ribbon bag", aesthetic: "Coquette", garmentType: "accessories" },
          { query: "pink lace trim cardigan", aesthetic: "Coquette", garmentType: "outerwear" },
          { query: "pink corset bustier top", aesthetic: "Coquette", garmentType: "tops" },
          { query: "floral lace lingerie top", aesthetic: "Coquette", garmentType: "tops" },
          { query: "satin robe wrap dress", aesthetic: "Coquette", garmentType: "dresses" },

          // ── COASTAL GRANDMOTHER ───────────────────────────────────────────
          { query: "linen wide leg pants white", aesthetic: "Coastal Grandmother", garmentType: "bottoms" },
          { query: "linen midi skirt", aesthetic: "Coastal Grandmother", garmentType: "bottoms" },
          { query: "white linen trousers", aesthetic: "Coastal Grandmother", garmentType: "bottoms" },
          { query: "navy stripe linen pants", aesthetic: "Coastal Grandmother", garmentType: "bottoms" },
          { query: "crisp white button down", aesthetic: "Coastal Grandmother", garmentType: "tops" },
          { query: "nautical stripe top", aesthetic: "Coastal Grandmother", garmentType: "tops" },
          { query: "linen shirt blue stripe", aesthetic: "Coastal Grandmother", garmentType: "tops" },
          { query: "cashmere crewneck sweater", aesthetic: "Coastal Grandmother", garmentType: "tops" },
          { query: "linen blazer white", aesthetic: "Coastal Grandmother", garmentType: "outerwear" },
          { query: "navy cardigan", aesthetic: "Coastal Grandmother", garmentType: "outerwear" },
          { query: "white linen dress midi", aesthetic: "Coastal Grandmother", garmentType: "dresses" },
          { query: "striped linen dress", aesthetic: "Coastal Grandmother", garmentType: "dresses" },
          { query: "espadrilles canvas", aesthetic: "Coastal Grandmother", garmentType: "shoes" },
          { query: "white leather loafers", aesthetic: "Coastal Grandmother", garmentType: "shoes" },
          { query: "boat shoes dock", aesthetic: "Coastal Grandmother", garmentType: "shoes" },
          { query: "woven straw tote bag", aesthetic: "Coastal Grandmother", garmentType: "accessories" },
          { query: "wide brim sun hat", aesthetic: "Coastal Grandmother", garmentType: "accessories" },
          { query: "pearl drop earrings", aesthetic: "Coastal Grandmother", garmentType: "accessories" },
          { query: "navy linen blazer", aesthetic: "Coastal Grandmother", garmentType: "outerwear" },
          { query: "white cotton midi dress", aesthetic: "Coastal Grandmother", garmentType: "dresses" },
          { query: "classic trench coat beige", aesthetic: "Coastal Grandmother", garmentType: "outerwear" },
          { query: "striped midi dress cotton", aesthetic: "Coastal Grandmother", garmentType: "dresses" },
          { query: "linen ribbed top", aesthetic: "Coastal Grandmother", garmentType: "tops" },
          { query: "nautical scarf silk", aesthetic: "Coastal Grandmother", garmentType: "accessories" },
          { query: "linen wrap skirt", aesthetic: "Coastal Grandmother", garmentType: "bottoms" },

          // ── OLD MONEY ─────────────────────────────────────────────────────
          { query: "camel wool trousers", aesthetic: "Old Money", garmentType: "bottoms" },
          { query: "cream pleated trousers", aesthetic: "Old Money", garmentType: "bottoms" },
          { query: "plaid tailored pants", aesthetic: "Old Money", garmentType: "bottoms" },
          { query: "wool midi skirt", aesthetic: "Old Money", garmentType: "bottoms" },
          { query: "cashmere turtleneck cream", aesthetic: "Old Money", garmentType: "tops" },
          { query: "silk blouse ivory", aesthetic: "Old Money", garmentType: "tops" },
          { query: "cashmere polo sweater", aesthetic: "Old Money", garmentType: "tops" },
          { query: "classic white button down silk", aesthetic: "Old Money", garmentType: "tops" },
          { query: "camel double breasted blazer", aesthetic: "Old Money", garmentType: "outerwear" },
          { query: "wool overcoat camel", aesthetic: "Old Money", garmentType: "outerwear" },
          { query: "herringbone blazer jacket", aesthetic: "Old Money", garmentType: "outerwear" },
          { query: "shearling lined coat", aesthetic: "Old Money", garmentType: "outerwear" },
          { query: "leather loafers horsebit", aesthetic: "Old Money", garmentType: "shoes" },
          { query: "oxford shoes classic", aesthetic: "Old Money", garmentType: "shoes" },
          { query: "knee high leather boots", aesthetic: "Old Money", garmentType: "shoes" },
          { query: "structured leather bag", aesthetic: "Old Money", garmentType: "accessories" },
          { query: "silk neck scarf hermes", aesthetic: "Old Money", garmentType: "accessories" },
          { query: "gold cuff bracelet", aesthetic: "Old Money", garmentType: "accessories" },
          { query: "silk wrap dress", aesthetic: "Old Money", garmentType: "dresses" },
          { query: "shift dress tweed", aesthetic: "Old Money", garmentType: "dresses" },
          { query: "cashmere cardigan classic", aesthetic: "Old Money", garmentType: "tops" },
          { query: "wide leg wool pants", aesthetic: "Old Money", garmentType: "bottoms" },
          { query: "tailored vest suit", aesthetic: "Old Money", garmentType: "tops" },
          { query: "pearl necklace classic", aesthetic: "Old Money", garmentType: "accessories" },
          { query: "riding boots equestrian", aesthetic: "Old Money", garmentType: "shoes" },

          // ── VINTAGE ───────────────────────────────────────────────────────
          { query: "70s vintage flare pants", aesthetic: "Vintage", garmentType: "bottoms" },
          { query: "80s high waist jeans", aesthetic: "Vintage", garmentType: "bottoms" },
          { query: "90s windbreaker pants", aesthetic: "Vintage", garmentType: "bottoms" },
          { query: "vintage plaid trousers", aesthetic: "Vintage", garmentType: "bottoms" },
          { query: "70s shirt vintage print", aesthetic: "Vintage", garmentType: "tops" },
          { query: "80s band tee", aesthetic: "Vintage", garmentType: "tops" },
          { query: "90s polo shirt vintage", aesthetic: "Vintage", garmentType: "tops" },
          { query: "vintage turtleneck knit", aesthetic: "Vintage", garmentType: "tops" },
          { query: "vintage denim jacket 90s", aesthetic: "Vintage", garmentType: "outerwear" },
          { query: "80s leather jacket vintage", aesthetic: "Vintage", garmentType: "outerwear" },
          { query: "70s blazer vintage", aesthetic: "Vintage", garmentType: "outerwear" },
          { query: "90s windbreaker jacket", aesthetic: "Vintage", garmentType: "outerwear" },
          { query: "vintage midi dress 70s", aesthetic: "Vintage", garmentType: "dresses" },
          { query: "80s prom dress vintage", aesthetic: "Vintage", garmentType: "dresses" },
          { query: "vintage floral dress 90s", aesthetic: "Vintage", garmentType: "dresses" },
          { query: "vintage sneakers 90s", aesthetic: "Vintage", garmentType: "shoes" },
          { query: "old school nike shoes", aesthetic: "Vintage", garmentType: "shoes" },
          { query: "vintage platform heels", aesthetic: "Vintage", garmentType: "shoes" },
          { query: "vintage tote bag canvas", aesthetic: "Vintage", garmentType: "accessories" },
          { query: "retro sunglasses vintage", aesthetic: "Vintage", garmentType: "accessories" },
          { query: "80s vintage hat", aesthetic: "Vintage", garmentType: "accessories" },
          { query: "vintage corduroy jacket", aesthetic: "Vintage", garmentType: "outerwear" },
          { query: "70s wrap skirt", aesthetic: "Vintage", garmentType: "bottoms" },
          { query: "vintage knit cardigan", aesthetic: "Vintage", garmentType: "outerwear" },
          { query: "retro track jacket", aesthetic: "Vintage", garmentType: "outerwear" },

          // ── TECHWEAR ──────────────────────────────────────────────────────
          { query: "techwear cargo pants black", aesthetic: "Techwear", garmentType: "bottoms" },
          { query: "tactical utility pants", aesthetic: "Techwear", garmentType: "bottoms" },
          { query: "black jogger pants tech", aesthetic: "Techwear", garmentType: "bottoms" },
          { query: "techwear shorts straps", aesthetic: "Techwear", garmentType: "bottoms" },
          { query: "black zip turtleneck tech", aesthetic: "Techwear", garmentType: "tops" },
          { query: "techwear long sleeve top", aesthetic: "Techwear", garmentType: "tops" },
          { query: "tech fleece hoodie black", aesthetic: "Techwear", garmentType: "tops" },
          { query: "moisture wicking top black", aesthetic: "Techwear", garmentType: "tops" },
          { query: "techwear windbreaker jacket", aesthetic: "Techwear", garmentType: "outerwear" },
          { query: "tactical shell jacket", aesthetic: "Techwear", garmentType: "outerwear" },
          { query: "black puffer jacket techwear", aesthetic: "Techwear", garmentType: "outerwear" },
          { query: "utility vest tactical", aesthetic: "Techwear", garmentType: "outerwear" },
          { query: "black trail running shoes", aesthetic: "Techwear", garmentType: "shoes" },
          { query: "salomon sneakers techwear", aesthetic: "Techwear", garmentType: "shoes" },
          { query: "chunky black tactical boots", aesthetic: "Techwear", garmentType: "shoes" },
          { query: "chest rig bag tactical", aesthetic: "Techwear", garmentType: "accessories" },
          { query: "techwear waist bag", aesthetic: "Techwear", garmentType: "accessories" },
          { query: "face mask techwear", aesthetic: "Techwear", garmentType: "accessories" },
          { query: "black harness techwear", aesthetic: "Techwear", garmentType: "accessories" },
          { query: "black tactical gloves", aesthetic: "Techwear", garmentType: "accessories" },
          { query: "techwear layer jacket shell", aesthetic: "Techwear", garmentType: "outerwear" },
          { query: "black utility zip shorts", aesthetic: "Techwear", garmentType: "bottoms" },
          { query: "reflective tech pants", aesthetic: "Techwear", garmentType: "bottoms" },
          { query: "techwear ninja top", aesthetic: "Techwear", garmentType: "tops" },
          { query: "techwear black sneakers", aesthetic: "Techwear", garmentType: "shoes" },

          // ── SKATER ────────────────────────────────────────────────────────
          { query: "baggy skate jeans", aesthetic: "Skater", garmentType: "bottoms" },
          { query: "wide leg skate pants", aesthetic: "Skater", garmentType: "bottoms" },
          { query: "skate shorts baggy", aesthetic: "Skater", garmentType: "bottoms" },
          { query: "black chinos skate", aesthetic: "Skater", garmentType: "bottoms" },
          { query: "skate graphic tee", aesthetic: "Skater", garmentType: "tops" },
          { query: "thrasher tee", aesthetic: "Skater", garmentType: "tops" },
          { query: "long sleeve stripe skate", aesthetic: "Skater", garmentType: "tops" },
          { query: "vans hoodie skate", aesthetic: "Skater", garmentType: "tops" },
          { query: "flannel overshirt skate", aesthetic: "Skater", garmentType: "outerwear" },
          { query: "skate coach jacket", aesthetic: "Skater", garmentType: "outerwear" },
          { query: "baggy denim jacket skate", aesthetic: "Skater", garmentType: "outerwear" },
          { query: "vans old skool shoes", aesthetic: "Skater", garmentType: "shoes" },
          { query: "nike sb dunks", aesthetic: "Skater", garmentType: "shoes" },
          { query: "es accel skate shoes", aesthetic: "Skater", garmentType: "shoes" },
          { query: "dc shoes skate", aesthetic: "Skater", garmentType: "shoes" },
          { query: "five panel camp cap", aesthetic: "Skater", garmentType: "accessories" },
          { query: "beanie skate wool", aesthetic: "Skater", garmentType: "accessories" },
          { query: "skate backpack", aesthetic: "Skater", garmentType: "accessories" },
          { query: "vintage supreme tee", aesthetic: "Skater", garmentType: "tops" },
          { query: "santa cruz shirt", aesthetic: "Skater", garmentType: "tops" },
          { query: "anti hero tee", aesthetic: "Skater", garmentType: "tops" },
          { query: "independent trucks hat", aesthetic: "Skater", garmentType: "accessories" },
          { query: "element skate hoodie", aesthetic: "Skater", garmentType: "tops" },
          { query: "work pants skate", aesthetic: "Skater", garmentType: "bottoms" },
          { query: "corduroy skate pants", aesthetic: "Skater", garmentType: "bottoms" },
        ];

                const trendQueries = fashionTerms.map(t => ({ query: t.toLowerCase(), aesthetic: getAesthetic(t), garmentType: undefined as string | undefined }));

        // Real pieces from user scans — highest priority since these are what actual users wear
        const scannedPieces = await getScannedPieces(200);
        const scannedQueries = scannedPieces.map(p => ({
          query:       p.piece.toLowerCase(),
          aesthetic:   p.aesthetic,
          garmentType: p.garmentType ?? undefined,
        }));

        // scannedQueries first so they get seeded before curated/trend list
        const allQueries = [...scannedQueries, ...curatedBase, ...trendQueries];

        console.log(`[seed-trending] ${allQueries.length} queries (${scannedQueries.length} from scans + ${fashionTerms.length} from Trends + ${curatedBase.length} curated)`);

        // Run sequentially with delay, 8 items each, tagged with garmentType
        let seeded = 0;
        for (const { query, aesthetic, garmentType } of allQueries) {
          const r = await fetchDepopListings(query, aesthetic, 8, true, garmentType).catch(() => []);
          if (r.length) seeded++;
          await new Promise(r => setTimeout(r, 2_000));
        }
        console.log(`[seed-trending] done — seeded ${seeded}/${allQueries.length} queries permanently`);
        return { seeded, total: allQueries.length, trends: fashionTerms };
      } catch (e: any) {
        console.error("[seed-trending] error:", e.message);
        return { error: e.message };
      }
    };

    if (wait) {
      const result = await run();
      res.json(result);
    } else {
      res.json({ started: true, message: "Seeding trending cards in background" });
      run();
    }
  });

  // One-time: delete cached rows with empty titles so they get re-fetched with slug-derived titles
  // Cache stats — counts rows, listings, breakdown by aesthetic and permanent flag

  /**
   * POST /api/backfill-embeddings
   * Walks every depop_cache row with NULL embedding, generates an OpenAI
   * text-embedding-3-small vector for the query string, and stores it.
   * One-time admin endpoint to enable vector search on existing rows.
   * Returns immediately and runs the backfill in the background.
   *
   * Like Flask: @app.route("/api/backfill-embeddings", methods=["POST"])
   */
  app.post("/api/backfill-embeddings", async (req, res) => {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "OPENAI_API_KEY not set" });
    }
    res.json({ started: true, message: "Embedding backfill running in background" });

    void (async () => {
      try {
        const { getEmbedding } = await import("./storage");
        const pgmod = await import("postgres");
        const pg2 = pgmod.default;
        const c2 = pg2(process.env.DATABASE_URL!, { ssl: "require", max: 3 });
        let total = 0;
        let offset = 0;
        while (true) {
          const rows = await c2`
            SELECT id, query FROM depop_cache WHERE embedding IS NULL ORDER BY id LIMIT 100 OFFSET ${offset}
          ` as { id: number; query: string }[];
          if (!rows.length) break;
          for (const row of rows) {
            const vec = await getEmbedding(row.query);
            if (vec) {
              const vecStr = `[${vec.join(",")}]`;
              await c2`UPDATE depop_cache SET embedding = ${vecStr}::vector WHERE id = ${row.id}`;
            }
            await new Promise(r => setTimeout(r, 20));
          }
          total += rows.length;
          offset += rows.length;
          console.log(`[backfill] ${total} rows embedded`);
        }
        console.log(`[backfill] Complete: ${total} rows`);
        await c2.end();
      } catch (e) {
        console.error("[backfill] Error:", e);
      }
    })();
  });

  // ─────────────────────────────────────────────
  // FOR YOU — Personalized recommendations
  // ─────────────────────────────────────────────

  /**
   * POST /api/onboarding
   * Seeds a user's taste vector from their initial aesthetic picks.
   * For each picked aesthetic we pull ~50 cached listings, average their
   * embeddings, and store that as the user's starting taste_vector. The
   * For You feed then ranks by cosine similarity to this vector.
   *
   * Body: { userId: string, aesthetics: string[], gender?: "male"|"female"|"both" }
   *
   * Like Flask: @app.route("/api/onboarding", methods=["POST"])
   */
  app.post("/api/onboarding", async (req, res) => {
    try {
      const { userId, aesthetics, gender } = req.body as { userId: string; aesthetics: string[]; gender?: string };
      if (!userId || !aesthetics?.length) {
        return res.status(400).json({ error: "userId and aesthetics required" });
      }
      // Pass gender so the seed vector is built from gender-appropriate cache rows
      const tasteVector = await getAverageEmbeddingForAesthetics(aesthetics, gender);
      if (!tasteVector) {
        return res.status(500).json({ error: "Could not build taste vector" });
      }
      const deviceId = req.headers["x-device-id"] as string | undefined;
      await upsertUserProfile(userId, tasteVector, 0, undefined, undefined, true, deviceId);
      // Save gender preference if provided
      if (gender && ["male", "female", "both"].includes(gender)) {
        const { default: pg } = await import("postgres");
        const c = pg(process.env.DATABASE_URL!, { ssl: "require" });
        await c`UPDATE user_profiles SET gender = ${gender} WHERE user_id = ${userId}`;
        await c.end();
      }
      res.json({ success: true, aesthetics, dimensions: tasteVector.length });
    } catch (e: any) {
      console.error("[onboarding]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * PATCH /api/user-gender/:userId
   * Updates a user's gender preference (male/female/both) and re-seeds their
   * taste vector with gender-appropriate cached embeddings so the feed
   * updates immediately. UPSERTs so brand-new users also get a row.
   *
   * Body: { gender: "male"|"female"|"both" }
   *
   * Like Flask: @app.route("/api/user-gender/<user_id>", methods=["PATCH"])
   */
  app.patch("/api/user-gender/:userId", async (req, res) => {
    try {
      const { gender } = req.body as { gender: string };
      const userId = req.params.userId;
      const deviceId = req.headers["x-device-id"] as string | undefined;
      if (!await verifyUserOwnership(userId, deviceId)) {
        return res.status(403).json({ error: "device mismatch" });
      }
      if (!["male", "female", "both"].includes(gender)) {
        return res.status(400).json({ error: "gender must be male | female | both" });
      }
      const { default: pg } = await import("postgres");
      const c = pg(process.env.DATABASE_URL!, { ssl: "require" });
      // UPSERT so new users get a row with the correct gender, not just an UPDATE that hits 0 rows
      await c`
        INSERT INTO user_profiles (user_id, gender, interaction_count, liked_ids, skipped_ids, onboarded, liked_items, device_id)
        VALUES (${userId}, ${gender}, 0, '{}', '{}', false, '[]', ${deviceId || null})
        ON CONFLICT (user_id) DO UPDATE SET gender = EXCLUDED.gender
      `;

      // Re-seed taste vector with gender-appropriate embeddings so the feed updates immediately.
      // Pull the user's current onboarding aesthetics from the existing vector direction,
      // or fall back to a sensible default set per gender.
      const defaultAesthetics: Record<string, string[]> = {
        male:   ["Streetwear", "Old Money", "Vintage", "Grunge", "Dark Academia"],
        female: ["Coquette", "Soft Girl", "Old Money", "Vintage", "Minimalist"],
        both:   ["Vintage", "Old Money", "Minimalist", "Streetwear", "Grunge"],
      };
      const aesthetics = defaultAesthetics[gender] ?? defaultAesthetics.both;
      const newVector = await getAverageEmbeddingForAesthetics(aesthetics, gender);
      if (newVector) {
        await c`UPDATE user_profiles SET taste_vector = ${JSON.stringify(newVector)}::vector WHERE user_id = ${userId}`;
      }

      await c.end();
      res.json({ success: true, gender, vectorReseeded: !!newVector });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/interact
   * Records a like/save/skip on a single Depop item and updates the user's
   * taste vector using a weighted running average:
   *   taste_vector = (taste_vector * n + item_embedding * weight) / (n + |weight|)
   * Then normalizes the result to unit length so cosine similarity stays stable.
   *
   * Weights: save=+3 (strong positive), like=+1, skip=-0.5 (mild negative).
   *
   * Body: { userId, itemId, action: "like"|"save"|"skip", query, item? }
   * `query` is the depop_cache query key — we fetch its embedding to update the vector.
   *
   * Like Flask: @app.route("/api/interact", methods=["POST"])
   */
  app.post("/api/interact", async (req, res) => {
    try {
      const { userId, itemId, action, query } = req.body as {
        userId: string; itemId: string; action: "like" | "save" | "skip"; query: string;
      };
      if (!userId || !itemId || !action) {
        return res.status(400).json({ error: "userId, itemId, action required" });
      }
      const deviceId = req.headers["x-device-id"] as string | undefined;
      if (!await verifyUserOwnership(userId, deviceId)) {
        return res.status(403).json({ error: "device mismatch" });
      }

      // Weights: save = 3, like = 1, skip = -0.5
      const WEIGHTS: Record<string, number> = { save: 3, like: 1, skip: -0.5 };
      const weight = WEIGHTS[action] ?? 1;

      // Get current profile
      const profile = await getUserProfile(userId);

      // Store liked/saved item FIRST — before any early returns — so history is always populated
      if (action === "like" || action === "save") {
        const fullItem = req.body.item as any;
        const stableId = (fullItem?.url && fullItem.url.startsWith("https://www.depop.com/products/"))
          ? fullItem.url
          : itemId;
        await appendLikedItem(userId, {
          id: stableId,
          title: (fullItem?.title || query || "").slice(0, 200),
          image: fullItem?.image || "",
          url: fullItem?.url || "",
          price: fullItem
            ? (typeof fullItem.price === "object"
              ? parseFloat(fullItem.price?.priceAmount || "0")
              : parseFloat(String(fullItem.price || 0)))
            : 0,
          brand: fullItem?.brand || fullItem?.brand_name || "",
          _aesthetic: fullItem?._aesthetic || "",
          likedAt: new Date().toISOString(),
        }).catch((e: any) => { console.error("[appendLikedItem]", e.message, e.stack); });
      }

      // Get embedding for the interacted item (via its query string)
      let itemEmbedding: number[] | null = null;
      if (query) {
        itemEmbedding = await getEmbedding(query);
      }

      if (!itemEmbedding) {
        return res.json({ success: true, updated: false, reason: "no embedding for item" });
      }

      const dim = 1536;
      let newVector: number[];

      if (!profile?.taste_vector) {
        // No existing vector — use item embedding directly (scaled by weight)
        newVector = itemEmbedding.map(v => v * Math.abs(weight));
      } else {
        // Update running weighted average:
        //   taste_vector = (taste_vector * n + item_embedding * weight) / (n + |weight|)
        // Postgres stores vectors as the text "[0.1,0.2,...]"; we strip the
        // brackets and parse to floats — like Python's
        //   [float(x) for x in s.strip("[]").split(",")]
        const currentVec = profile.taste_vector.slice(1, -1).split(",").map(Number);
        const n = profile.interaction_count || 1;
        // Apply exponential temporal decay so recent interactions pull the
        // vector slightly more than old history.
        const decay = 0.95;
        const effectiveOldWeight = n * decay;
        const totalWeight = effectiveOldWeight + Math.abs(weight);
        // `.map((v, i) => ...)` is the JS equivalent of a Python list
        // comprehension with index: `[f(v, i) for i, v in enumerate(xs)]`.
        newVector = currentVec.map((v, i) =>
          (v * effectiveOldWeight + itemEmbedding![i] * weight) / totalWeight
        );
      }

      // Normalize the vector to unit length (keeps cosine similarity stable).
      // `.reduce((sum, v) => sum + v*v, 0)` == Python `sum(v*v for v in xs)`.
      const magnitude = Math.sqrt(newVector.reduce((sum, v) => sum + v * v, 0));
      if (magnitude > 0) newVector = newVector.map(v => v / magnitude);

      if (newVector.some(v => !Number.isFinite(v))) {
        console.warn("[interact] vector validation failed — NaN/Infinity detected, skipping update");
        return res.json({ success: true, updated: false, reason: "vector_validation_failed" });
      }

      await upsertUserProfile(
        userId,
        newVector,
        Math.abs(weight),
        action !== "skip" ? itemId : undefined,
        action === "skip" ? itemId : undefined,
        undefined,
        deviceId
      );

      // Recompute taste clusters every 5 interactions (async, don't await)
      const newCount = (profile?.interaction_count || 0) + Math.abs(weight);
      if (newCount % 5 === 0) {
        recomputeTasteClusters(userId).catch((e: any) =>
          console.error("[recomputeTasteClusters]", e.message)
        );
      }

      res.json({ success: true, updated: true, action, interactionCount: (profile?.interaction_count || 0) + Math.abs(weight) });
    } catch (e: any) {
      console.error("[interact]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/for-you/:userId?offset=0&limit=20
   * Returns personalized Depop recommendations ranked by cosine similarity
   * to the user's taste vector. Excludes already-liked/skipped items and
   * applies the user's gender filter. Returns 404 if the user hasn't onboarded.
   *
   * Like Flask: @app.route("/api/for-you/<user_id>", methods=["GET"])
   */
  app.get("/api/for-you/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const offset = parseInt((req.query.offset as string) || "0", 10);
      const limit = Math.min(parseInt((req.query.limit as string) || "20", 10) || 20, 100);

      const profile = await getUserProfile(userId);
      if (!profile || !profile.onboarded) {
        return res.status(404).json({ error: "user_not_onboarded", onboarded: false });
      }

      const { items, hasMore } = await getForYouRecommendations(userId, limit, offset);
      res.json({ items, hasMore, interactionCount: profile.interaction_count });
    } catch (e: any) {
      console.error("[for-you]", e);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/user-profile/:userId
   * Lightweight existence check — used by the client to decide whether to
   * show the onboarding flow. Returns {exists, onboarded, interactionCount, gender}.
   *
   * Like Flask: @app.route("/api/user-profile/<user_id>", methods=["GET"])
   */
  app.get("/api/user-profile/:userId", async (req, res) => {
    try {
      const profile = await getUserProfile(req.params.userId);
      if (!profile) return res.json({ exists: false, onboarded: false });
      res.json({ exists: true, onboarded: profile.onboarded, interactionCount: profile.interaction_count, gender: profile.gender ?? "both" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/scanned-pieces
   * Returns the top 500 garment pieces that real users have had analysed,
   * sorted by scan_count DESC. Used by the seed-trending pipeline so the
   * Depop cache is biased toward what actual users wear.
   *
   * Like Flask: @app.route("/api/scanned-pieces", methods=["GET"])
   */
  app.get("/api/scanned-pieces", async (_req, res) => {
    try {
      const pieces = await getScannedPieces(500);
      res.json({ count: pieces.length, pieces });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/liked-items/:userId
   * Returns every Depop item the user has liked or saved, newest first.
   * Powers the History / Saved tab in the client.
   *
   * Like Flask: @app.route("/api/liked-items/<user_id>", methods=["GET"])
   */
  app.get("/api/liked-items/:userId", async (req, res) => {
    try {
      const items = await getLikedItems(req.params.userId);
      res.json({ items });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * DELETE /api/liked-items/:userId
   * Removes a single liked item from the user's saved list.
   *
   * Body: { itemKey: string }  // either the depop URL or the item id
   *
   * Like Flask: @app.route("/api/liked-items/<user_id>", methods=["DELETE"])
   */
  app.delete("/api/liked-items/:userId", async (req, res) => {
    try {
      const deviceId = req.headers["x-device-id"] as string | undefined;
      if (!await verifyUserOwnership(req.params.userId, deviceId)) {
        return res.status(403).json({ error: "device mismatch" });
      }
      const { itemKey } = req.body as { itemKey: string };
      if (!itemKey) return res.status(400).json({ error: "itemKey required" });
      await removeLikedItem(req.params.userId, itemKey);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/cache-stats
   * Admin/observability endpoint. Reports the row count + total listing count
   * in the depop_cache, broken down by aesthetic and permanent-flag status.
   * Useful for sanity-checking how full the cache is.
   *
   * Like Flask: @app.route("/api/cache-stats", methods=["GET"])
   */
  app.get("/api/cache-stats", async (req, res) => {
    try {
      const { default: pg } = await import("postgres");
      const c = pg(process.env.DATABASE_URL!, { ssl: "require" });
      const rows = await c`
        SELECT aesthetic, permanent,
               COUNT(*) as rows,
               SUM(jsonb_array_length(listings)) as listings
        FROM depop_cache
        GROUP BY aesthetic, permanent
        ORDER BY aesthetic, permanent
      `;
      const totals = await c`
        SELECT COUNT(*) as total_rows,
               SUM(jsonb_array_length(listings)) as total_listings,
               COUNT(*) FILTER (WHERE permanent = TRUE) as permanent_rows,
               SUM(jsonb_array_length(listings)) FILTER (WHERE permanent = TRUE) as permanent_listings,
               COUNT(*) FILTER (WHERE permanent = FALSE AND created_at > NOW() - INTERVAL '24 hours') as temp_rows,
               SUM(jsonb_array_length(listings)) FILTER (WHERE permanent = FALSE AND created_at > NOW() - INTERVAL '24 hours') as temp_listings
        FROM depop_cache
      `;
      await c.end();
      res.json({ totals: totals[0], byAesthetic: rows });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  /**
   * GET /api/fix-cache-titles
   * One-shot repair endpoint. Walks every depop_cache row and either:
   *   (a) deletes the row if all listings have no image (so the next scrape
   *       refills it), or
   *   (b) backfills a slug-derived title if every listing is missing a title.
   *
   * Like Flask: @app.route("/api/fix-cache-titles", methods=["GET"])
   */
  app.get("/api/fix-cache-titles", async (req, res) => {
    try {
      // Re-normalise in place: for each cached row, re-run normaliseDepopItem to fill titles
      const { default: pg } = await import("postgres");
      const client2 = pg(process.env.DATABASE_URL!, { ssl: "require" });
      const rows = await client2`SELECT id, query, aesthetic, listings FROM depop_cache`;
      let fixed = 0, deleted = 0;
      for (const row of rows) {
        const listings: any[] = row.listings;
        const missingImage = listings.every((l: any) => !l.image);
        if (missingImage) {
          // Images got wiped — delete row so it gets re-fetched from Apify
          await client2`DELETE FROM depop_cache WHERE id = ${row.id}`;
          deleted++;
          continue;
        }
        const needsTitleFix = listings.every((l: any) => !l.title);
        if (needsTitleFix) {
          const updated = listings.map((l: any) => ({
            ...l,
            title: row.query.replace(/\b\w/g, (c: string) => c.toUpperCase()),
          }));
          await client2`UPDATE depop_cache SET listings = ${client2.json(updated)} WHERE id = ${row.id}`;
          fixed++;
        }
      }
      await client2.end();
      res.json({ fixed, deleted, total: rows.length });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  /**
   * GET /api/debug-proxy?q=<query>
   * Diagnostics: try the first 3 proxies in PROXY_LIST against the real Depop
   * search API and return per-proxy status/latency. Used to verify proxies
   * are alive without poking the rest of the app.
   *
   * Like Flask: @app.route("/api/debug-proxy", methods=["GET"])
   */
  app.get("/api/debug-proxy", async (req, res) => {
    const q = (req.query.q as string) || "streetwear cargo pants";
    const proxyList = getProxyList();
    const maskedList = proxyList.map(p => p.replace(/:([^@/]+)@/, ":***@"));

    if (proxyList.length === 0) {
      return res.json({ ok: false, error: "No proxies found in PROXY_LIST", rawLength: (process.env.PROXY_LIST || "").length });
    }

    const { ProxyAgent, fetch: undiciFetch } = await import("undici");
    const searchUrl = `https://webapi.depop.com/api/v3/search/products/?what=${encodeURIComponent(q)}&sort=relevance&items_per_page=2&country=us&currency=USD&include_like_count=true`;
    const results: Record<string, string> = {};

    // Test first 3 proxies from the list
    for (let i = 0; i < Math.min(3, proxyList.length); i++) {
      const proxyUri = proxyList[i];
      const label = maskedList[i];
      const t0 = Date.now();
      try {
        const dispatcher = new ProxyAgent({ uri: proxyUri, connectTimeout: 12_000 });
        const r = await (undiciFetch as any)(searchUrl, {
          dispatcher,
          headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36", "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", "depop-client": "web", "Referer": "https://www.depop.com/search/?q=hoodie", "Origin": "https://www.depop.com", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-site" },
          signal: AbortSignal.timeout(15_000),
        });
        const elapsed = Date.now() - t0;
        if (r.ok) {
          const data = await r.json() as any;
          results[label] = `OK ${r.status} (${elapsed}ms) objects=${(data.objects||[]).length}`;
          return res.json({ ok: true, proxy: label, elapsed, totalProxies: proxyList.length, results });
        } else {
          const txt = await r.text().catch(() => "");
          results[label] = `HTTP ${r.status} (${elapsed}ms): ${txt.slice(0, 120)}`;
        }
      } catch (e: any) {
        const elapsed = Date.now() - t0;
        results[label] = `ERR (${elapsed}ms): ${e.message}`;
      }
    }

    res.json({ ok: false, totalProxies: proxyList.length, results });
  });

  /**
   * GET /api/debug-worker?q=<query>
   * Diagnostics: hit the Cloudflare Worker proxy and report status + latency.
   *
   * Like Flask: @app.route("/api/debug-worker", methods=["GET"])
   */
  app.get("/api/debug-worker", async (req, res) => {
    const q = (req.query.q as string) || "vintage dress";
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl) return res.json({ ok: false, error: "No WORKER_URL env var" });
    const targetUrl = `https://webapi.depop.com/api/v3/search/products/?what=${encodeURIComponent(q)}&sort=relevance&items_per_page=3&country=us&currency=USD&include_like_count=true`;
    try {
      const t0 = Date.now();
      const r = await fetch(`${workerUrl}/fetch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workerSecret ? { "Authorization": `Bearer ${workerSecret}` } : {}),
        },
        body: JSON.stringify({ url: targetUrl }),
        signal: AbortSignal.timeout(15_000),
      });
      const elapsed = Date.now() - t0;
      const text = await r.text();
      const parsed = text.startsWith("{") ? JSON.parse(text) : null;
      res.json({ ok: r.ok, status: r.status, elapsed, objects: (parsed?.products || parsed?.objects || []).length, preview: text.slice(0, 400) });
    } catch (e: any) {
      res.json({ ok: false, error: e.message, cause: e.cause ? String(e.cause) : undefined });
    }
  });

  /**
   * GET /api/debug-depop-direct?q=<query>
   * Diagnostics: hit api.depop.com directly with no proxy. Mostly useful to
   * confirm Render/whatever host is being blocked by Cloudflare.
   *
   * Like Flask: @app.route("/api/debug-depop-direct", methods=["GET"])
   */
  app.get("/api/debug-depop-direct", async (req, res) => {
    const q = (req.query.q as string) || "hoodie";
    const url = `https://webapi.depop.com/api/v3/search/products/?what=${encodeURIComponent(q)}&sort=relevance&items_per_page=3&country=us&currency=USD&include_like_count=true`;
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.depop.com/",
          "Origin": "https://www.depop.com",
          "depop-client": "web",
        },
        signal: AbortSignal.timeout(10_000),
      });
      const text = await r.text();
      const parsed = text.startsWith("{") ? JSON.parse(text) : null;
      res.json({ status: r.status, objects: parsed?.objects?.length ?? 0, preview: text.slice(0, 300) });
    } catch (e: any) {
      res.json({ error: e.message, cause: e.cause ? String(e.cause) : undefined });
    }
  });

  /**
   * GET /api/debug-apify
   * Diagnostics: verifies that APIFY_TOKEN works by starting a tiny 2-item
   * scrape and returning the raw Apify response.
   *
   * Like Flask: @app.route("/api/debug-apify", methods=["GET"])
   */
  app.get("/api/debug-apify", async (req, res) => {
    const token = process.env.APIFY_TOKEN;
    if (!token) return res.json({ error: "No APIFY_TOKEN env var" });
    try {
      const r = await fetch(
        `https://api.apify.com/v2/acts/piotrv1001~depop-listings-scraper/runs?token=${token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchQueries: ["minimalist white sneakers"], maxItems: 2 }),
          signal: AbortSignal.timeout(15_000),
        }
      );
      const text = await r.text();
      res.json({ status: r.status, body: text.slice(0, 1000) });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  /**
   * GET /api/debug-cache-type?aesthetic=X&garmentType=Y&colorHint=Z&limit=N
   * Diagnostics: inspect what getDepopCacheByEmbedding (or the keyword
   * fallback) returns for the given parameters. Prints titles so you can
   * verify the right kind of items come back.
   *
   * Like Flask: @app.route("/api/debug-cache-type", methods=["GET"])
   */
  app.get("/api/debug-cache-type", async (req, res) => {
    const aesthetic = (req.query.aesthetic as string) || "Y2K";
    const garmentType = (req.query.garmentType as string) || "bottoms";
    const colorHint = (req.query.colorHint as string) || "";
    const limit = parseInt((req.query.limit as string) || "10", 10);
    // Use vector search when colorHint provided, otherwise keyword fallback
    const byType = colorHint
      ? await getDepopCacheByEmbedding(colorHint, aesthetic, garmentType, limit, colorHint).catch((e: any) => ({ error: e.message }))
      : await getDepopCacheByType(aesthetic, garmentType, limit, "").catch((e: any) => ({ error: e.message }));
    const byAesthetic = await getDepopCacheByAesthetic(aesthetic, limit).catch((e: any) => ({ error: e.message }));
    res.json({
      aesthetic, garmentType, colorHint, limit,
      searchMode: colorHint ? "vector" : "keyword",
      byTypeCount: Array.isArray(byType) ? byType.length : 0,
      byTypeFirstTitles: Array.isArray(byType) ? byType.slice(0, limit).map((l: any) => l.title) : byType,
      byAestheticCount: Array.isArray(byAesthetic) ? byAesthetic.length : 0,
      byAestheticFirstTitles: Array.isArray(byAesthetic) ? byAesthetic.slice(0,3).map((l: any) => l.title) : byAesthetic,
    });
  });

  /**
   * POST /api/analyze
   * Accepts a multipart form upload (image file + optional userId via body,
   * deviceId via x-device-id header). Runs the two-pass Gemini analysis
   * (garment detection → aesthetic classification), generates per-garment
   * Depop query strings, saves the scan to the DB, returns { scanId },
   * and kicks off background cache-warming.
   *
   * Middleware chain (executed in order — like Flask `before_request` hooks):
   *   1. analyzeLimiter — throttle to 10 per IP per minute.
   *   2. upload.single("image") — parse multipart and put file on `req.file`,
   *      similar to Flask's `request.files["image"]`.
   *
   * Like Flask: @app.route("/api/analyze", methods=["POST"])
   */
  app.post("/api/analyze", analyzeLimiter, upload.single("image"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No image provided" });

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Gemini API key not configured" });

      const genAI = new GoogleGenerativeAI(apiKey);
      const imageBase64 = file.buffer.toString("base64");
      const mimeType = file.mimetype as "image/jpeg" | "image/png" | "image/webp";

      // ── PASS 1: Garment detection (gemini-2.5-flash-lite — cheaper, simpler task) ─────
      const detectionModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",
        systemInstruction: GARMENT_SYSTEM_INSTRUCTION,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GARMENT_SCHEMA as any,
          temperature: 0.0,
        },
      });

      const detectionResult = await geminiWithRetry(() =>
        detectionModel.generateContent([
          { inlineData: { data: imageBase64, mimeType } },
          "List every visible garment and accessory. Be specific with names and details.",
        ])
      );

      const detectionText = detectionResult.response.text();
      const detectionJson = detectionText.match(/\{[\s\S]*\}/);
      if (!detectionJson) throw new Error("Could not parse garment detection response");
      const garmentData = JSON.parse(detectionJson[0]);

      // Build specific Depop search queries from Pass 1 garment data
      // e.g. { item: "Wide-leg trousers", color: "tan", fabric: "corduroy", fit: "wide-leg" }
      //   → "tan corduroy wide-leg trousers"
      // Map detected item names to garment_type categories.
      // This is the same logic as `inferGarmentType` in storage.ts; we inline
      // it here so the analyse handler doesn't have to import it. Roughly
      // equivalent to a Python `if/elif/elif` chain on `re.search()` results.
      function inferGarmentType(item: string): string {
        const i = item.toLowerCase();
        if (/dress|gown|romper|jumpsuit/.test(i)) return "dresses";
        if (/skirt/.test(i)) return "bottoms";
        if (/pant|jean|trouser|shorts|legging|chino|cargo/.test(i)) return "bottoms";
        if (/jacket|coat|blazer|hoodie|cardigan|vest|puffer|windbreaker|bomber|parka/.test(i)) return "outerwear";
        if (/sneaker|shoe|boot|loafer|heel|flat|sandal|mule|oxford|espadrille/.test(i)) return "shoes";
        if (/hat|bag|purse|belt|scarf|necklace|earring|ring|bracelet|glasses|sunglasses|sock|glove/.test(i)) return "accessories";
        if (/tracksuit|set|co-ord|matching/.test(i)) return "sets";
        return "tops"; // default: t-shirt, top, blouse, shirt, tee, sweater, knit
      }

      // Aesthetic -> short Depop search prefix (how sellers actually tag)
      const AESTHETIC_PREFIX: Record<string, string> = {
        "Boho": "boho", "Coastal Grandmother": "coastal grandmother",
        "Coquette": "coquette", "Cottagecore": "cottagecore",
        "Dark Academia": "dark academia", "E-Girl": "e-girl",
        "Grunge": "grunge", "Minimalist": "minimalist", "Old Money": "old money",
        "Preppy": "preppy", "Skater": "skater", "Soft Girl": "soft girl",
        "Streetwear": "streetwear", "Techwear": "techwear",
        "Vintage": "vintage", "Y2K": "y2k",
      };

      // Turns a verbose Gemini description into a short Depop-native query.
      // Depop sellers tag items with short phrases ("y2k low rise jeans"),
      // so we need to strip noise (fabric blends, "sleeve"-ish words) and
      // prepend an aesthetic prefix. Resulting query is capped at 5 words.
      function stripToDepopQuery(verbose: string, aesthetic: string): string {
        let v = verbose.toLowerCase().trim();
        // Remove repeated adjacent words ("denim denim" -> "denim")
        v = v.replace(/\b(\w+) \1\b/g, "$1");
        // Strip filler fabric/material words that add search noise
        v = v.replace(/\b(cotton|polyester|synthetic|nylon|spandex|elastane|viscose|modal|rayon|acrylic|material|blend)\b/g, "");
        // Normalise verbose garment names to short Depop terms
        v = v.replace(/long[\s-]sleeve(?:d)?\s+(t-shirt|top|shirt|tee)\b/g, "long sleeve");
        v = v.replace(/short[\s-]sleeve(?:d)?\s+(t-shirt|top|shirt|tee)\b/g, "tee");
        v = v.replace(/\bt-shirt\b|\btshirt\b/g, "tee");
        v = v.replace(/wash\s+jeans\b/g, "jeans");
        v = v.replace(/athletic\s+shorts\b/g, "shorts");
        v = v.replace(/athletic\s+(jersey|top)\b/g, "jersey");
        v = v.replace(/high[\s-]?waist(?:ed)?/g, "high waist");
        v = v.replace(/over[\s-]?sized\b/g, "oversized");
        v = v.replace(/\s+/g, " ").trim();
        // Prepend aesthetic prefix
        const prefix = AESTHETIC_PREFIX[aesthetic] ?? aesthetic.toLowerCase();
        const result = v.startsWith(prefix) ? v : `${prefix} ${v}`;
        // Dedup again after prefix, then cap at 5 words
        return result.replace(/\b(\w+) \1\b/g, "$1").split(" ").slice(0, 5).join(" ");
      }

      // Combines color + fabric + item into a verbose phrase then runs it
      // through stripToDepopQuery. Skips accessories/non-clothing because
      // those rarely give useful Depop search results. Returns up to 4
      // {query, garmentType} pairs, one per detected garment.
      function buildGarmentQueries(garments: any[], aesthetic = "", userGender = "both"): { query: string; garmentType: string }[] {
        // Skip accessories and non-clothing items for Depop search
        const skipTypes = /hat|bag|purse|sunglasses|glasses|watch|jewelry|necklace|ring|earring|bracelet|belt|sock|perfume|scarf|glove|ball|volleyball|football|basketball|helmet|phone|bottle|prop/i;
        const usefulGarments = garments
          .filter((g: any) => !skipTypes.test(g.item))
          .slice(0, 4);

        const genderKeyword = userGender === "male" ? "men" : userGender === "female" ? "women" : "";

        return usefulGarments.map((g: any) => {
          const parts: string[] = [];
          if (g.color && g.color !== "unknown") parts.push(g.color);
          if (g.fabric && g.fabric !== "unknown" && g.fabric !== "fabric") parts.push(g.fabric);
          parts.push(g.item);
          const verbose = parts.join(" ").toLowerCase().trim();
          // Apply Depop-native query transformation: aesthetic prefix + stripped description
          let query = aesthetic ? stripToDepopQuery(verbose, aesthetic) : verbose;
          // Append gender keyword for better gender-matched results
          if (genderKeyword && !query.includes(genderKeyword)) {
            query = `${query} ${genderKeyword}`.trim();
          }
          return { query, garmentType: inferGarmentType(g.item) };
        });
      }

      // garmentQueries used after analysis is parsed below
      // Build without aesthetic first (aesthetic unknown until Pass 2 completes)
      const rawGarmentQueries = buildGarmentQueries(garmentData.garments || [], "");

      // Build a structured garment description to ground the aesthetic classification
      const garmentSummary = [
        `Detected garments:`,
        ...garmentData.garments.map((g: any) =>
          `- ${g.item}: ${g.color}, ${g.fabric} fabric, ${g.fit} fit${g.details !== "none" ? `, details: ${g.details}` : ""}`
        ),
        `Overall palette: ${garmentData.overallPalette}`,
        `Layering: ${garmentData.layering}`,
        `Gender expression: ${garmentData.perceivedGender}`,
      ].join("\n");

      // ── PASS 2: Aesthetic classification using detected garments ──────────
      // We feed the Pass 1 garment summary back into Pass 2 as text — this
      // is "chain-of-thought via separate calls", giving Pass 2 a clean
      // factual baseline so it doesn't have to redo detection.
      const classificationModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA as any,
          temperature: 0.0,
        },
      });

      const result = await geminiWithRetry(() =>
        classificationModel.generateContent([
          { inlineData: { data: imageBase64, mimeType } },
          `Garment inventory:\n${garmentSummary}\n\nClassify the aesthetic using the taxonomy and disambiguation rules.`,
        ])
      );

      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse Gemini response");

      const analysis = JSON.parse(jsonMatch[0]);

      const analyzeUserId = req.body?.userId as string | undefined;
      let userGender = "both";
      if (analyzeUserId) {
        const userProfile = await getUserProfile(analyzeUserId).catch(() => null);
        userGender = (userProfile as any)?.gender || "both";
      }

      // Rebuild with aesthetic prefix now that Pass 2 has returned the aesthetic
      const resolvedAesthetic: string = analysis.aesthetic || "";
      const aestheticGarmentQueries = rawGarmentQueries.length >= 2
        ? buildGarmentQueries(garmentData.garments || [], resolvedAesthetic, userGender)
        : (analysis.keyPieces || []).map((p: string) => ({
            query: stripToDepopQuery(p.toLowerCase(), resolvedAesthetic) + (userGender !== "both" ? ` ${userGender === "male" ? "men" : "women"}` : ""),
            garmentType: inferGarmentType(p),
          }));
      const garmentDepopQueries = aestheticGarmentQueries;

      // Build products from Gemini's split recommendations.
      // Pass 2 returns two arrays: outfitRecs ("get the look") and similarRecs
      // ("complete the look"). We tag each with a `type` so the client can
      // render them in separate carousels.
      const mapRecs = (recs: any[], type: string, startId: number) =>
        (recs || []).map((rec: any, i: number) => ({
          id: startId + i,
          name: rec.name,
          brand: rec.brand,
          price: rec.price,
          image: buildImageKeywords(rec.name),
          match: Math.max(75, 97 - i * 4),
          retailer: "Amazon",
          url: amazonUrl(rec.name, rec.brand),
          reason: rec.reason,
          type,
        }));

      const outfitProducts = mapRecs(analysis.outfitRecs, "outfit", 1);
      const similarProducts = mapRecs(analysis.similarRecs, "similar", 100);
      const products = [...outfitProducts, ...similarProducts];

      // Fallback: if new schema fields missing (old response), try legacy recommendations field
      const legacyProducts = (analysis.recommendations || []).map((rec: any, i: number) => ({
        id: i + 1,
        name: rec.name,
        brand: rec.brand,
        price: rec.price,
        image: buildImageKeywords(rec.name),
        match: Math.max(75, 97 - i * 4),
        retailer: "Amazon",
        url: amazonUrl(rec.name, rec.brand),
        reason: rec.reason,
        type: "outfit",
      }));

      // Use real products only — no mock fallback that would pollute the DB
      const finalProducts = products.length > 0 ? products : legacyProducts.length > 0 ? legacyProducts : [];
      const imageDataUrl = `data:${mimeType};base64,${imageBase64}`;

      // Sync primary style score to Gemini's actual confidence so it reflects reality
      const styleBreakdown = Array.isArray(analysis.styleBreakdown) ? analysis.styleBreakdown : [];
      if (styleBreakdown.length > 0) {
        styleBreakdown[0].score = analysis.confidence;
      }

      // Remap female-only aesthetics for male users before saving the scan
      if (analyzeUserId) {
        analysis.aesthetic = remapAestheticForGender(analysis.aesthetic, userGender);
      }

      const deviceId = req.headers["x-device-id"] as string | undefined;

      const scan = await storage.createScan({
        deviceId: deviceId || null,
        imageData: imageDataUrl,
        aesthetic: analysis.aesthetic,
        secondaryAesthetic: analysis.secondaryAesthetic || null,
        confidence: analysis.confidence,
        styleBreakdown: JSON.stringify(styleBreakdown),
        occasions: JSON.stringify(analysis.occasions),
        keyPieces: JSON.stringify(analysis.keyPieces || []),
        depopQueries: JSON.stringify(garmentDepopQueries.slice(0, 4).map((g: any) => ({ query: g.query, garmentType: g.garmentType }))),
        colorPalette: JSON.stringify(analysis.colorPalette),
        results: JSON.stringify(finalProducts),
      });

      res.json({ scanId: scan.id });

      // Track all key pieces for seed-trending (fire-and-forget, never blocks response)
      if (analysis.keyPieces?.length) {
        // Build garmentType map from garmentDepopQueries so pieces get categorised
        const gtMap: Record<string, string> = {};
        for (const { query, garmentType } of garmentDepopQueries) {
          if (garmentType) gtMap[query] = garmentType;
        }
        upsertScannedPieces(analysis.keyPieces, analysis.aesthetic, gtMap).catch(() => {});
      }

      // Post-analysis: serve Depop recommendations purely from the permanent cache.
      // No live scraping — pull by garmentType + aesthetic so results are always relevant.
      // This is "fire and forget" — the IIFE (Immediately Invoked Function
      // Expression, `(async () => { ... })()`) runs in the background after
      // res.json() has already returned to the client. Equivalent to
      // `asyncio.create_task(...)` in Python.
      if (garmentDepopQueries.length) {
        const aesthetic = analysis.aesthetic;
        const queries = garmentDepopQueries.slice(0, 4);
        (async () => {
          let served = 0;
          for (const { query: q, garmentType } of queries) {
            // Pull from permanent cache by garment type + aesthetic (falls back to aesthetic-only)
            let listings = await getDepopCacheByType(aesthetic, garmentType, 8).catch(() => []);
            if (!listings.length) {
              listings = await getDepopCacheByAesthetic(aesthetic, 8).catch(() => []);
            }
            if (listings.length) {
              await setDepopCache(q, listings, aesthetic, false, garmentType).catch(() => {});
              served++;
            }
          }
          console.log(`[depop] post-analysis: served ${served}/${queries.length} garment queries from cache for scanId=${scan.id}`);
        })();
      }
    } catch (err: any) {
      console.error("Analyze error:", err);
      res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Analysis failed. Please try again." : err.message || "Analysis failed" });
    }
  });

  /**
   * GET /api/scans
   * List all scans, or only this device's scans if the x-device-id header is
   * present. The list query excludes `image_data` to keep payloads small —
   * use GET /api/scans/:id for the full image.
   *
   * Like Flask: @app.route("/api/scans", methods=["GET"])
   */
  app.get("/api/scans", async (req, res) => {
    const deviceId = req.headers["x-device-id"] as string | undefined;
    const allScans = await storage.getScans(deviceId || undefined);
    res.json(allScans);
  });

  /**
   * GET /api/scans/:id
   * Return one scan with its full base64 image_data attached.
   * 404 if the id doesn't exist.
   *
   * Like Flask: @app.route("/api/scans/<int:id>", methods=["GET"])
   */
  app.get("/api/scans/:id", async (req, res) => {
    const scan = await storage.getScan(Number(req.params.id));
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    res.json(scan);
  });

  /**
   * DELETE /api/scans/:id
   * Removes the scan row from the DB.
   *
   * Like Flask: @app.route("/api/scans/<int:id>", methods=["DELETE"])
   */
  app.delete("/api/scans/:id", async (req, res) => {
    try {
      await storage.deleteScan(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/wardrobe
   * Returns every saved wardrobe item (manually uploaded by the user),
   * newest first.
   *
   * Like Flask: @app.route("/api/wardrobe", methods=["GET"])
   */
  app.get("/api/wardrobe", async (req, res) => {
    const userId = req.query.userId as string | undefined;
    const items = await storage.getWardrobeItems(userId);
    res.json(items);
  });

  /**
   * POST /api/wardrobe
   * Saves a new wardrobe item with its image (stored as a data URL).
   *
   * Multipart body: image file + { name, category, brand?, color?, aesthetic? }
   * Middleware: upload.single("image") — like Flask's `request.files["image"]`.
   *
   * Like Flask: @app.route("/api/wardrobe", methods=["POST"])
   */
  app.post("/api/wardrobe", upload.single("image"), async (req, res) => {
    try {
      const file = req.file;
      const { name, category, brand, color, aesthetic, userId } = req.body;
      if (!file || !name || !category) return res.status(400).json({ error: "Missing required fields" });

      const imageData = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const item = await storage.createWardrobeItem({ name, category, brand, color, aesthetic, imageData, source: "manual", userId: userId || null });
      res.json(item);
    } catch (err: any) {
      console.error("Wardrobe error:", err);
      res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Failed to save item. Please try again." : err.message });
    }
  });

  /**
   * DELETE /api/wardrobe/:id
   * Removes a wardrobe row.
   *
   * Like Flask: @app.route("/api/wardrobe/<int:id>", methods=["DELETE"])
   */
  app.delete("/api/wardrobe/:id", async (req, res) => {
    const userId = req.query.userId as string | undefined;
    await storage.deleteWardrobeItem(Number(req.params.id), userId);
    res.json({ ok: true });
  });

  /**
   * POST /api/wardrobe/auto-add
   * Adds a product from scan results directly to the wardrobe without requiring
   * a new image upload. Uses the product metadata + a placeholder image.
   *
   * Body: { name, category, brand, color, aesthetic, userId, imageUrl? }
   */
  app.post("/api/wardrobe/auto-add", async (req, res) => {
    try {
      const { name, category, brand, color, aesthetic, userId, imageUrl } = req.body;
      if (!name || !category || !userId) return res.status(400).json({ error: "Missing required fields" });

      const imageData = imageUrl || "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=400&q=80";
      const item = await storage.createWardrobeItem({
        name, category, brand: brand || "", color: color || "", aesthetic: aesthetic || "",
        imageData, source: "scan-result", userId: userId || null
      });
      res.json(item);
    } catch (err: any) {
      console.error("[wardrobe-auto-add]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Discover feed ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/discover?userId=xxx
   * Returns Discover feed cards. If userId is present, cards are ranked by
   * cosine similarity to that user's taste vector; otherwise newest first.
   *
   * Like Flask: @app.route("/api/discover", methods=["GET"])
   */
  app.get("/api/discover", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const gender = req.query.gender as string | undefined;
      let cards: any[];
      if (userId) {
        cards = await getDiscoverCardsByTaste(userId, gender);
      } else {
        cards = await storage.getDiscoverCards();
      }
      res.json(cards);
    } catch (err: any) {
      console.error("Discover fetch error:", err);
      res.status(500).json({ error: "Failed to fetch discover feed" });
    }
  });

  /**
   * GET /api/discover/trending?limit=N
   * Returns the top N most-liked Discover cards. Capped at 50.
   * Used for new users who don't have a taste vector yet.
   *
   * Like Flask: @app.route("/api/discover/trending", methods=["GET"])
   */
  app.get("/api/discover/trending", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const cards = await storage.getTrendingCards(limit);
      res.json(cards);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/discover/shop-the-look?aesthetic=X&pieces=piece1,piece2
   * For a given Discover card, return real Depop listings matching each
   * key piece. Normalises Gemini's variant aesthetic names (e.g. "E-Girl /
   * Alt" → "E-Girl") onto the 16 aesthetics we actually cache.
   *
   * Like Flask: @app.route("/api/discover/shop-the-look", methods=["GET"])
   */
  app.get("/api/discover/shop-the-look", async (req, res) => {
    try {
      const rawAesthetic = (req.query.aesthetic as string) || "";
      const piecesRaw = (req.query.pieces as string) || "";
      if (!rawAesthetic || !piecesRaw) {
        return res.status(400).json({ error: "Missing aesthetic or pieces" });
      }
      // Normalize Gemini variant labels → cached aesthetic (e.g. "E-Girl / Alt" → "E-Girl")
      const CACHED_AESTHETICS = ["Boho","Coastal Grandmother","Coquette","Cottagecore","Dark Academia","E-Girl","Grunge","Minimalist","Old Money","Preppy","Skater","Soft Girl","Streetwear","Techwear","Vintage","Y2K"];
      const AESTHETIC_FALLBACK: Record<string, string> = {
        "Clean Fit": "Minimalist", "Skatecore": "Skater", "Quiet Luxury": "Old Money",
        "Classic": "Old Money", "Casual": "Minimalist", "Normcore": "Minimalist",
        "Business Casual": "Old Money", "Rave": "E-Girl", "Retro-Futurism": "Techwear",
        "Glam": "Coquette", "Party": "Coquette", "Indie": "Vintage",
        "Dark Feminine": "Coquette", "Mob Wife": "Old Money", "Biker": "Grunge",
        "Punk": "Grunge", "Academia": "Dark Academia", "Light Academia": "Cottagecore",
        "Barbiecore": "Coquette", "Balletcore": "Soft Girl", "Coastal": "Coastal Grandmother",
        "Beach": "Boho", "Western": "Boho", "Grunge / Punk": "Grunge",
        "E-Girl / Alt": "E-Girl", "Athleisure": "Streetwear", "Sporty": "Streetwear",
        "Hip Hop": "Streetwear", "Tomboy": "Skater", "Androgynous": "Minimalist",
        "Smart Casual": "Minimalist", "Workwear": "Old Money", "Dark Romantic": "Coquette",
        "Fairycore": "Cottagecore", "Ethereal": "Soft Girl", "Kawaii": "Soft Girl",
        "Avant Garde": "Techwear",
      };
      const aesthetic = CACHED_AESTHETICS.includes(rawAesthetic)
        ? rawAesthetic
        : (AESTHETIC_FALLBACK[rawAesthetic] ?? "Minimalist");
      const keyPieces = piecesRaw.split(",").map((p: string) => p.trim()).filter(Boolean);
      const results = await getShopTheLookItems(aesthetic, keyPieces, 3);
      res.json(results);
    } catch (err: any) {
      console.error("[shop-the-look]", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/wardrobe/gap-recommendations/:userId
   * Finds garment categories the user owns fewer than 2 of, then recommends
   * taste-matched cached Depop items for those missing types.
   *
   * Like Flask: @app.route("/api/wardrobe/gap-recommendations/<user_id>", methods=["GET"])
   */
  app.get("/api/wardrobe/gap-recommendations/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      if (!userId) return res.status(400).json({ error: "Missing userId" });
      const wardrobeItems = await storage.getWardrobeItems(userId);
      const mapped = wardrobeItems.map((w: any) => ({
        name: w.name,
        category: w.category,
        brand: w.brand,
      }));
      const recs = await getWardrobeGapRecommendations(userId, mapped, 6);
      res.json(recs);
    } catch (err: any) {
      console.error("[wardrobe-gap]", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/discover/:id/similar?aesthetic=X&tags=a,b
   * Returns up to 4 other Discover cards most similar (by embedding cosine
   * distance) to the supplied aesthetic + tags, excluding the given id.
   *
   * Like Flask: @app.route("/api/discover/<int:id>/similar", methods=["GET"])
   */
  app.get("/api/discover/:id/similar", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });
      const aestheticParam = req.query.aesthetic as string;
      const tagsParam = req.query.tags as string;
      if (!aestheticParam) {
        return res.status(400).json({ error: "Pass ?aesthetic=X&tags=a,b" });
      }
      const tags = tagsParam ? tagsParam.split(",").map((t: string) => t.trim()) : [];
      const similar = await getSimilarDiscoverCards(aestheticParam, tags, id, 4);
      res.json(similar);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/discover/:id/like
   * Atomically increments likes_count on the card. Used so popular cards
   * surface in the trending endpoint and survive the daily prune.
   *
   * Like Flask: @app.route("/api/discover/<int:id>/like", methods=["POST"])
   */
  app.post("/api/discover/:id/like", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });
      await storage.incrementCardLikes(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/discover/reset
   * Admin: wipes all Discover cards and kicks off a fresh background seed
   * from Reddit. Useful when the prompt/taxonomy changes and old cards have
   * stale labels.
   *
   * Like Flask: @app.route("/api/discover/reset", methods=["DELETE"])
   */
  app.delete("/api/discover/reset", async (_req, res) => {
    try {
      await storage.clearDiscoverCards();
      console.log("[reset] Discover cards cleared — triggering fresh seed...");
      triggerSeedIfEmpty().catch(err => console.error("[reset] re-seed error:", err.message));
      res.json({ ok: true, message: "Cards cleared, re-seeding in background" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/discover/seed
   * Idempotent initial Reddit seed. If we already have ≥60 cards, no-ops.
   * Otherwise pulls 2 top-of-month posts per subreddit, runs them through
   * analyzeAndStore, and reports successes/errors.
   *
   * Like Flask: @app.route("/api/discover/seed", methods=["POST"])
   */
  app.post("/api/discover/seed", async (_req, res) => {
    try {
      const existing = await storage.discoverCardCount();
      if (existing >= 60) {
        return res.json({ ok: true, skipped: true, count: existing });
      }
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Gemini API key not configured" });
      const genAI = new GoogleGenerativeAI(apiKey);
      const results: any[] = [];
      const errors: string[] = [];
      for (const { sub, aesthetic } of SUBREDDIT_MAP) {
        try {
          const posts = await fetchSubredditImages(sub, 2, "month");
          for (const post of posts) {
            try {
              const card = await analyzeAndStore(post.imageUrl, post.postUrl, sub, aesthetic, genAI);
              if (card) results.push({ id: card.id, aesthetic: card.aesthetic, sub });
              await new Promise(r => setTimeout(r, 600));
            } catch (e: any) { errors.push(`${sub} image: ${e.message}`); }
          }
        } catch (e: any) { errors.push(`${sub}: ${e.message}`); }
      }
      res.json({ ok: true, seeded: results.length, errors, cards: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/depop-search
   * Front-end calls this with a list of Depop queries (one per key piece).
   * Behaviour:
   *   - Full cache hit → returns { cached: true, groups } instantly.
   *   - Partial / no cache → starts Apify runs for the missing queries and
   *     returns { cached: false, runs: [...] } so the client can poll
   *     /api/depop-poll. If Apify is unavailable, falls back to scoring
   *     items from the aesthetic-wide cache.
   *
   * Body: { queries: string[], aesthetic: string }
   *
   * Like Flask: @app.route("/api/depop-search", methods=["POST"])
   */
  // Helper: given a piece name + pool of listings, return the best-matching subset
  // by scoring how many words in the piece appear in the listing title.
  // Same shape as a Python: `sorted(pool, key=lambda l: score(l.title), reverse=True)[:limit]`.
  function matchListingsForPiece(piece: string, pool: any[], limit = 6): any[] {
    const words = piece.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored = pool.map(l => {
      const title = (l.title || "").toLowerCase();
      const score = words.filter(w => title.includes(w)).length;
      return { l, score };
    });
    // Sort by score desc, shuffle within same score for variety
    scored.sort((a, b) => b.score - a.score || Math.random() - 0.5);
    return scored.slice(0, limit).map(s => s.l);
  }

  app.post("/api/depop-search", async (req, res) => {
    const { queries, aesthetic = "" } = req.body as { queries: string[]; aesthetic?: string };
    if (!queries?.length) return res.status(400).json({ error: "Missing queries" });
    const token = process.env.APIFY_TOKEN;

    try {
      // Check cache for all queries in parallel.
      // `Promise.all(...)` is the JS equivalent of `asyncio.gather(...)`:
      // run every query lookup concurrently and wait for them all to finish.
      const cacheResults = await Promise.all(queries.map(async q => ({
        query: q,
        listings: await getDepopCache(q),
      })));

      const allCached = cacheResults.every(r => r.listings !== null);

      if (allCached) {
        // Full cache hit — return instantly
        const groups = cacheResults
          .map(r => ({
            piece: r.query.includes(" ") ? r.query.split(" ").slice(1).join(" ") : r.query,
            listings: r.listings!,
          }))
          .filter(g => g.listings.length > 0);
        console.log(`[depop] full cache hit for ${queries.length} queries`);
        return res.json({ cached: true, groups });
      }

      // Partial or no cache — serve cached results + aesthetic fallback for misses
      const uncached = cacheResults.filter(r => !r.listings);
      let runs: { query: string; runId: string; datasetId: string }[] = [];

      if (token) {
        const runPromises = uncached.map(async ({ query: q }) => {
          try {
            const r = await fetch(
              `https://api.apify.com/v2/acts/piotrv1001~depop-listings-scraper/runs?token=${token}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ searchQueries: [q], maxItems: 6 }),
                signal: AbortSignal.timeout(15_000),
              }
            );
            const d = await r.json();
            // Detect quota / auth errors
            if (d.error) {
              console.warn(`[depop] Apify error for "${q}": ${d.error?.message || JSON.stringify(d.error)}`);
              return null;
            }
            console.log(`[depop] started run for "${q}" runId=${d.data?.id}`);
            return { query: q, runId: d.data?.id as string, datasetId: d.data?.defaultDatasetId as string };
          } catch (e: any) {
            console.error(`[depop] start failed for "${q}":`, e.message);
            return null;
          }
        });
        runs = (await Promise.all(runPromises))
          .filter((r): r is { query: string; runId: string; datasetId: string } => !!r?.runId);
      }

      // Cached groups from exact query matches
      const cachedGroups = cacheResults
        .filter(r => r.listings)
        .map(r => ({
          piece: r.query.includes(" ") ? r.query.split(" ").slice(1).join(" ") : r.query,
          listings: r.listings!,
        }))
        .filter(g => g.listings.length > 0);

      // --- Fallback: all uncached queries use aesthetic cache (no live scraping) ---
      const queriesNeedingFallback = uncached
        .filter(r => !runs.find(run => run.query === r.query))
        .map(r => r.query);

      if (queriesNeedingFallback.length > 0) {
        console.log(`[depop] Apify unavailable for ${queriesNeedingFallback.length} queries — using aesthetic cache fallback for "${aesthetic}"`);
        // Pull a generous pool from the aesthetic permanent cache
        const pool = await getDepopCacheByAesthetic(aesthetic, 150);
        if (pool.length > 0) {
          const fallbackGroups = queriesNeedingFallback.map(q => {
            const piece = q.includes(" ") ? q.split(" ").slice(1).join(" ") : q;
            const listings = matchListingsForPiece(piece, pool, 6);
            return { piece, listings };
          }).filter(g => g.listings.length > 0);
          // Merge with any already-cached groups
          const allGroups = [...cachedGroups, ...fallbackGroups];
          return res.json({ cached: true, groups: allGroups });
        }
      }

      res.json({ cached: false, cachedGroups, runs, aesthetic });
    } catch (err: any) {
      console.error("[depop-search] Error:", err.message);
      res.status(500).json({ error: "Search failed" });
    }
  });

  // All 16 aesthetics + broad queries — seeds ~288 listings (48 queries × 6 items)
  const DEFAULT_FEED_AESTHETICS = ["Streetwear", "Minimalist", "Y2K", "Preppy", "Dark Academia", "Cottagecore", "Techwear", "Vintage", "Boho", "Grunge", "Old Money", "E-Girl", "Soft Girl", "Skater", "Coastal Grandmother", "Coquette"];
  const DEFAULT_FEED_QUERIES: { query: string; aesthetic: string }[] = [
    { query: "streetwear oversized hoodie", aesthetic: "Streetwear" },
    { query: "streetwear cargo pants", aesthetic: "Streetwear" },
    { query: "streetwear graphic tee", aesthetic: "Streetwear" },
    { query: "minimalist linen shirt", aesthetic: "Minimalist" },
    { query: "minimalist wide leg trousers", aesthetic: "Minimalist" },
    { query: "minimalist white sneakers", aesthetic: "Minimalist" },
    { query: "y2k butterfly top", aesthetic: "Y2K" },
    { query: "y2k low rise jeans", aesthetic: "Y2K" },
    { query: "y2k baby tee", aesthetic: "Y2K" },
    { query: "preppy polo shirt", aesthetic: "Preppy" },
    { query: "preppy plaid skirt", aesthetic: "Preppy" },
    { query: "preppy cable knit sweater", aesthetic: "Preppy" },
    { query: "dark academia blazer", aesthetic: "Dark Academia" },
    { query: "dark academia turtleneck", aesthetic: "Dark Academia" },
    { query: "dark academia plaid trousers", aesthetic: "Dark Academia" },
    { query: "cottagecore floral dress", aesthetic: "Cottagecore" },
    { query: "cottagecore linen blouse", aesthetic: "Cottagecore" },
    { query: "cottagecore prairie skirt", aesthetic: "Cottagecore" },
    { query: "techwear joggers", aesthetic: "Techwear" },
    { query: "techwear windbreaker", aesthetic: "Techwear" },
    { query: "techwear utility vest", aesthetic: "Techwear" },
    { query: "vintage 90s denim jacket", aesthetic: "Vintage" },
    { query: "vintage band tee", aesthetic: "Vintage" },
    { query: "vintage corduroy pants", aesthetic: "Vintage" },
    { query: "boho maxi dress", aesthetic: "Boho" },
    { query: "boho crochet top", aesthetic: "Boho" },
    { query: "boho wrap skirt", aesthetic: "Boho" },
    { query: "grunge flannel shirt", aesthetic: "Grunge" },
    { query: "grunge ripped jeans", aesthetic: "Grunge" },
    { query: "grunge combat boots", aesthetic: "Grunge" },
    { query: "old money cashmere sweater", aesthetic: "Old Money" },
    { query: "old money tailored trousers", aesthetic: "Old Money" },
    { query: "old money silk blouse", aesthetic: "Old Money" },
    { query: "egirl mesh top", aesthetic: "E-Girl" },
    { query: "egirl plaid mini skirt", aesthetic: "E-Girl" },
    { query: "egirl platform boots", aesthetic: "E-Girl" },
    { query: "soft girl cardigan", aesthetic: "Soft Girl" },
    { query: "soft girl floral set", aesthetic: "Soft Girl" },
    { query: "soft girl pastel hoodie", aesthetic: "Soft Girl" },
    { query: "skater baggy jeans", aesthetic: "Skater" },
    { query: "skater oversized tee", aesthetic: "Skater" },
    { query: "skater vans sneakers", aesthetic: "Skater" },
    { query: "coastal grandmother linen pants", aesthetic: "Coastal Grandmother" },
    { query: "coastal grandmother striped top", aesthetic: "Coastal Grandmother" },
    { query: "coastal grandmother knit cardigan", aesthetic: "Coastal Grandmother" },
    { query: "coquette bow dress", aesthetic: "Coquette" },
    { query: "coquette lace top", aesthetic: "Coquette" },
    { query: "coquette ballet flats", aesthetic: "Coquette" },
  ];

  /**
   * GET /api/depop-feed?aesthetics=<json array>&userId=&gender=
   * Builds the home feed: pulls up to 50 listings per aesthetic (3 aesthetics
   * max), dedupes across aesthetics by URL, filters by gender. If no cache
   * exists yet, kicks off background seeding for the default query set.
   *
   * Like Flask: @app.route("/api/depop-feed", methods=["GET"])
   */
  // Gender filter: use pre-tagged _gender field when available, fall back to title regex.
  // The `_gender` field is added by storage.tagListingGender at write time.
  function feedGenderOk(l: any, gender: string): boolean {
    if (!gender || gender === "both") return true;
    const g = l._gender;
    if (g === "both" || !g) return listingGenderOk(l, gender);
    return g === gender;
  }

  app.get("/api/depop-feed", async (req, res) => {
    const { aesthetics: aestheticsRaw = "[]", userId = "", gender: genderParam = "" } = req.query as Record<string, string>;
    let aesthetics: string[] = [];
    try { aesthetics = JSON.parse(aestheticsRaw); } catch { aesthetics = []; }

    // Resolve gender: DB is authoritative only when explicitly male/female.
    // If DB says "both" or is missing, trust the client-sent param instead.
    let gender = genderParam || "both";
    if (userId) {
      try {
        const profile = await getUserProfile(userId);
        const dbGender = profile && (profile as any).gender;
        if (dbGender === "male" || dbGender === "female") gender = dbGender;
      } catch {}
    }

    // For home feed, use top 3 user aesthetics or first 3 defaults — 3 × 50 = 150 listings max
    const topDefaults = DEFAULT_FEED_AESTHETICS.slice(0, 3);
    // Filter out female-only aesthetics for male users before querying cache
    const filterAesthetics = (list: string[]) =>
      gender === "male" ? list.filter(a => !FEMALE_ONLY_AESTHETICS.has(a)) : list;
    const targetAesthetics = filterAesthetics(
      aesthetics.length ? aesthetics.slice(0, 3) : topDefaults
    );
    try {
      // Pull more per aesthetic when gender filtering to compensate for filtered items
      const perAesthetic = gender === "both" ? 50 : 100;
      const results = await Promise.all(
        targetAesthetics.map(a => getDepopCacheByAesthetic(a, perAesthetic))
      );
      // Cross-aesthetic dedup + gender filter
      const seenUrls = new Set<string>();
      const listings = results.flat().filter((l: any) => {
        const key = l.url || l.product_link || (l.image ? l.image.split('?')[0] : '');
        if (!key || seenUrls.has(key)) return false;
        if (!feedGenderOk(l, gender)) return false;
        seenUrls.add(key);
        return true;
      }).slice(0, 150); // cap at 150
      // If nothing cached yet, fire background seed for all default queries
      if (!listings.length) {
        // Run in batches of 8 to avoid overwhelming Apify free tier
        const batches: typeof DEFAULT_FEED_QUERIES[] = [];
        for (let i = 0; i < DEFAULT_FEED_QUERIES.length; i += 8)
          batches.push(DEFAULT_FEED_QUERIES.slice(i, i + 8));
        (async () => {
          let seeded = 0;
          for (const batch of batches) {
            const res = await Promise.all(batch.map(({ query, aesthetic }) =>
              fetchDepopListings(query, aesthetic, 6).catch(() => [])
            ));
            seeded += res.filter(a => a.length).length;
            await new Promise(r => setTimeout(r, 2000)); // small gap between batches
          }
          console.log(`[depop-feed] seeded ${seeded}/${DEFAULT_FEED_QUERIES.length} queries`);
        })().catch(() => {});
      }
      res.json({ listings, seeding: !listings.length });
    } catch (err: any) {
      console.error("[depop-feed] error:", err.message);
      res.json({ listings: [] });
    }
  });

  /**
   * GET /api/depop-poll?runs=<json>&aesthetic=<str>
   * Client polls this every couple seconds after /api/depop-search returned
   * { cached: false, runs }. Once every Apify run has status SUCCEEDED we
   * fetch the dataset, cache the listings, and return them in `groups`.
   *
   * Like Flask: @app.route("/api/depop-poll", methods=["GET"])
   */
  app.get("/api/depop-poll", async (req, res) => {
    const { runs: runsRaw = "[]", aesthetic = "" } = req.query as Record<string, string>;
    const runs: { query: string; runId: string; datasetId: string }[] = JSON.parse(runsRaw);
    if (!runs.length) return res.status(400).json({ error: "Missing runs" });
    const token = process.env.APIFY_TOKEN;
    if (!token) return res.status(503).json({ error: "Depop search not configured" });
    try {
      const statusResults = await Promise.all(runs.map(async run => {
        const r = await fetch(`https://api.apify.com/v2/actor-runs/${run.runId}?token=${token}`,
          { signal: AbortSignal.timeout(8_000) });
        if (!r.ok) return { ...run, status: "running" };
        const d = await r.json();
        return { ...run, status: d.data?.status as string };
      }));

      const allDone = statusResults.every(r => r.status === "SUCCEEDED");
      const anyFailed = statusResults.some(r => ["FAILED","ABORTED","TIMED-OUT"].includes(r.status));
      if (anyFailed && !allDone) return res.json({ status: "failed" });
      if (!allDone) return res.json({ status: "running" });

      // All done — fetch datasets + cache results
      const groups = (await Promise.all(statusResults.map(async run => {
        const dataRes = await fetch(
          `https://api.apify.com/v2/datasets/${run.datasetId}/items?token=${token}&limit=4`,
          { signal: AbortSignal.timeout(10_000) }
        );
        if (!dataRes.ok) return null;
        const items: any[] = await dataRes.json();
        const listings = items.map((item, idx) => normaliseDepopItem(item, idx, run.query)).filter(l => l && l.image);
        if (listings.length) {
          await setDepopCache(run.query, listings, aesthetic).catch(() => {});
        }
        const pieceName = run.query.includes(" ") ? run.query.split(" ").slice(1).join(" ") : run.query;
        return listings.length ? { piece: pieceName, listings } : null;
      }))).filter(Boolean) as { piece: string; listings: any[] }[];

      console.log(`[depop-poll] done: ${groups.length} groups`);
      res.json({ status: "done", groups });
    } catch (err: any) {
      console.error("[depop-poll] Error:", err.message);
      res.status(500).json({ error: "Poll failed" });
    }
  });

  /**
   * GET /api/depop-ready/:scanId
   * Called by the client right after /api/analyze returns. Reads the scan's
   * saved depopQueries, semantic-searches the permanent cache via vector
   * embeddings (cosine similarity on the query strings), and returns
   * { ready: true, groups: [{ piece, listings }, ...] }. Always serves from
   * cache — no live scraping in the user-visible path so it stays instant.
   *
   * Like Flask: @app.route("/api/depop-ready/<int:scan_id>", methods=["GET"])
   */
  app.get("/api/depop-ready/:scanId", async (req, res) => {
    const scanId = parseInt(req.params.scanId, 10);
    if (isNaN(scanId)) return res.status(400).json({ error: "Invalid scanId" });

    // Map aesthetics Gemini may return → nearest cached aesthetic label
    const AESTHETIC_FALLBACK: Record<string, string> = {
      "Clean Fit":        "Minimalist",
      "Skatecore":        "Skater",
      "Quiet Luxury":     "Old Money",
      "Classic":          "Old Money",
      "Casual":           "Minimalist",
      "Normcore":         "Minimalist",
      "Business Casual":  "Old Money",
      "Rave":             "E-Girl",
      "Retro-Futurism":   "Techwear",
      "Glam":             "Coquette",
      "Party":            "Coquette",
      "Indie":            "Vintage",
      "Dark Feminine":    "Coquette",
      "Mob Wife":         "Old Money",
      "Biker":            "Grunge",
      "Punk":             "Grunge",
      "Academia":         "Dark Academia",
      "Light Academia":   "Cottagecore",
      "Barbiecore":       "Coquette",
      "Balletcore":       "Soft Girl",
      "Coastal":          "Coastal Grandmother",
      "Beach":            "Boho",
      "Western":          "Boho",
      // Compound/variant labels Gemini sometimes returns
      "Grunge / Punk":    "Grunge",
      "E-Girl / Alt":     "E-Girl",
      // Additional taxonomy aesthetics
      "Athleisure":       "Streetwear",
      "Sporty":           "Streetwear",
      "Hip Hop":          "Streetwear",
      "Tomboy":           "Skater",
      "Androgynous":      "Minimalist",
      "Smart Casual":     "Minimalist",
      "Workwear":         "Old Money",
      "Dark Romantic":    "Coquette",
      "Fairycore":        "Cottagecore",
      "Ethereal":         "Soft Girl",
      "Kawaii":           "Soft Girl",
      "Avant Garde":      "Techwear",
    };

    try {
      const scan = await storage.getScan(scanId);
      if (!scan) return res.status(404).json({ error: "Scan not found" });

      const rawAesthetic = scan.aesthetic || "";
      // Resolve to a cached aesthetic — exact match first, then fallback map, then Minimalist
      const CACHED_AESTHETICS = ["Boho","Coastal Grandmother","Coquette","Cottagecore","Dark Academia","E-Girl","Grunge","Minimalist","Old Money","Preppy","Skater","Soft Girl","Streetwear","Techwear","Vintage","Y2K"];
      const aesthetic = CACHED_AESTHETICS.includes(rawAesthetic)
        ? rawAesthetic
        : (AESTHETIC_FALLBACK[rawAesthetic] ?? "Minimalist");

      const rawQ = scan.depopQueries || "[]";
      // Support both old format (string[]) and new format ({query,garmentType}[])
      const parsed = JSON.parse(rawQ);

      // Inline garment type inference (mirrors server-side inferGarmentType)
      function inferType(item: string): string {
        const i = item.toLowerCase();
        if (/dress|gown|romper|jumpsuit/.test(i)) return "dresses";
        if (/skirt/.test(i)) return "bottoms";
        if (/pant|jean|trouser|shorts|legging|chino|cargo/.test(i)) return "bottoms";
        if (/jacket|coat|blazer|hoodie|cardigan|vest|puffer|windbreaker|bomber|parka/.test(i)) return "outerwear";
        if (/sneaker|shoe|boot|loafer|heel|flat|sandal|mule|oxford|espadrille/.test(i)) return "shoes";
        if (/hat|bag|purse|belt|scarf|necklace|earring|ring|bracelet|glasses|sunglasses|sock|glove/.test(i)) return "accessories";
        if (/tracksuit|set|co-ord|matching/.test(i)) return "sets";
        return "tops";
      }

      const garmentEntries: { query: string; garmentType: string }[] =
        parsed.length && typeof parsed[0] === "string"
          ? parsed.slice(0, 4).map((q: string) => ({ query: q, garmentType: inferType(q) }))
          : (parsed as { query: string; garmentType: string }[]).slice(0, 4);

      if (!garmentEntries.length) return res.json({ ready: true, groups: [] });

      // Pull from cache using semantic vector search (cosine similarity on embedded query strings)
      // This finds cache rows whose garment description is semantically closest to what Gemini detected,
      // without relying on exact keyword overlap or brand names.
      // Falls back to keyword-based getDepopCacheByType if no embeddings available yet.
      const groups = await Promise.all(
        garmentEntries.map(async ({ query, garmentType }) => {
          // Use vector search: embed the detected garment description, find closest cache rows
          let listings = await getDepopCacheByEmbedding(query, aesthetic, garmentType, 10, query).catch(() => []);
          if (!listings.length) {
            // Fallback: aesthetic-only pool
            listings = await getDepopCacheByAesthetic(aesthetic, 10).catch(() => []);
          }
          if (!listings.length) {
            listings = await getDepopCacheByAesthetic("Minimalist", 10).catch(() => []);
          }
          return { piece: query, listings };
        })
      );

      return res.json({ ready: true, groups: groups.filter(g => g.listings.length > 0) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/discover/refresh
   * Manual trigger for the daily refresh: prune stale cards (>30 days old,
   * 0 likes) and pull 2 hot posts per subreddit. The cron at the bottom of
   * this file calls runDailyRefresh() automatically — this endpoint exposes
   * it for ad-hoc runs.
   *
   * Like Flask: @app.route("/api/discover/refresh", methods=["POST"])
   */
  app.post("/api/discover/refresh", async (_req, res) => {
    try {
      const { added, pruned, errors } = await runDailyRefresh();
      res.json({ ok: true, added, pruned, errors });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

// ── Daily refresh logic (hot sort + prune) ────────────────────────────────────
// Pulls 2 fresh "hot" posts per subreddit, runs them through analyzeAndStore,
// and prunes cards older than 30 days with 0 likes. Called manually via
// /api/discover/refresh and automatically by startDailyRefreshCron() below.
async function runDailyRefresh(): Promise<{ added: number; pruned: number; errors: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini API key not configured");
  const genAI = new GoogleGenerativeAI(apiKey);
  const errors: string[] = [];
  let added = 0;

  // Prune cards older than 30 days with 0 likes
  const pruned = await storage.pruneStaleCards(30);
  if (pruned > 0) console.log(`[refresh] Pruned ${pruned} stale cards`);

  // Pull 2 new hot posts per subreddit
  for (const { sub, aesthetic } of SUBREDDIT_MAP) {
    try {
      const posts = await fetchSubredditImages(sub, 2, "hot");
      for (const post of posts) {
        try {
          const card = await analyzeAndStore(post.imageUrl, post.postUrl, sub, aesthetic, genAI);
          if (card) { added++; console.log(`[refresh] +1 ${aesthetic} from r/${sub}`); }
          await new Promise(r => setTimeout(r, 600));
        } catch (e: any) { errors.push(`${sub} image: ${e.message}`); }
      }
    } catch (e: any) { errors.push(`${sub}: ${e.message}`); }
  }
  console.log(`[refresh] Done — added ${added}, pruned ${pruned}`);
  return { added, pruned, errors };
}

// ── Start daily refresh cron (runs once per day while server is alive) ────────
// JS doesn't have a built-in cron, so we self-schedule with setTimeout.
// The pattern below is a "trampolined" recursive timer: every time `tick`
// finishes, it schedules itself again for 24h out. Equivalent in Python:
//   def tick():
//       run_daily_refresh()
//       threading.Timer(INTERVAL, tick).start()
//   threading.Timer(3600, tick).start()  # first run after 1h
export function startDailyRefreshCron() {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  console.log("[cron] Daily discover refresh scheduled (every 24h)");
  // First run after 1 hour so startup seeding completes first
  setTimeout(async function tick() {
    console.log("[cron] Running daily discover refresh...");
    try {
      const result = await runDailyRefresh();
      console.log(`[cron] Refresh complete — added:${result.added} pruned:${result.pruned}`);
    } catch (err: any) {
      console.error("[cron] Refresh failed:", err.message);
    }
    setTimeout(tick, INTERVAL_MS);
  }, 60 * 60 * 1000); // start after 1h
}
