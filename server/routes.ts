import type { Express } from "express";
import type { Server } from "http";
import { storage, initDB, getDepopCache, getDepopCacheSince, setDepopCache, getDepopCacheByAesthetic, getDepopCacheByType, getDepopCacheByEmbedding, getUserProfile, upsertUserProfile, appendLikedItem, getLikedItems, getForYouRecommendations, getAverageEmbeddingForAesthetics, getEmbedding, getDiscoverCardsByTaste, getShopTheLookItems, getWardrobeGapRecommendations, getSimilarDiscoverCards, embedDiscoverCard } from "./storage";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import multer from "multer";
import rateLimit from "express-rate-limit";
import cors from "cors";

// ── Rate limiter: 10 analysis requests per IP per minute ─────────────────────
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please wait a moment before trying again." },
});

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const upload = multer({
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB — client resizes to 1024px before upload
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed."));
    }
  },
});

// Mock product results for MVP (replace with Skimlinks affiliate API)

// Maps a product name to relevant Unsplash search keywords
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
function normaliseDepopItem(i: any, idx: number, searchQ: string) {
  let image = "";
  if (Array.isArray(i.image_url)) image = i.image_url.find((u: string) => u?.length) || "";
  else if (typeof i.image_url === "string" && i.image_url.length) image = i.image_url;
  else if (i.imageUrl) image = Array.isArray(i.imageUrl) ? i.imageUrl[0] : i.imageUrl;
  else if (Array.isArray(i.images) && i.images.length) image = i.images[0]?.url || (typeof i.images[0] === 'string' ? i.images[0] : '') || "";
  else if (i.picture) image = i.picture;
  image = image.replace(/\/P10\.jpg$/i, "/P0.jpg").replace(/\/P2\.jpg$/i, "/P0.jpg");

  // Derive title: use explicit title/description, else humanise the slug
  // slug example: "956thriftfindz-blue-polo-assn-polo-shirt" → remove leading username segment
  let title = i.title || i.description || i.name || "";
  if (!title && i.slug) {
    const parts = (i.slug as string).split("-");
    // First segment is typically the seller username — drop it if it looks alphanumeric-only
    const dropFirst = /^[a-z0-9]+$/.test(parts[0]);
    const words = dropFirst ? parts.slice(1) : parts;
    title = words.map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  // Final fallback: capitalise the search query (e.g. "y2k low rise jeans" → "Y2K Low Rise Jeans")
  if (!title) title = searchQ.replace(/\b\w/g, (c: string) => c.toUpperCase());

  // Use real product URL if available, otherwise fall back to search
  const url = (typeof i.url === "string" && i.url.startsWith("https://www.depop.com/products/"))
    ? i.url
    : `https://www.depop.com/search/?q=${encodeURIComponent(searchQ)}`;

  // Reject non-clothing items: trading cards, toys, games, electronics, home goods, etc.
  const NON_CLOTHING_SIGNALS = [
    "trading card","pokemon card","yugioh","yu-gi-oh","magic card","sports card",
    "collectible","funko","action figure","figurine","toy",
    "video game","console","phone case","electronics",
    "poster","print","sticker","art print","wall art",
    "candle","mug","cup","pillow","blanket",
    "book","magazine","vinyl record","cd "," dvd",
  ];
  const titleLower = title.toLowerCase();
  if (NON_CLOTHING_SIGNALS.some(s => titleLower.includes(s))) return null;

  return {
    id: idx,
    title,
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
// Handles both v2 (objects[]) and v3 (products[]) response shapes
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

  // Title: derive from slug (drop username prefix + trailing hash)
  let title = item.description || item.title || "";
  if (!title && slug) {
    const parts = slug.split("-");
    // Drop first segment (username) and last (4-char hash)
    const middle = parts.length > 2 ? parts.slice(1, -1) : parts.slice(1);
    title = middle.map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
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
    title: title.slice(0, 80),
    brand: item.brand_name || item.brand?.name || item.brandName || "",
    price,
    currency,
    size,
    image,
    url,
  };
}

// Simple round-robin counter for proxy selection
let proxyRoundRobin = 0;

async function scrapeDepopDirect(query: string, limit = 6): Promise<any[]> {
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

// Run a single Depop search: check cache first, else hit Apify + store result
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

    // 2b. Fall back to Apify if proxy failed or not set
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

      // Poll until done (max 90s)
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

// Generates an Amazon affiliate search URL for a product
function amazonUrl(productName: string, brand: string): string {
  const query = encodeURIComponent(`${brand} ${productName}`);
  return `https://www.amazon.com/s?k=${query}&tag=styleaiapp-20`;
}

function generateMockResults(aesthetic: string) {
  const aestheticProducts: Record<string, any[]> = {
    // ── MINIMALIST & CLEAN ──
    "Quiet Luxury": [
      { id: 1, name: "Merino Crewneck Sweater", brand: "Brunello Cucinelli", price: 695, image: "", match: 97, retailer: "Brunello Cucinelli", url: "https://www.amazon.com/s?k=Brunello+Cucinelli+Merino+Crewneck+Sweater&tag=styleaiapp-20" },
      { id: 2, name: "Tailored Camel Overcoat", brand: "Toteme", price: 895, image: "", match: 94, retailer: "Toteme", url: "https://www.amazon.com/s?k=Toteme+Tailored+Camel+Overcoat&tag=styleaiapp-20" },
      { id: 3, name: "Straight-Leg Wool Trousers", brand: "Arket", price: 139, image: "", match: 91, retailer: "Arket", url: "https://www.amazon.com/s?k=Arket+Straight-Leg+Wool+Trousers&tag=styleaiapp-20" },
      { id: 4, name: "Suede Penny Loafers", brand: "Grenson", price: 285, image: "", match: 89, retailer: "Grenson", url: "https://www.amazon.com/s?k=Grenson+Suede+Penny+Loafers&tag=styleaiapp-20" },
      { id: 5, name: "Cashmere Turtleneck", brand: "The Row", price: 590, image: "", match: 86, retailer: "The Row", url: "https://www.amazon.com/s?k=The+Row+Cashmere+Turtleneck&tag=styleaiapp-20" },
      { id: 6, name: "Structured Leather Tote", brand: "Polene", price: 320, image: "", match: 82, retailer: "Polene", url: "https://www.amazon.com/s?k=Polene+Structured+Leather+Tote&tag=styleaiapp-20" },
    ],

    "Clean Fit": [
      { id: 1, name: "Fitted Linen Shirt", brand: "Uniqlo", price: 39, image: "", match: 96, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Fitted+Linen+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Slim Chino Trousers", brand: "COS", price: 89, image: "", match: 93, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Slim+Chino+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "White Low-Top Sneakers", brand: "Adidas", price: 90, image: "", match: 90, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+White+Low-Top+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Fitted White Tank", brand: "SKIMS", price: 38, image: "", match: 87, retailer: "SKIMS", url: "https://www.amazon.com/s?k=SKIMS+Fitted+White+Tank&tag=styleaiapp-20" },
      { id: 5, name: "Wide-Leg Tailored Trousers", brand: "Zara", price: 59, image: "", match: 84, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Wide-Leg+Tailored+Trousers&tag=styleaiapp-20" },
      { id: 6, name: "Minimal Watch", brand: "Skagen", price: 99, image: "", match: 81, retailer: "Skagen", url: "https://www.amazon.com/s?k=Skagen+Minimal+Watch&tag=styleaiapp-20" },
    ],

    // Legacy alias
    "Clean Girl": [
      { id: 1, name: "Fitted Linen Shirt", brand: "Uniqlo", price: 39, image: "", match: 96, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Fitted+Linen+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Slim Chino Trousers", brand: "COS", price: 89, image: "", match: 93, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Slim+Chino+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "White Low-Top Sneakers", brand: "Adidas", price: 90, image: "", match: 90, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+White+Low-Top+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Fitted White Tank", brand: "SKIMS", price: 38, image: "", match: 87, retailer: "SKIMS", url: "https://www.amazon.com/s?k=SKIMS+Fitted+White+Tank&tag=styleaiapp-20" },
      { id: 5, name: "Wide-Leg Tailored Trousers", brand: "Zara", price: 59, image: "", match: 84, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Wide-Leg+Tailored+Trousers&tag=styleaiapp-20" },
      { id: 6, name: "Minimal Watch", brand: "Skagen", price: 99, image: "", match: 81, retailer: "Skagen", url: "https://www.amazon.com/s?k=Skagen+Minimal+Watch&tag=styleaiapp-20" },
    ],


    "Classic / Timeless": [
      { id: 1, name: "Oxford Button-Down Shirt", brand: "Brooks Brothers", price: 98, image: "", match: 96, retailer: "Brooks Brothers", url: "https://www.amazon.com/s?k=Brooks+Brothers+Oxford+Button-Down+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Slim Trench Coat", brand: "A.P.C.", price: 595, image: "", match: 93, retailer: "A.P.C.", url: "https://www.amazon.com/s?k=A.P.C.+Slim+Trench+Coat&tag=styleaiapp-20" },
      { id: 3, name: "Tailored Navy Blazer", brand: "Reiss", price: 345, image: "", match: 90, retailer: "Reiss", url: "https://www.amazon.com/s?k=Reiss+Tailored+Navy+Blazer&tag=styleaiapp-20" },
      { id: 4, name: "Slim Chino Trousers", brand: "Banana Republic", price: 89, image: "", match: 87, retailer: "Banana Republic", url: "https://www.amazon.com/s?k=Banana+Republic+Slim+Chino+Trousers&tag=styleaiapp-20" },
      { id: 5, name: "Leather Oxford Shoes", brand: "Thursday Boot Co", price: 199, image: "", match: 84, retailer: "Thursday Boot Co", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Leather+Oxford+Shoes&tag=styleaiapp-20" },
      { id: 6, name: "Wool Crewneck Knit", brand: "Uniqlo", price: 59, image: "", match: 81, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Wool+Crewneck+Knit&tag=styleaiapp-20" },
    ],

    // ── SOFT & FEMININE ──
    "Coquette": [
      { id: 1, name: "Lace Trim Slip Dress", brand: "Reformation", price: 198, image: "", match: 97, retailer: "Reformation", url: "https://www.amazon.com/s?k=Reformation+Lace+Trim+Slip+Dress&tag=styleaiapp-20" },
      { id: 2, name: "Pearl Embellished Headband", brand: "Jennifer Behr", price: 98, image: "", match: 93, retailer: "Jennifer Behr", url: "https://www.amazon.com/s?k=Jennifer+Behr+Pearl+Embellished+Headband&tag=styleaiapp-20" },
      { id: 3, name: "Satin Bow Ballet Flats", brand: "Repetto", price: 245, image: "", match: 90, retailer: "Repetto", url: "https://www.amazon.com/s?k=Repetto+Satin+Bow+Ballet+Flats&tag=styleaiapp-20" },
      { id: 4, name: "Corset Top", brand: "Bustier", price: 79, image: "", match: 87, retailer: "ASOS", url: "https://www.amazon.com/s?k=Bustier+Corset+Top&tag=styleaiapp-20" },
      { id: 5, name: "Pearl Stud Earrings", brand: "Mejuri", price: 68, image: "", match: 84, retailer: "Mejuri", url: "https://www.amazon.com/s?k=Mejuri+Pearl+Stud+Earrings&tag=styleaiapp-20" },
      { id: 6, name: "Mini Bow Bag", brand: "Miu Miu", price: 1490, image: "", match: 81, retailer: "Miu Miu", url: "https://www.amazon.com/s?k=Miu+Miu+Mini+Bow+Bag&tag=styleaiapp-20" },
    ],
    "Soft Girl / Kawaii": [
      { id: 1, name: "Fluffy Pastel Cardigan", brand: "Urban Outfitters", price: 59, image: "", match: 95, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Fluffy+Pastel+Cardigan&tag=styleaiapp-20" },
      { id: 2, name: "Pleated Mini Skirt", brand: "Princess Polly", price: 49, image: "", match: 92, retailer: "Princess Polly", url: "https://www.amazon.com/s?k=Princess+Polly+Pleated+Mini+Skirt&tag=styleaiapp-20" },
      { id: 3, name: "Heart Hair Clips Set", brand: "ASOS", price: 15, image: "", match: 89, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Heart+Hair+Clips+Set&tag=styleaiapp-20" },
      { id: 4, name: "Platform Mary Janes", brand: "Steve Madden", price: 89, image: "", match: 86, retailer: "Steve Madden", url: "https://www.amazon.com/s?k=Steve+Madden+Platform+Mary+Janes&tag=styleaiapp-20" },
      { id: 5, name: "Layered Charm Necklace", brand: "Anthropologie", price: 38, image: "", match: 83, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Layered+Charm+Necklace&tag=styleaiapp-20" },
      { id: 6, name: "Pastel Mini Backpack", brand: "Eastpak", price: 65, image: "", match: 80, retailer: "Eastpak", url: "https://www.amazon.com/s?k=Eastpak+Pastel+Mini+Backpack&tag=styleaiapp-20" },
    ],
    "Pink Pilates / Wellness": [
      { id: 1, name: "Ribbed Seamless Leggings", brand: "Lululemon", price: 98, image: "", match: 96, retailer: "Lululemon", url: "https://www.amazon.com/s?k=Lululemon+Ribbed+Seamless+Leggings&tag=styleaiapp-20" },
      { id: 2, name: "Ballet Wrap Cardigan", brand: "Reformation", price: 148, image: "", match: 93, retailer: "Reformation", url: "https://www.amazon.com/s?k=Reformation+Ballet+Wrap+Cardigan&tag=styleaiapp-20" },
      { id: 3, name: "Tennis Mini Skirt", brand: "Varley", price: 79, image: "", match: 90, retailer: "Varley", url: "https://www.amazon.com/s?k=Varley+Tennis+Mini+Skirt&tag=styleaiapp-20" },
      { id: 4, name: "Satin Scrunchie Set", brand: "Slip", price: 45, image: "", match: 87, retailer: "Slip", url: "https://www.amazon.com/s?k=Slip+Satin+Scrunchie+Set&tag=styleaiapp-20" },
      { id: 5, name: "Cloud Sneakers", brand: "On Running", price: 150, image: "", match: 84, retailer: "On Running", url: "https://www.amazon.com/s?k=On+Running+Cloud+Sneakers&tag=styleaiapp-20" },
      { id: 6, name: "Mini Pilates Bag", brand: "Lululemon", price: 68, image: "", match: 81, retailer: "Lululemon", url: "https://www.amazon.com/s?k=Lululemon+Mini+Pilates+Bag&tag=styleaiapp-20" },
    ],
    "Dark Feminine": [
      { id: 1, name: "Velvet Corset Dress", brand: "House of CB", price: 189, image: "", match: 96, retailer: "House of CB", url: "https://www.amazon.com/s?k=House+of+CB+Velvet+Corset+Dress&tag=styleaiapp-20" },
      { id: 2, name: "Lace Trim Midi Skirt", brand: "Free People", price: 128, image: "", match: 93, retailer: "Free People", url: "https://www.amazon.com/s?k=Free+People+Lace+Trim+Midi+Skirt&tag=styleaiapp-20" },
      { id: 3, name: "Leather Knee Boots", brand: "Stuart Weitzman", price: 695, image: "", match: 90, retailer: "Stuart Weitzman", url: "https://www.amazon.com/s?k=Stuart+Weitzman+Leather+Knee+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Satin Slip Cami", brand: "Reformation", price: 98, image: "", match: 87, retailer: "Reformation", url: "https://www.amazon.com/s?k=Reformation+Satin+Slip+Cami&tag=styleaiapp-20" },
      { id: 5, name: "Statement Drop Earrings", brand: "Completedworks", price: 145, image: "", match: 84, retailer: "Completedworks", url: "https://www.amazon.com/s?k=Completedworks+Statement+Drop+Earrings&tag=styleaiapp-20" },
      { id: 6, name: "Dark Berry Lip", brand: "Charlotte Tilbury", price: 34, image: "", match: 81, retailer: "Charlotte Tilbury", url: "https://www.amazon.com/s?k=Charlotte+Tilbury+Dark+Berry+Lip&tag=styleaiapp-20" },
    ],
    // ── PREPPY & COLLEGIATE ──
    "Old School Preppy": [
      { id: 1, name: "Cable-Knit Crewneck", brand: "J.Crew", price: 118, image: "", match: 95, retailer: "J.Crew", url: "https://www.amazon.com/s?k=J.Crew+Cable-Knit+Crewneck&tag=styleaiapp-20" },
      { id: 2, name: "Oxford Button-Down", brand: "Brooks Brothers", price: 89, image: "", match: 92, retailer: "Brooks Brothers", url: "https://www.amazon.com/s?k=Brooks+Brothers+Oxford+Button-Down&tag=styleaiapp-20" },
      { id: 3, name: "Slim Chino Pants", brand: "Banana Republic", price: 89, image: "", match: 89, retailer: "Banana Republic", url: "https://www.amazon.com/s?k=Banana+Republic+Slim+Chino+Pants&tag=styleaiapp-20" },
      { id: 4, name: "Penny Loafers", brand: "G.H. Bass", price: 160, image: "", match: 86, retailer: "G.H. Bass", url: "https://www.amazon.com/s?k=G.H.+Bass+Penny+Loafers&tag=styleaiapp-20" },
      { id: 5, name: "Quilted Vest", brand: "Barbour", price: 149, image: "", match: 83, retailer: "Barbour", url: "https://www.amazon.com/s?k=Barbour+Quilted+Vest&tag=styleaiapp-20" },
      { id: 6, name: "Plaid Wool Scarf", brand: "Burberry", price: 290, image: "", match: 80, retailer: "Burberry", url: "https://www.amazon.com/s?k=Burberry+Plaid+Wool+Scarf&tag=styleaiapp-20" },
    ],
    "Modern Preppy": [
      { id: 1, name: "Puffer Vest", brand: "Patagonia", price: 149, image: "", match: 95, retailer: "Patagonia", url: "https://www.amazon.com/s?k=Patagonia+Puffer+Vest&tag=styleaiapp-20" },
      { id: 2, name: "Classic Polo Shirt", brand: "Lacoste", price: 99, image: "", match: 92, retailer: "Lacoste", url: "https://www.amazon.com/s?k=Lacoste+Classic+Polo+Shirt&tag=styleaiapp-20" },
      { id: 3, name: "Colourblock Sneakers", brand: "New Balance", price: 119, image: "", match: 89, retailer: "New Balance", url: "https://www.amazon.com/s?k=New+Balance+Colourblock+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Chino Shorts", brand: "J.Crew", price: 69, image: "", match: 86, retailer: "J.Crew", url: "https://www.amazon.com/s?k=J.Crew+Chino+Shorts&tag=styleaiapp-20" },
      { id: 5, name: "Pleated Mini Skirt", brand: "Princess Polly", price: 59, image: "", match: 83, retailer: "Princess Polly", url: "https://www.amazon.com/s?k=Princess+Polly+Pleated+Mini+Skirt&tag=styleaiapp-20" },
      { id: 6, name: "Mini Canvas Tote", brand: "L.L. Bean", price: 29, image: "", match: 80, retailer: "L.L. Bean", url: "https://www.amazon.com/s?k=L.L.+Bean+Mini+Canvas+Tote&tag=styleaiapp-20" },
    ],

    // ── STREETWEAR & URBAN ──
    "Skatecore": [
      { id: 1, name: "Sk8-Hi Sneakers", brand: "Vans", price: 90, image: "", match: 96, retailer: "Vans", url: "https://www.amazon.com/s?k=Vans+Sk8-Hi+Sneakers&tag=styleaiapp-20" },
      { id: 2, name: "Wide-Leg Denim", brand: "Dickies", price: 49, image: "", match: 93, retailer: "Dickies", url: "https://www.amazon.com/s?k=Dickies+Wide-Leg+Denim&tag=styleaiapp-20" },
      { id: 3, name: "Logo Overshirt", brand: "Carhartt WIP", price: 89, image: "", match: 89, retailer: "Carhartt WIP", url: "https://www.amazon.com/s?k=Carhartt+WIP+Logo+Overshirt&tag=styleaiapp-20" },
      { id: 4, name: "Graphic Skate Tee", brand: "Thrasher", price: 35, image: "", match: 86, retailer: "Thrasher", url: "https://www.amazon.com/s?k=Thrasher+Graphic+Skate+Tee&tag=styleaiapp-20" },
      { id: 5, name: "Beanie Hat", brand: "New Era", price: 28, image: "", match: 83, retailer: "New Era", url: "https://www.amazon.com/s?k=New+Era+Beanie+Hat&tag=styleaiapp-20" },
      { id: 6, name: "Canvas Belt Bag", brand: "Dickies", price: 32, image: "", match: 80, retailer: "Dickies", url: "https://www.amazon.com/s?k=Dickies+Canvas+Belt+Bag&tag=styleaiapp-20" },
    ],
    "Techwear": [
      { id: 1, name: "Waterproof Shell Jacket", brand: "Arc'teryx", price: 625, image: "", match: 97, retailer: "Arc'teryx", url: "https://www.amazon.com/s?k=Arc'teryx+Waterproof+Shell+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Ripstop Cargo Trousers", brand: "Veilance", price: 450, image: "", match: 94, retailer: "Veilance", url: "https://www.amazon.com/s?k=Veilance+Ripstop+Cargo+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Trail Running Shoes", brand: "Salomon", price: 160, image: "", match: 90, retailer: "Salomon", url: "https://www.amazon.com/s?k=Salomon+Trail+Running+Shoes&tag=styleaiapp-20" },
      { id: 4, name: "Tactical Vest", brand: "Stone Island", price: 399, image: "", match: 87, retailer: "Stone Island", url: "https://www.amazon.com/s?k=Stone+Island+Tactical+Vest&tag=styleaiapp-20" },
      { id: 5, name: "Balaclava", brand: "C.P. Company", price: 75, image: "", match: 84, retailer: "C.P. Company", url: "https://www.amazon.com/s?k=C.P.+Company+Balaclava&tag=styleaiapp-20" },
      { id: 6, name: "Sling Chest Bag", brand: "Cotopaxi", price: 85, image: "", match: 81, retailer: "Cotopaxi", url: "https://www.amazon.com/s?k=Cotopaxi+Sling+Chest+Bag&tag=styleaiapp-20" },
    ],
    "Baddie": [
      { id: 1, name: "Sculpted Bodycon Dress", brand: "House of CB", price: 139, image: "", match: 96, retailer: "House of CB", url: "https://www.amazon.com/s?k=House+of+CB+Sculpted+Bodycon+Dress&tag=styleaiapp-20" },
      { id: 2, name: "Clear Heel Mules", brand: "Steve Madden", price: 79, image: "", match: 93, retailer: "Steve Madden", url: "https://www.amazon.com/s?k=Steve+Madden+Clear+Heel+Mules&tag=styleaiapp-20" },
      { id: 3, name: "Faux Fur Coat", brand: "SHEIN", price: 89, image: "", match: 89, retailer: "SHEIN", url: "https://www.amazon.com/s?k=SHEIN+Faux+Fur+Coat&tag=styleaiapp-20" },
      { id: 4, name: "Quilted Chain Bag", brand: "Zara", price: 69, image: "", match: 86, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Quilted+Chain+Bag&tag=styleaiapp-20" },
      { id: 5, name: "Lash Mascara Set", brand: "Fenty Beauty", price: 28, image: "", match: 83, retailer: "Fenty Beauty", url: "https://www.amazon.com/s?k=Fenty+Beauty+Lash+Mascara+Set&tag=styleaiapp-20" },
      { id: 6, name: "Sleek Sunglasses", brand: "Quay", price: 65, image: "", match: 80, retailer: "Quay", url: "https://www.amazon.com/s?k=Quay+Sleek+Sunglasses&tag=styleaiapp-20" },
    ],
    // ── NATURE & FANTASY ──
    "Fairycore": [
      { id: 1, name: "Chiffon Floral Dress", brand: "Free People", price: 148, image: "", match: 96, retailer: "Free People", url: "https://www.amazon.com/s?k=Free+People+Chiffon+Floral+Dress&tag=styleaiapp-20" },
      { id: 2, name: "Floral Crown", brand: "Anthropologie", price: 48, image: "", match: 93, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Floral+Crown&tag=styleaiapp-20" },
      { id: 3, name: "Lace Tights", brand: "Wolford", price: 68, image: "", match: 90, retailer: "Wolford", url: "https://www.amazon.com/s?k=Wolford+Lace+Tights&tag=styleaiapp-20" },
      { id: 4, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 180, image: "", match: 87, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Chunky+Platform+Boots&tag=styleaiapp-20" },
      { id: 5, name: "Mushroom Charm Necklace", brand: "Mejuri", price: 58, image: "", match: 84, retailer: "Mejuri", url: "https://www.amazon.com/s?k=Mejuri+Mushroom+Charm+Necklace&tag=styleaiapp-20" },
      { id: 6, name: "Velvet Ribbon Hair Bow", brand: "Urban Outfitters", price: 18, image: "", match: 81, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Velvet+Ribbon+Hair+Bow&tag=styleaiapp-20" },
    ],
    "Gorpcore": [
      { id: 1, name: "Beta AR Jacket", brand: "Arc'teryx", price: 750, image: "", match: 97, retailer: "Arc'teryx", url: "https://www.amazon.com/s?k=Arc'teryx+Beta+AR+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Fleece Vest", brand: "Patagonia", price: 139, image: "", match: 94, retailer: "Patagonia", url: "https://www.amazon.com/s?k=Patagonia+Fleece+Vest&tag=styleaiapp-20" },
      { id: 3, name: "Trail Shoes", brand: "Salomon", price: 160, image: "", match: 91, retailer: "Salomon", url: "https://www.amazon.com/s?k=Salomon+Trail+Shoes&tag=styleaiapp-20" },
      { id: 4, name: "Utility Cargo Pants", brand: "The North Face", price: 130, image: "", match: 88, retailer: "The North Face", url: "https://www.amazon.com/s?k=The+North+Face+Utility+Cargo+Pants&tag=styleaiapp-20" },
      { id: 5, name: "Beanie Hat", brand: "Patagonia", price: 35, image: "", match: 85, retailer: "Patagonia", url: "https://www.amazon.com/s?k=Patagonia+Beanie+Hat&tag=styleaiapp-20" },
      { id: 6, name: "Hip Pack", brand: "Cotopaxi", price: 75, image: "", match: 82, retailer: "Cotopaxi", url: "https://www.amazon.com/s?k=Cotopaxi+Hip+Pack&tag=styleaiapp-20" },
    ],
    // ── VINTAGE & RETRO ──
    "90s Grunge": [
      { id: 1, name: "Flannel Overshirt", brand: "Levi's", price: 79, image: "", match: 96, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Flannel+Overshirt&tag=styleaiapp-20" },
      { id: 2, name: "Band Graphic Tee", brand: "Urban Outfitters", price: 35, image: "", match: 93, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Band+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "1460 Mono Boots", brand: "Dr. Martens", price: 170, image: "", match: 90, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+1460+Mono+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Ripped Slim Jeans", brand: "Levi's", price: 98, image: "", match: 87, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Ripped+Slim+Jeans&tag=styleaiapp-20" },
      { id: 5, name: "Oversized Cardigan", brand: "Mango", price: 69, image: "", match: 84, retailer: "Mango", url: "https://www.amazon.com/s?k=Mango+Oversized+Cardigan&tag=styleaiapp-20" },
      { id: 6, name: "Leather Crossbody Bag", brand: "Urban Outfitters", price: 45, image: "", match: 81, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Leather+Crossbody+Bag&tag=styleaiapp-20" },
    ],

    "70s-80s Retro": [
      { id: 1, name: "Flared Denim Jeans", brand: "Levi's", price: 109, image: "", match: 96, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Flared+Denim+Jeans&tag=styleaiapp-20" },
      { id: 2, name: "Open-Collar Printed Shirt", brand: "Urban Outfitters", price: 59, image: "", match: 93, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Open-Collar+Printed+Shirt&tag=styleaiapp-20" },
      { id: 3, name: "Platform Chelsea Boots", brand: "Dr. Martens", price: 179, image: "", match: 90, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Platform+Chelsea+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Suede Jacket", brand: "ASOS", price: 149, image: "", match: 87, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Suede+Jacket&tag=styleaiapp-20" },
      { id: 5, name: "Oversized Tortoiseshell Sunglasses", brand: "Le Specs", price: 69, image: "", match: 84, retailer: "Le Specs", url: "https://www.amazon.com/s?k=Le+Specs+Oversized+Tortoiseshell+Sunglasses&tag=styleaiapp-20" },
      { id: 6, name: "Gold Layered Chains", brand: "Anthropologie", price: 48, image: "", match: 81, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Gold+Layered+Chains&tag=styleaiapp-20" },
    ],

    "Vintage / Thrift": [
      { id: 1, name: "Washed Denim Jacket", brand: "Levi's", price: 89, image: "", match: 95, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Washed+Denim+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Vintage Band Graphic Tee", brand: "Urban Outfitters", price: 35, image: "", match: 92, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Vintage+Band+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "Thrifted Corduroy Overshirt", brand: "ASOS", price: 55, image: "", match: 89, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Thrifted+Corduroy+Overshirt&tag=styleaiapp-20" },
      { id: 4, name: "90s Logo Cap", brand: "Tommy Hilfiger", price: 38, image: "", match: 86, retailer: "Tommy Hilfiger", url: "https://www.amazon.com/s?k=Tommy+Hilfiger+90s+Logo+Cap&tag=styleaiapp-20" },
      { id: 5, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 179, image: "", match: 83, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Chunky+Platform+Boots&tag=styleaiapp-20" },
      { id: 6, name: "Deadstock Floral Shirt", brand: "Depop", price: 28, image: "", match: 80, retailer: "Depop", url: "https://www.amazon.com/s?k=Depop+Deadstock+Floral+Shirt&tag=styleaiapp-20" },
    ],

    // ── BOLD & EXPRESSIVE ──
    "Maximalist": [
      { id: 1, name: "Printed Statement Shirt", brand: "Zara", price: 69, image: "", match: 96, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Printed+Statement+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Mixed Print Blazer", brand: "ASOS", price: 99, image: "", match: 93, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Mixed+Print+Blazer&tag=styleaiapp-20" },
      { id: 3, name: "Chunky Layered Chain Necklace", brand: "Anthropologie", price: 48, image: "", match: 90, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Chunky+Layered+Chain+Necklace&tag=styleaiapp-20" },
      { id: 4, name: "Colourful Chunky Sneakers", brand: "New Balance", price: 139, image: "", match: 87, retailer: "New Balance", url: "https://www.amazon.com/s?k=New+Balance+Colourful+Chunky+Sneakers&tag=styleaiapp-20" },
      { id: 5, name: "Mixed Print Dress", brand: "Farm Rio", price: 195, image: "", match: 84, retailer: "Farm Rio", url: "https://www.amazon.com/s?k=Farm+Rio+Mixed+Print+Dress&tag=styleaiapp-20" },
      { id: 6, name: "Animal Print Coat", brand: "ASOS", price: 129, image: "", match: 81, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Animal+Print+Coat&tag=styleaiapp-20" },
    ],

    "Rave": [
      { id: 1, name: "Holographic Mini Skirt", brand: "ASOS", price: 45, image: "", match: 97, retailer: "ASOS", url: "https://www.amazon.com/s?k=Holographic+Mini+Skirt&tag=styleaiapp-20" },
      { id: 2, name: "Fishnet Body Stocking", brand: "Leg Avenue", price: 22, image: "", match: 94, retailer: "Leg Avenue", url: "https://www.amazon.com/s?k=Leg+Avenue+Fishnet+Body+Stocking&tag=styleaiapp-20" },
      { id: 3, name: "Neon Bralette", brand: "I.AM.GIA", price: 55, image: "", match: 91, retailer: "I.AM.GIA", url: "https://www.amazon.com/s?k=Neon+Bralette&tag=styleaiapp-20" },
      { id: 4, name: "Chunky Platform Sneakers", brand: "Buffalo", price: 139, image: "", match: 88, retailer: "Buffalo", url: "https://www.amazon.com/s?k=Buffalo+Chunky+Platform+Sneakers&tag=styleaiapp-20" },
      { id: 5, name: "LED / Glow Accessories Set", brand: "ASOS", price: 18, image: "", match: 85, retailer: "ASOS", url: "https://www.amazon.com/s?k=LED+Glow+Rave+Accessories&tag=styleaiapp-20" },
      { id: 6, name: "Iridescent Cargo Pants", brand: "UNIF", price: 98, image: "", match: 82, retailer: "UNIF", url: "https://www.amazon.com/s?k=UNIF+Iridescent+Cargo+Pants&tag=styleaiapp-20" },
    ],

    "Glam / Party": [
      { id: 1, name: "Velvet Blazer", brand: "ASOS", price: 89, image: "", match: 96, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Velvet+Blazer&tag=styleaiapp-20" },
      { id: 2, name: "Sequin Mini Dress", brand: "House of CB", price: 149, image: "", match: 93, retailer: "House of CB", url: "https://www.amazon.com/s?k=House+of+CB+Sequin+Mini+Dress&tag=styleaiapp-20" },
      { id: 3, name: "Satin Dress Shirt", brand: "Zara", price: 69, image: "", match: 90, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Satin+Dress+Shirt&tag=styleaiapp-20" },
      { id: 4, name: "Metallic Clutch Bag", brand: "ASOS", price: 35, image: "", match: 87, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Metallic+Clutch+Bag&tag=styleaiapp-20" },
      { id: 5, name: "Crystal Drop Earrings", brand: "Completedworks", price: 95, image: "", match: 84, retailer: "Completedworks", url: "https://www.amazon.com/s?k=Completedworks+Crystal+Drop+Earrings&tag=styleaiapp-20" },
      { id: 6, name: "Pointed Dress Shoes", brand: "Aldo", price: 119, image: "", match: 81, retailer: "Aldo", url: "https://www.amazon.com/s?k=Aldo+Pointed+Dress+Shoes&tag=styleaiapp-20" },
    ],

    "E-Girl / Alt": [
      { id: 1, name: "Striped Long-Sleeve Tee", brand: "Urban Outfitters", price: 35, image: "", match: 96, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Striped+Long-Sleeve+Tee&tag=styleaiapp-20" },
      { id: 2, name: "Chain Link Choker", brand: "ASOS", price: 12, image: "", match: 93, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Chain+Link+Choker&tag=styleaiapp-20" },
      { id: 3, name: "Platform Combat Boots", brand: "Dr. Martens", price: 179, image: "", match: 90, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Platform+Combat+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Graphic Alt Hoodie", brand: "Killstar", price: 79, image: "", match: 87, retailer: "Killstar", url: "https://www.amazon.com/s?k=Killstar+Graphic+Alt+Hoodie&tag=styleaiapp-20" },
      { id: 5, name: "Straight-Leg Black Jeans", brand: "Topman", price: 55, image: "", match: 84, retailer: "Topman", url: "https://www.amazon.com/s?k=Topman+Straight-Leg+Black+Jeans&tag=styleaiapp-20" },
      { id: 6, name: "Plaid Mini Skirt", brand: "UNIF", price: 78, image: "", match: 81, retailer: "UNIF", url: "https://www.amazon.com/s?k=UNIF+Plaid+Mini+Skirt&tag=styleaiapp-20" },
    ],

    // ── FORMAL & POWER ──
    "Office Siren": [
      { id: 1, name: "Power Shoulder Blazer", brand: "Zara", price: 129, image: "", match: 96, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Power+Shoulder+Blazer&tag=styleaiapp-20" },
      { id: 2, name: "Slim-Fit Dress Trousers", brand: "Reiss", price: 149, image: "", match: 93, retailer: "Reiss", url: "https://www.amazon.com/s?k=Reiss+Slim-Fit+Dress+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Silk Blouse", brand: "Equipment", price: 198, image: "", match: 90, retailer: "Equipment", url: "https://www.amazon.com/s?k=Equipment+Silk+Blouse&tag=styleaiapp-20" },
      { id: 4, name: "Leather Oxford Shoes", brand: "Thursday Boot Co", price: 199, image: "", match: 87, retailer: "Thursday Boot Co", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Leather+Oxford+Shoes&tag=styleaiapp-20" },
      { id: 5, name: "Structured Work Tote", brand: "Polene", price: 295, image: "", match: 84, retailer: "Polene", url: "https://www.amazon.com/s?k=Polene+Structured+Work+Tote&tag=styleaiapp-20" },
      { id: 6, name: "Minimal Gold Watch", brand: "Skagen", price: 129, image: "", match: 81, retailer: "Skagen", url: "https://www.amazon.com/s?k=Skagen+Minimal+Gold+Watch&tag=styleaiapp-20" },
    ],

    "Occasion Wear": [
      { id: 1, name: "Tailored Two-Piece Suit", brand: "Reiss", price: 595, image: "", match: 96, retailer: "Reiss", url: "https://www.amazon.com/s?k=Reiss+Tailored+Two-Piece+Suit&tag=styleaiapp-20" },
      { id: 2, name: "Midi Wrap Dress", brand: "Reformation", price: 198, image: "", match: 93, retailer: "Reformation", url: "https://www.amazon.com/s?k=Reformation+Midi+Wrap+Dress&tag=styleaiapp-20" },
      { id: 3, name: "Oxford Dress Shoes", brand: "Thursday Boot Co", price: 199, image: "", match: 90, retailer: "Thursday Boot Co", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Oxford+Dress+Shoes&tag=styleaiapp-20" },
      { id: 4, name: "Pocket Square", brand: "Drake's", price: 55, image: "", match: 87, retailer: "Drake's", url: "https://www.amazon.com/s?k=Drake's+Pocket+Square&tag=styleaiapp-20" },
      { id: 5, name: "Satin Evening Clutch", brand: "Cult Gaia", price: 195, image: "", match: 84, retailer: "Cult Gaia", url: "https://www.amazon.com/s?k=Cult+Gaia+Satin+Evening+Clutch&tag=styleaiapp-20" },
      { id: 6, name: "Pearl Hoop Earrings", brand: "Completedworks", price: 85, image: "", match: 81, retailer: "Completedworks", url: "https://www.amazon.com/s?k=Completedworks+Pearl+Hoop+Earrings&tag=styleaiapp-20" },
    ],

    // ── SPORT & ACTIVE ──
    "Blokecore": [
      { id: 1, name: "Football Jersey", brand: "Adidas", price: 85, image: "", match: 96, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+Football+Jersey&tag=styleaiapp-20" },
      { id: 2, name: "Wide-Leg Jorts", brand: "Levi's", price: 65, image: "", match: 93, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Wide-Leg+Jorts&tag=styleaiapp-20" },
      { id: 3, name: "Classic Trainer Sneakers", brand: "Adidas", price: 90, image: "", match: 90, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+Classic+Trainer+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Bucket Hat", brand: "New Era", price: 35, image: "", match: 87, retailer: "New Era", url: "https://www.amazon.com/s?k=New+Era+Bucket+Hat&tag=styleaiapp-20" },
      { id: 5, name: "Zip-Up Track Jacket", brand: "Umbro", price: 65, image: "", match: 84, retailer: "Umbro", url: "https://www.amazon.com/s?k=Umbro+Zip-Up+Track+Jacket&tag=styleaiapp-20" },
      { id: 6, name: "Terry Cloth Wristband", brand: "Nike", price: 18, image: "", match: 81, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Terry+Cloth+Wristband&tag=styleaiapp-20" },
    ],
    // ── COUNTERCULTURAL ──
    "Goth": [
      { id: 1, name: "Platform Chelsea Boots", brand: "Dr. Martens", price: 179, image: "", match: 96, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Platform+Chelsea+Boots&tag=styleaiapp-20" },
      { id: 2, name: "Oversized Black Trench Coat", brand: "ASOS", price: 119, image: "", match: 93, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Oversized+Black+Trench+Coat&tag=styleaiapp-20" },
      { id: 3, name: "Layered Chain Choker", brand: "ASOS", price: 18, image: "", match: 90, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Layered+Chain+Choker&tag=styleaiapp-20" },
      { id: 4, name: "All-Black Skinny Jeans", brand: "Topman", price: 55, image: "", match: 87, retailer: "Topman", url: "https://www.amazon.com/s?k=Topman+All-Black+Skinny+Jeans&tag=styleaiapp-20" },
      { id: 5, name: "Velvet Blazer", brand: "ASOS", price: 89, image: "", match: 84, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Velvet+Blazer&tag=styleaiapp-20" },
      { id: 6, name: "Fishnet Layering Top", brand: "Wolford", price: 45, image: "", match: 81, retailer: "Wolford", url: "https://www.amazon.com/s?k=Wolford+Fishnet+Layering+Top&tag=styleaiapp-20" },
    ],

    "Grunge / Punk": [
      { id: 1, name: "Studded Leather Jacket", brand: "ASOS", price: 110, image: "", match: 96, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Studded+Leather+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Band Graphic Tee", brand: "Urban Outfitters", price: 34, image: "", match: 93, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Band+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "1460 Mono Boots", brand: "Dr. Martens", price: 180, image: "", match: 90, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+1460+Mono+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Distressed Jeans", brand: "Levi's", price: 88, image: "", match: 87, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Distressed+Jeans&tag=styleaiapp-20" },
      { id: 5, name: "Plaid Flannel Shirt", brand: "Carhartt", price: 59, image: "", match: 84, retailer: "Carhartt", url: "https://www.amazon.com/s?k=Carhartt+Plaid+Flannel+Shirt&tag=styleaiapp-20" },
      { id: 6, name: "Safety Pin Set", brand: "ASOS", price: 8, image: "", match: 81, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Safety+Pin+Set&tag=styleaiapp-20" },
    ],
    // ── CULTURAL / REGIONAL ──
    "Western / Americana": [
      { id: 1, name: "Cowboy Boots", brand: "Ariat", price: 199, image: "", match: 96, retailer: "Ariat", url: "https://www.amazon.com/s?k=Ariat+Cowboy+Boots&tag=styleaiapp-20" },
      { id: 2, name: "Wide-Brim Felt Hat", brand: "Lack of Color", price: 129, image: "", match: 93, retailer: "Lack of Color", url: "https://www.amazon.com/s?k=Lack+of+Color+Wide-Brim+Felt+Hat&tag=styleaiapp-20" },
      { id: 3, name: "Embroidered Western Shirt", brand: "Wrangler", price: 79, image: "", match: 90, retailer: "Wrangler", url: "https://www.amazon.com/s?k=Wrangler+Embroidered+Western+Shirt&tag=styleaiapp-20" },
      { id: 4, name: "Bootcut Denim Jeans", brand: "Levi's", price: 99, image: "", match: 87, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Bootcut+Denim+Jeans&tag=styleaiapp-20" },
      { id: 5, name: "Leather Belt with Buckle", brand: "Ariat", price: 55, image: "", match: 84, retailer: "Ariat", url: "https://www.amazon.com/s?k=Ariat+Leather+Belt+with+Buckle&tag=styleaiapp-20" },
      { id: 6, name: "Denim Fringe Jacket", brand: "Levi's", price: 149, image: "", match: 81, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Denim+Fringe+Jacket&tag=styleaiapp-20" },
    ],

    "K-Fashion": [
      { id: 1, name: "Oversized Varsity Jacket", brand: "Ader Error", price: 289, image: "", match: 96, retailer: "Ader Error", url: "https://www.amazon.com/s?k=Ader+Error+Oversized+Varsity+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Cropped Wide-Leg Trousers", brand: "COS", price: 109, image: "", match: 93, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Cropped+Wide-Leg+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Platform Dad Sneakers", brand: "New Balance", price: 139, image: "", match: 90, retailer: "New Balance", url: "https://www.amazon.com/s?k=New+Balance+Platform+Dad+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Pastel Oversized Cardigan", brand: "COS", price: 89, image: "", match: 87, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Pastel+Oversized+Cardigan&tag=styleaiapp-20" },
      { id: 5, name: "Bucket Hat", brand: "Maje", price: 65, image: "", match: 84, retailer: "Maje", url: "https://www.amazon.com/s?k=Maje+Bucket+Hat&tag=styleaiapp-20" },
      { id: 6, name: "Mini Shoulder Bag", brand: "Marc Jacobs", price: 175, image: "", match: 81, retailer: "Marc Jacobs", url: "https://www.amazon.com/s?k=Marc+Jacobs+Mini+Shoulder+Bag&tag=styleaiapp-20" },
    ],

    // ── EMERGING ──
    "Retro-Futurism": [
      { id: 1, name: "Metallic Bomber Jacket", brand: "ASOS", price: 129, image: "", match: 96, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Metallic+Bomber+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Reflective Cargo Trousers", brand: "Zara", price: 79, image: "", match: 93, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Reflective+Cargo+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Futuristic Running Shoes", brand: "Salomon", price: 149, image: "", match: 90, retailer: "Salomon", url: "https://www.amazon.com/s?k=Salomon+Futuristic+Running+Shoes&tag=styleaiapp-20" },
      { id: 4, name: "Silver Mirror Sunglasses", brand: "Le Specs", price: 69, image: "", match: 87, retailer: "Le Specs", url: "https://www.amazon.com/s?k=Le+Specs+Silver+Mirror+Sunglasses&tag=styleaiapp-20" },
      { id: 5, name: "Chrome Crossbody Bag", brand: "Coperni", price: 395, image: "", match: 84, retailer: "Coperni", url: "https://www.amazon.com/s?k=Coperni+Chrome+Crossbody+Bag&tag=styleaiapp-20" },
      { id: 6, name: "Asymmetric Knit Top", brand: "Mango", price: 59, image: "", match: 81, retailer: "Mango", url: "https://www.amazon.com/s?k=Mango+Asymmetric+Knit+Top&tag=styleaiapp-20" },
    ],

    "Historical Romanticism": [
      { id: 1, name: "Ruffled Poet Shirt", brand: "ASOS", price: 45, image: "", match: 96, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Ruffled+Poet+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Velvet Blazer", brand: "Vivienne Westwood", price: 395, image: "", match: 93, retailer: "Vivienne Westwood", url: "https://www.amazon.com/s?k=Vivienne+Westwood+Velvet+Blazer&tag=styleaiapp-20" },
      { id: 3, name: "Puffed Sleeve Blouse", brand: "& Other Stories", price: 69, image: "", match: 90, retailer: "& Other Stories", url: "https://www.amazon.com/s?k=%26+Other+Stories+Puffed+Sleeve+Blouse&tag=styleaiapp-20" },
      { id: 4, name: "Velvet Midi Skirt", brand: "Free People", price: 128, image: "", match: 87, retailer: "Free People", url: "https://www.amazon.com/s?k=Free+People+Velvet+Midi+Skirt&tag=styleaiapp-20" },
      { id: 5, name: "Pearl Headband", brand: "Jennifer Behr", price: 95, image: "", match: 84, retailer: "Jennifer Behr", url: "https://www.amazon.com/s?k=Jennifer+Behr+Pearl+Headband&tag=styleaiapp-20" },
      { id: 6, name: "Buckled Dress Shoes", brand: "Dr. Martens", price: 159, image: "", match: 81, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Buckled+Dress+Shoes&tag=styleaiapp-20" },
    ],

    // ── LEGACY KEYS (map old names → closest new category) ──
    "Clean Minimal": [
      { id: 1, name: "Relaxed Linen Blazer", brand: "& Other Stories", price: 149, image: "", match: 95, retailer: "& Other Stories", url: "https://www.amazon.com/s?k=%26+Other+Stories+Relaxed+Linen+Blazer&tag=styleaiapp-20" },
      { id: 2, name: "Wide-Leg Tailored Trousers", brand: "Arket", price: 119, image: "", match: 92, retailer: "Arket", url: "https://www.amazon.com/s?k=Arket+Wide-Leg+Tailored+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "White Low-Top Sneakers", brand: "Adidas", price: 90, image: "", match: 89, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+White+Low-Top+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Structured Leather Tote", brand: "Toteme", price: 395, image: "", match: 86, retailer: "Toteme", url: "https://www.amazon.com/s?k=Toteme+Structured+Leather+Tote&tag=styleaiapp-20" },
    ],

    "Coastal": [
      { id: 1, name: "Linen Stripe Shirt", brand: "Faherty", price: 128, image: "", match: 96, retailer: "Faherty", url: "https://www.amazon.com/s?k=Faherty+Linen+Stripe+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Relaxed Chino Shorts", brand: "J.Crew", price: 79, image: "", match: 90, retailer: "J.Crew", url: "https://www.amazon.com/s?k=J.Crew+Relaxed+Chino+Shorts&tag=styleaiapp-20" },
      { id: 3, name: "Canvas Slip-On Sneakers", brand: "Vans", price: 65, image: "", match: 88, retailer: "Vans", url: "https://www.amazon.com/s?k=Vans+Canvas+Slip-On+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Woven Straw Hat", brand: "Lack of Color", price: 99, image: "", match: 84, retailer: "Lack of Color", url: "https://www.amazon.com/s?k=Lack+of+Color+Woven+Straw+Hat&tag=styleaiapp-20" },
    ],
    "Streetwear": [
      { id: 1, name: "Carpenter Jeans", brand: "Carhartt WIP", price: 110, image: "", match: 97, retailer: "Carhartt WIP", url: "https://www.amazon.com/s?k=Carhartt+WIP+Carpenter+Jeans&tag=styleaiapp-20" },
      { id: 2, name: "Heavyweight Graphic Tee", brand: "Carhartt WIP", price: 65, image: "", match: 93, retailer: "Carhartt WIP", url: "https://www.amazon.com/s?k=Carhartt+WIP+Heavyweight+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "Puffer Jacket", brand: "The North Face", price: 229, image: "", match: 90, retailer: "The North Face", url: "https://www.amazon.com/s?k=The+North+Face+Puffer+Jacket&tag=styleaiapp-20" },
      { id: 4, name: "Relaxed Fit Cargo Pants", brand: "Nike", price: 85, image: "", match: 86, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Relaxed+Fit+Cargo+Pants&tag=styleaiapp-20" },
      { id: 5, name: "Air Force 1 Low", brand: "Nike", price: 110, image: "", match: 83, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Air+Force+1+Low&tag=styleaiapp-20" },
      { id: 6, name: "Fleece Quarter-Zip", brand: "Stüssy", price: 120, image: "", match: 80, retailer: "Stüssy", url: "https://www.amazon.com/s?k=Stussy+Fleece+Quarter+Zip&tag=styleaiapp-20" },
    ],
    "Hypebeast": [
      { id: 1, name: "Air Max 95 OG", brand: "Nike", price: 185, image: "", match: 97, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Air+Max+95+OG&tag=styleaiapp-20" },
      { id: 2, name: "Box Logo Hoodie", brand: "Supreme", price: 168, image: "", match: 94, retailer: "Supreme", url: "https://www.amazon.com/s?k=Supreme+Box+Logo+Hoodie&tag=styleaiapp-20" },
      { id: 3, name: "Jordan 1 Retro High OG", brand: "Jordan Brand", price: 180, image: "", match: 91, retailer: "Jordan Brand", url: "https://www.amazon.com/s?k=Jordan+1+Retro+High+OG&tag=styleaiapp-20" },
      { id: 4, name: "Crossbody Shoulder Bag", brand: "Supreme", price: 148, image: "", match: 87, retailer: "Supreme", url: "https://www.amazon.com/s?k=Supreme+Crossbody+Shoulder+Bag&tag=styleaiapp-20" },
      { id: 5, name: "Logo Tee", brand: "Off-White", price: 290, image: "", match: 84, retailer: "Off-White", url: "https://www.amazon.com/s?k=Off-White+Logo+Tee&tag=styleaiapp-20" },
      { id: 6, name: "Camo Cap", brand: "Palace", price: 45, image: "", match: 80, retailer: "Palace", url: "https://www.amazon.com/s?k=Palace+Camo+Cap&tag=styleaiapp-20" },
    ],
    "Cottagecore": [
      { id: 1, name: "Floral Linen Shirt", brand: "Uniqlo", price: 39, image: "", match: 95, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Floral+Linen+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Crochet Cardigan", brand: "Free People", price: 148, image: "", match: 92, retailer: "Free People", url: "https://www.amazon.com/s?k=Free+People+Crochet+Cardigan&tag=styleaiapp-20" },
      { id: 3, name: "Prairie Smock Dress", brand: "Anthropologie", price: 168, image: "", match: 89, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Prairie+Smock+Dress&tag=styleaiapp-20" },
      { id: 4, name: "Wicker Basket Bag", brand: "Cult Gaia", price: 195, image: "", match: 86, retailer: "Cult Gaia", url: "https://www.amazon.com/s?k=Cult+Gaia+Wicker+Basket+Bag&tag=styleaiapp-20" },
    ],

    "Dark Academia": [
      { id: 1, name: "Plaid Wool Blazer", brand: "Polo Ralph Lauren", price: 349, image: "", match: 96, retailer: "Polo Ralph Lauren", url: "https://www.amazon.com/s?k=Polo+Ralph+Lauren+Plaid+Wool+Blazer&tag=styleaiapp-20" },
      { id: 2, name: "High-Waist Pleated Trousers", brand: "COS", price: 119, image: "", match: 92, retailer: "COS", url: "https://www.amazon.com/s?k=COS+High-Waist+Pleated+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Oxford Brogues", brand: "Thursday Boot Co", price: 199, image: "", match: 89, retailer: "Thursday", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Oxford+Brogues&tag=styleaiapp-20" },
      { id: 4, name: "Turtleneck Knit", brand: "Uniqlo", price: 49, image: "", match: 85, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Turtleneck+Knit&tag=styleaiapp-20" },
    ],
    "Y2K": [
      { id: 1, name: "Low-Rise Flare Jeans", brand: "Levi's", price: 99, image: "", match: 95, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Low-Rise+Flare+Jeans&tag=styleaiapp-20" },
      { id: 2, name: "Baggy Graphic Jersey Tee", brand: "Urban Outfitters", price: 45, image: "", match: 92, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Baggy+Graphic+Jersey+Tee&tag=styleaiapp-20" },
      { id: 3, name: "Platform Sneakers", brand: "Buffalo London", price: 149, image: "", match: 89, retailer: "Buffalo London", url: "https://www.amazon.com/s?k=Buffalo+London+Platform+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Von Dutch Trucker Cap", brand: "Von Dutch", price: 45, image: "", match: 86, retailer: "Von Dutch", url: "https://www.amazon.com/s?k=Von+Dutch+Von+Dutch+Trucker+Cap&tag=styleaiapp-20" },
    ],

    "Bohemian": [
      { id: 1, name: "Wide-Brim Straw Hat", brand: "Lack of Color", price: 119, image: "", match: 95, retailer: "Lack of Color", url: "https://www.amazon.com/s?k=Lack+of+Color+Wide-Brim+Straw+Hat&tag=styleaiapp-20" },
      { id: 2, name: "Linen Button-Down Shirt", brand: "Zara", price: 49, image: "", match: 92, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Linen+Button-Down+Shirt&tag=styleaiapp-20" },
      { id: 3, name: "Suede Fringe Boots", brand: "Sam Edelman", price: 149, image: "", match: 89, retailer: "Sam Edelman", url: "https://www.amazon.com/s?k=Sam+Edelman+Suede+Fringe+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Layered Gold Necklace", brand: "Anthropologie", price: 48, image: "", match: 86, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Layered+Gold+Necklace&tag=styleaiapp-20" },
    ],

    "Classic Prep": [
      { id: 1, name: "Cable-Knit Crewneck", brand: "J.Crew", price: 118, image: "", match: 95, retailer: "J.Crew", url: "https://www.amazon.com/s?k=J.Crew+Cable-Knit+Crewneck&tag=styleaiapp-20" },
      { id: 2, name: "Slim Chino Pants", brand: "Banana Republic", price: 89, image: "", match: 91, retailer: "Banana Republic", url: "https://www.amazon.com/s?k=Banana+Republic+Slim+Chino+Pants&tag=styleaiapp-20" },
      { id: 3, name: "Penny Loafers", brand: "G.H. Bass", price: 160, image: "", match: 88, retailer: "G.H. Bass", url: "https://www.amazon.com/s?k=G.H.+Bass+Penny+Loafers&tag=styleaiapp-20" },
      { id: 4, name: "Quilted Vest", brand: "Barbour", price: 149, image: "", match: 84, retailer: "Barbour", url: "https://www.amazon.com/s?k=Barbour+Quilted+Vest&tag=styleaiapp-20" },
    ],
    "Athleisure": [
      { id: 1, name: "Seamless Jogger Set", brand: "Gymshark", price: 89, image: "", match: 96, retailer: "Gymshark", url: "https://www.amazon.com/s?k=Gymshark+Seamless+Jogger+Set&tag=styleaiapp-20" },
      { id: 2, name: "Oversized Hoodie", brand: "Nike", price: 75, image: "", match: 93, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Oversized+Hoodie&tag=styleaiapp-20" },
      { id: 3, name: "Court Low Sneakers", brand: "New Balance", price: 89, image: "", match: 90, retailer: "New Balance", url: "https://www.amazon.com/s?k=New+Balance+Court+Low+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Track Pants", brand: "Adidas", price: 65, image: "", match: 87, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+Track+Pants&tag=styleaiapp-20" },
      { id: 5, name: "Seamless Leggings", brand: "Lululemon", price: 98, image: "", match: 84, retailer: "Lululemon", url: "https://www.amazon.com/s?k=Lululemon+Seamless+Leggings&tag=styleaiapp-20" },
      { id: 6, name: "Quarter-Zip Pullover", brand: "Lululemon", price: 118, image: "", match: 81, retailer: "Lululemon", url: "https://www.amazon.com/s?k=Lululemon+Quarter-Zip+Pullover&tag=styleaiapp-20" },
    ],

    "Vintage": [
      { id: 1, name: "Washed Denim Jacket", brand: "Levi's", price: 89, image: "", match: 95, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Washed+Denim+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Vintage Band Graphic Tee", brand: "Urban Outfitters", price: 35, image: "", match: 92, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Vintage+Band+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 179, image: "", match: 89, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Chunky+Platform+Boots&tag=styleaiapp-20" },
      { id: 4, name: "90s Logo Cap", brand: "Tommy Hilfiger", price: 38, image: "", match: 86, retailer: "Tommy Hilfiger", url: "https://www.amazon.com/s?k=Tommy+Hilfiger+90s+Logo+Cap&tag=styleaiapp-20" },
    ],

  };

  const products = aestheticProducts[aesthetic] ?? [
    { id: 1, name: "Classic White Shirt", brand: "COS", price: 79, image: "", match: 88, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Classic+White+Shirt&tag=styleaiapp-20" },
    { id: 2, name: "Slim Fit Jeans", brand: "Levi's", price: 89, image: "", match: 85, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Slim+Fit+Jeans&tag=styleaiapp-20" },
    { id: 3, name: "Leather Derby Shoes", brand: "Thursday Boot Co", price: 149, image: "", match: 82, retailer: "Thursday", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Leather+Derby+Shoes&tag=styleaiapp-20" },
    { id: 4, name: "Canvas Tote", brand: "Baggu", price: 38, image: "", match: 79, retailer: "Baggu", url: "https://www.amazon.com/s?k=Baggu+Canvas+Tote&tag=styleaiapp-20" },
  ];
  // Backfill images for any product that doesn't have one yet
  return products.map(p => ({ ...p, image: p.image || buildImageKeywords(p.name) }));
}

// ─── Gemini response schema (structured output — no regex parsing needed) ───
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

const GARMENT_SYSTEM_INSTRUCTION = `You are a precise fashion analyst. Your job is to inventory every visible garment and accessory in an outfit image.
Be exhaustive and specific. List every item you can see — including items that are partially visible.
Focus on factual observation: what you literally see. No interpretation of style or aesthetic yet — that comes later.
Be specific with names: not "pants" but "wide-leg corduroy trousers". Not "shoes" but "lug-sole platform boots".`;

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
  { sub: "femalefashionadvice",   aesthetic: "Minimalist" },
  { sub: "malefashionadvice",     aesthetic: "Old Money" },
  { sub: "DarkAcademia",          aesthetic: "Dark Academia" },
  { sub: "cottagecore",           aesthetic: "Cottagecore" },
  { sub: "y2kfashion",            aesthetic: "Y2K" },
  { sub: "OUTFITS",               aesthetic: "Clean Girl" },
  { sub: "findfashion",           aesthetic: "Boho" },
  { sub: "weddingfashion",        aesthetic: "Romantic" },
  { sub: "crossdressing",         aesthetic: "Grunge" },
  { sub: "businessprofessionals", aesthetic: "Business Casual" },
  { sub: "AthleticWear",          aesthetic: "Athleisure" },
  { sub: "FashionAdvice",         aesthetic: "Preppy" },
  { sub: "streetstyle",           aesthetic: "Indie" },
  { sub: "Sneakers",              aesthetic: "Hypebeast" },
  { sub: "fashionadvice",         aesthetic: "Coastal" },
];

// Fetch top image posts from a subreddit (no auth needed for read-only)
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

// Core analysis + store function (module-level)
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
export async function triggerSeedIfEmpty() {
  try {
    const existing = await storage.discoverCardCount();
    if (existing > 0) {
      console.log(`[seed] ${existing} cards already in DB — skipping auto-seed`);
      return;
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log("[seed] No GEMINI_API_KEY — skipping auto-seed");
      return;
    }
    console.log("[seed] 0 cards found — starting background seed from Reddit...");
    const genAI = new GoogleGenerativeAI(apiKey);
    let seeded = 0;
    for (const { sub, aesthetic } of SUBREDDIT_MAP) {
      try {
        const posts = await fetchSubredditImages(sub, 2, "month");
        for (const post of posts) {
          try {
            const card = await analyzeAndStore(post.imageUrl, post.postUrl, sub, aesthetic, genAI);
            if (card) seeded++;
            await new Promise(r => setTimeout(r, 600));
          } catch (e: any) {
            console.warn(`[seed] ${sub} image error: ${e.message}`);
          }
        }
      } catch (e: any) {
        console.warn(`[seed] ${sub} fetch error: ${e.message}`);
      }
    }
    console.log(`[seed] Auto-seed complete — ${seeded} cards added`);
  } catch (err: any) {
    console.error("[seed] Auto-seed failed:", err.message);
  }
}

export async function registerRoutes(httpServer: Server, app: Express) {
  await initDB();

  // Auto-seed trending cards on startup (background, non-blocking)
  if (process.env.APIFY_TOKEN) {
    setTimeout(() => {
      fetch(`http://localhost:${process.env.PORT || 5000}/api/seed-trending`)
        .catch(() => {});
    }, 10_000); // wait 10s for server to fully start
  }

  // POST /api/seed-wave — seed a custom list of queries with garmentType tags
  // Body: { queries: [{ query, aesthetic, garmentType }], limit? }
  // Runs in background like seed-trending, skips already-cached queries
  app.post("/api/seed-wave", async (req, res) => {
    const { queries, limit = 8 } = req.body as { queries: { query: string; aesthetic: string; garmentType: string }[]; limit?: number };
    if (!queries?.length) return res.status(400).json({ error: "queries required" });
    res.json({ started: true, total: queries.length });
    // Run in background
    (async () => {
      let seeded = 0;
      for (const { query, aesthetic, garmentType } of queries) {
        const cached = await getDepopCache(query).catch(() => null);
        if (cached) { seeded++; continue; }
        const listings = await scrapeDepopDirect(query, limit).catch(() => []);
        if (listings.length) {
          await setDepopCache(query, listings, aesthetic, true, garmentType).catch(() => {});
          seeded++;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      console.log(`[seed-wave] done: ${seeded}/${queries.length} seeded`);
    })();
  });

  // Seed trending Depop cards from Google Trends fashion searches
  // GET /api/seed-trending — fires in background, returns immediately
  // GET /api/seed-trending?wait=1 — waits for completion (use from cron)
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
        const allQueries = [...curatedBase, ...trendQueries];

        console.log(`[seed-trending] ${allQueries.length} queries (${fashionTerms.length} from Trends + ${curatedBase.length} curated)`);

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
  // POST /api/backfill-embeddings — one-time backfill of vector embeddings for all cache rows
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

  // POST /api/onboarding
  // Seeds a user's taste vector from their aesthetic picks.
  // Body: { userId: string, aesthetics: string[] }
  app.post("/api/onboarding", async (req, res) => {
    try {
      const { userId, aesthetics, gender } = req.body as { userId: string; aesthetics: string[]; gender?: string };
      if (!userId || !aesthetics?.length) {
        return res.status(400).json({ error: "userId and aesthetics required" });
      }
      const tasteVector = await getAverageEmbeddingForAesthetics(aesthetics);
      if (!tasteVector) {
        return res.status(500).json({ error: "Could not build taste vector" });
      }
      await upsertUserProfile(userId, tasteVector, 0, undefined, undefined, true);
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

  // PATCH /api/user-gender/:userId — update gender preference without re-running onboarding
  app.patch("/api/user-gender/:userId", async (req, res) => {
    try {
      const { gender } = req.body as { gender: string };
      if (!["male", "female", "both"].includes(gender)) {
        return res.status(400).json({ error: "gender must be male | female | both" });
      }
      const { default: pg } = await import("postgres");
      const c = pg(process.env.DATABASE_URL!, { ssl: "require" });
      await c`UPDATE user_profiles SET gender = ${gender} WHERE user_id = ${req.params.userId}`;
      await c.end();
      res.json({ success: true, gender });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/interact
  // Updates a user's taste vector based on a like, save, or skip action.
  // Body: { userId: string, itemId: string, action: "like"|"save"|"skip", query: string }
  // The query is the depop_cache query key for the item (used to fetch its embedding)
  app.post("/api/interact", async (req, res) => {
    try {
      const { userId, itemId, action, query } = req.body as {
        userId: string; itemId: string; action: "like" | "save" | "skip"; query: string;
      };
      if (!userId || !itemId || !action) {
        return res.status(400).json({ error: "userId, itemId, action required" });
      }

      // Weights: save = 3, like = 1, skip = -0.5
      const WEIGHTS: Record<string, number> = { save: 3, like: 1, skip: -0.5 };
      const weight = WEIGHTS[action] ?? 1;

      // Get current profile
      const profile = await getUserProfile(userId);

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
        // Update running weighted average
        // taste_vector = (taste_vector * n + item_embedding * weight) / (n + |weight|)
        const currentVec = profile.taste_vector.slice(1, -1).split(",").map(Number);
        const n = profile.interaction_count || 1;
        const totalWeight = n + Math.abs(weight);
        newVector = currentVec.map((v, i) =>
          (v * n + itemEmbedding![i] * weight) / totalWeight
        );
      }

      // Normalize the vector to unit length (keeps cosine similarity stable)
      const magnitude = Math.sqrt(newVector.reduce((sum, v) => sum + v * v, 0));
      if (magnitude > 0) newVector = newVector.map(v => v / magnitude);

      await upsertUserProfile(
        userId,
        newVector,
        Math.abs(weight),
        action !== "skip" ? itemId : undefined,
        action === "skip" ? itemId : undefined
      );

      // Store full item details for liked/saved items so history can display them
      if (action === "like" || action === "save") {
        const fullItem = req.body.item as any;
        // Use URL as stable ID — numeric itemId is just a sequential index
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
        }).catch((e: any) => console.error("[appendLikedItem]", e.message)); // log errors but don't fail
      }

      res.json({ success: true, updated: true, action, interactionCount: (profile?.interaction_count || 0) + Math.abs(weight) });
    } catch (e: any) {
      console.error("[interact]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/for-you/:userId?offset=0
  // Returns personalized Depop recommendations for a user.
  app.get("/api/for-you/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const offset = parseInt((req.query.offset as string) || "0", 10);

      const profile = await getUserProfile(userId);
      if (!profile || !profile.onboarded) {
        return res.status(404).json({ error: "user_not_onboarded", onboarded: false });
      }

      const { items, hasMore } = await getForYouRecommendations(userId, 20, offset);
      res.json({ items, hasMore, interactionCount: profile.interaction_count });
    } catch (e: any) {
      console.error("[for-you]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/user-profile/:userId — check if user exists + is onboarded
  app.get("/api/user-profile/:userId", async (req, res) => {
    try {
      const profile = await getUserProfile(req.params.userId);
      if (!profile) return res.json({ exists: false, onboarded: false });
      res.json({ exists: true, onboarded: profile.onboarded, interactionCount: profile.interaction_count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/liked-items/:userId — returns all liked/saved Depop items for history tab
  app.get("/api/liked-items/:userId", async (req, res) => {
    try {
      const items = await getLikedItems(req.params.userId);
      res.json({ items });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

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

  // Test proxy scraper directly
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

  // Test Cloudflare Worker proxy
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

  // Test direct Depop API access (no proxy) — to check if Render can hit it directly
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

  // Temp: test Apify token + actor from server
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

  // Debug: check what getDepopCacheByType actually returns
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

  // Analyze outfit image with Gemini Flash
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
      // Map detected item names to garment_type categories
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

      function buildGarmentQueries(garments: any[], aesthetic = ""): { query: string; garmentType: string }[] {
        // Skip accessories and non-clothing items for Depop search
        const skipTypes = /hat|bag|purse|sunglasses|glasses|watch|jewelry|necklace|ring|earring|bracelet|belt|sock|perfume|scarf|glove|ball|volleyball|football|basketball|helmet|phone|bottle|prop/i;
        const usefulGarments = garments
          .filter((g: any) => !skipTypes.test(g.item))
          .slice(0, 4);

        return usefulGarments.map((g: any) => {
          const parts: string[] = [];
          if (g.color && g.color !== "unknown") parts.push(g.color);
          if (g.fabric && g.fabric !== "unknown" && g.fabric !== "fabric") parts.push(g.fabric);
          parts.push(g.item);
          const verbose = parts.join(" ").toLowerCase().trim();
          // Apply Depop-native query transformation: aesthetic prefix + stripped description
          const query = aesthetic ? stripToDepopQuery(verbose, aesthetic) : verbose;
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

      // Rebuild with aesthetic prefix now that Pass 2 has returned the aesthetic
      const resolvedAesthetic: string = analysis.aesthetic || "";
      const aestheticGarmentQueries = rawGarmentQueries.length >= 2
        ? buildGarmentQueries(garmentData.garments || [], resolvedAesthetic)
        : (analysis.keyPieces || []).map((p: string) => ({
            query: stripToDepopQuery(p.toLowerCase(), resolvedAesthetic),
            garmentType: inferGarmentType(p),
          }));
      const garmentDepopQueries = aestheticGarmentQueries;

      // Build products from Gemini's split recommendations
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

      const deviceId = req.headers["x-device-id"] as string | undefined;

      const scan = await storage.createScan({
        deviceId: deviceId || null,
        imageData: imageDataUrl,
        aesthetic: analysis.aesthetic,
        confidence: analysis.confidence,
        styleBreakdown: JSON.stringify(styleBreakdown),
        occasions: JSON.stringify(analysis.occasions),
        keyPieces: JSON.stringify(analysis.keyPieces || []),
        depopQueries: JSON.stringify(garmentDepopQueries.slice(0, 4).map((g: any) => ({ query: g.query, garmentType: g.garmentType }))),
        colorPalette: JSON.stringify(analysis.colorPalette),
        results: JSON.stringify(finalProducts),
      });

      res.json({ scanId: scan.id });

      // Post-analysis: serve Depop recommendations purely from the permanent cache.
      // No live scraping — pull by garmentType + aesthetic so results are always relevant.
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

  // Get scans — filtered by device if x-device-id header present
  app.get("/api/scans", async (req, res) => {
    const deviceId = req.headers["x-device-id"] as string | undefined;
    const allScans = await storage.getScans(deviceId || undefined);
    res.json(allScans);
  });

  // Get single scan
  app.get("/api/scans/:id", async (req, res) => {
    const scan = await storage.getScan(Number(req.params.id));
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    res.json(scan);
  });

  // Get wardrobe
  app.get("/api/wardrobe", async (req, res) => {
    const items = await storage.getWardrobeItems();
    res.json(items);
  });

  // Add wardrobe item
  app.post("/api/wardrobe", upload.single("image"), async (req, res) => {
    try {
      const file = req.file;
      const { name, category, brand, color, aesthetic } = req.body;
      if (!file || !name || !category) return res.status(400).json({ error: "Missing required fields" });

      const imageData = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const item = await storage.createWardrobeItem({ name, category, brand, color, aesthetic, imageData, source: "manual" });
      res.json(item);
    } catch (err: any) {
      console.error("Wardrobe error:", err);
      res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Failed to save item. Please try again." : err.message });
    }
  });

  // Delete wardrobe item
  app.delete("/api/wardrobe/:id", async (req, res) => {
    await storage.deleteWardrobeItem(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Discover feed ─────────────────────────────────────────────────────────────────

  // GET /api/discover?userId=xxx — returns cards ordered by taste vector if userId given
  app.get("/api/discover", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      let cards: any[];
      if (userId) {
        cards = await getDiscoverCardsByTaste(userId);
      } else {
        cards = await storage.getDiscoverCards();
      }
      res.json(cards);
    } catch (err: any) {
      console.error("Discover fetch error:", err);
      res.status(500).json({ error: "Failed to fetch discover feed" });
    }
  });

  // GET /api/discover/trending — top liked cards (for surfacing to new users)
  app.get("/api/discover/trending", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const cards = await storage.getTrendingCards(limit);
      res.json(cards);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/discover/shop-the-look?aesthetic=X&pieces=piece1,piece2 — real Depop items per piece
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

  // GET /api/wardrobe/gap-recommendations/:userId — taste-matched items for missing garment types
  app.get("/api/wardrobe/gap-recommendations/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      if (!userId) return res.status(400).json({ error: "Missing userId" });
      const wardrobeItems = await storage.getWardrobeItems();
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

  // GET /api/discover/:id/similar?aesthetic=X&tags=a,b — similar discover cards by embedding
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

    // POST /api/discover/:id/like — increment likes_count for a card
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

  // DELETE /api/discover/reset — wipe all cards and re-seed fresh
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

  // POST /api/discover/seed — initial seed from Reddit (idempotent, uses month/top)
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

  // POST /api/depop-search — check cache first, kick off Apify runs if needed
  // Body: { queries: string[], aesthetic: string }
  // Returns immediately with { cached: true, groups } OR { cached: false, runs: [{query,runId,datasetId}] }
  // Helper: given a piece name + pool of listings, return the best-matching subset
  // by scoring how many words in the piece appear in the listing title
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
      // Check cache for all queries in parallel
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

      // Partial or no cache — try proxy scraper first (instant), then Apify
      const uncached = cacheResults.filter(r => !r.listings);
      let runs: { query: string; runId: string; datasetId: string }[] = [];

      // If proxy is available, scrape all uncached queries directly — fast, no polling needed
      if (process.env.PROXY_URL && uncached.length) {
        const proxyResults = await Promise.all(
          uncached.map(async ({ query: q }) => {
            try {
              const listings = await scrapeDepopDirect(q, 6);
              if (listings.length) {
                await setDepopCache(q, listings, aesthetic).catch(() => {});
                return {
                  piece: q.includes(" ") ? q.split(" ").slice(1).join(" ") : q,
                  listings,
                };
              }
            } catch (e: any) {
              console.warn(`[depop-search] proxy failed for "${q}": ${e.message}`);
            }
            return null;
          })
        );
        const proxyGroups = proxyResults.filter((g): g is { piece: string; listings: any[] } => !!g);
        if (proxyGroups.length) {
          const allGroups = [
            ...cacheResults.filter(r => r.listings).map(r => ({
              piece: r.query.includes(" ") ? r.query.split(" ").slice(1).join(" ") : r.query,
              listings: r.listings!,
            })),
            ...proxyGroups,
          ].filter(g => g.listings.length > 0);
          console.log(`[depop-search] proxy got ${proxyGroups.length}/${uncached.length} groups instantly`);
          return res.json({ cached: true, groups: allGroups });
        }
      }

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

      // --- Fallback: if Apify couldn't start runs for some queries, use aesthetic cache ---
      const queriesNeedingFallback = uncached
        .filter(r => !runs.find(run => run.query === r.query))
        .map(r => r.query);

      if (queriesNeedingFallback.length > 0 && aesthetic) {
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

  // GET /api/depop-feed?aesthetics=<json array> — return cached Depop cards for home feed
  app.get("/api/depop-feed", async (req, res) => {
    const { aesthetics: aestheticsRaw = "[]" } = req.query as Record<string, string>;
    let aesthetics: string[] = [];
    try { aesthetics = JSON.parse(aestheticsRaw); } catch { aesthetics = []; }
    // For home feed, use top 3 user aesthetics or first 3 defaults — 3 × 50 = 150 listings max
    const topDefaults = DEFAULT_FEED_AESTHETICS.slice(0, 3); // Streetwear, Minimalist, Y2K
    const targetAesthetics = aesthetics.length ? aesthetics.slice(0, 3) : topDefaults;
    try {
      // Pull up to 50 listings per aesthetic (150 total — enough for 135-card grid)
      const results = await Promise.all(
        targetAesthetics.map(a => getDepopCacheByAesthetic(a, 50))
      );
      // Cross-aesthetic dedup — same item can legitimately exist under multiple aesthetics
      const seenUrls = new Set<string>();
      const listings = results.flat().filter((l: any) => {
        const key = l.url || l.product_link || (l.image ? l.image.split('?')[0] : '');
        if (!key || seenUrls.has(key)) return false;
        seenUrls.add(key);
        return true;
      });
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

  // GET /api/depop-poll?runs=<json>&aesthetic=<str> — poll runs, cache + return on success
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

  // GET /api/depop-ready/:scanId
  // Returns { ready: true, groups } immediately from permanent cache.
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

  // POST /api/discover/refresh — pull HOT posts + prune stale zero-liked cards
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
