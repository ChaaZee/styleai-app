import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, and, lt, sql } from "drizzle-orm";
import OpenAI from "openai";

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
import {
  scans,
  wardrobeItems,
  discoverCards,
  type Scan,
  type InsertScan,
  type WardrobeItem,
  type InsertWardrobeItem,
  type DiscoverCard,
  type InsertDiscoverCard,
} from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
});
const db = drizzle(client);

// Create tables if they don't exist
export async function initDB() {
  await client`
    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      image_data TEXT NOT NULL,
      aesthetic TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      style_breakdown TEXT NOT NULL,
      occasions TEXT NOT NULL,
      key_pieces TEXT NOT NULL,
      color_palette TEXT NOT NULL,
      results TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Add device_id column if it doesn't exist (safe migration)
  await client`
    ALTER TABLE scans ADD COLUMN IF NOT EXISTS device_id TEXT
  `;

  // Add depop_queries column if it doesn't exist
  await client`
    ALTER TABLE scans ADD COLUMN IF NOT EXISTS depop_queries TEXT
  `;

  // Add garment_type column to depop_cache for smart recommendations
  await client`
    ALTER TABLE depop_cache ADD COLUMN IF NOT EXISTS garment_type TEXT
  `;
  await client`
    CREATE INDEX IF NOT EXISTS depop_cache_garment_type_idx ON depop_cache(garment_type)
  `;
  await client`
    CREATE INDEX IF NOT EXISTS depop_cache_aesthetic_garment_idx ON depop_cache(aesthetic, garment_type)
  `;

  // pgvector: semantic search on cache query strings
  await client`CREATE EXTENSION IF NOT EXISTS vector`.catch(() => {});
  await client`ALTER TABLE depop_cache ADD COLUMN IF NOT EXISTS embedding vector(1536)`.catch(() => {});
  await client`
    CREATE INDEX IF NOT EXISTS depop_cache_embedding_idx
    ON depop_cache USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
  `.catch(() => {});

  // user_profiles table for personalized For You recommendations
  await client`CREATE EXTENSION IF NOT EXISTS vector`.catch(() => {});
  await client`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id           TEXT PRIMARY KEY,
      taste_vector      vector(1536),
      interaction_count INTEGER DEFAULT 0,
      liked_ids         TEXT[] DEFAULT '{}',
      skipped_ids       TEXT[] DEFAULT '{}',
      onboarded         BOOLEAN DEFAULT FALSE,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `.catch(() => {});

  await client`
    CREATE TABLE IF NOT EXISTS wardrobe_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      image_data TEXT NOT NULL,
      brand TEXT,
      color TEXT,
      aesthetic TEXT,
      source TEXT DEFAULT 'manual',
      added_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS discover_cards (
      id SERIAL PRIMARY KEY,
      image_url TEXT NOT NULL,
      aesthetic TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 80,
      style_breakdown TEXT NOT NULL,
      key_pieces TEXT NOT NULL,
      color_palette TEXT NOT NULL,
      tags TEXT NOT NULL,
      source TEXT DEFAULT 'reddit',
      post_url TEXT,
      subreddit TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Add columns if they don't exist (idempotent migration)
  await client`ALTER TABLE discover_cards ADD COLUMN IF NOT EXISTS post_url TEXT`;
  await client`ALTER TABLE discover_cards ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0`;
  await client`ALTER TABLE discover_cards ADD COLUMN IF NOT EXISTS subreddit TEXT`;

  // Depop search result cache — keyed by query string, TTL 24h (permanent rows never expire)
  await client`
    CREATE TABLE IF NOT EXISTS depop_cache (
      id SERIAL PRIMARY KEY,
      query TEXT NOT NULL UNIQUE,
      listings JSONB NOT NULL,
      aesthetic TEXT,
      permanent BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Safe migration: add permanent column if upgrading existing table
  await client`
    ALTER TABLE depop_cache ADD COLUMN IF NOT EXISTS permanent BOOLEAN NOT NULL DEFAULT FALSE
  `.catch(() => {});
}

export interface IStorage {
  createScan(scan: InsertScan): Promise<Scan>;
  getScans(deviceId?: string): Promise<Scan[]>;
  getScan(id: number): Promise<Scan | undefined>;
  createWardrobeItem(item: InsertWardrobeItem): Promise<WardrobeItem>;
  getWardrobeItems(): Promise<WardrobeItem[]>;
  deleteWardrobeItem(id: number): Promise<void>;
  // Discover
  getDiscoverCards(): Promise<DiscoverCard[]>;
  createDiscoverCard(card: InsertDiscoverCard): Promise<DiscoverCard>;
  discoverCardCount(): Promise<number>;
  clearDiscoverCards(): Promise<void>;
  postUrlExists(postUrl: string): Promise<boolean>;
  incrementCardLikes(id: number): Promise<void>;
  pruneStaleCards(olderThanDays: number): Promise<number>;
  getTrendingCards(limit: number): Promise<DiscoverCard[]>;
}

// ── Depop cache helpers (raw SQL, bypasses Drizzle schema) ──────────────────

// Deduplicate listings by URL — keeps first occurrence
export function dedupeListings(listings: any[]): any[] {
  const seen = new Set<string>();
  return listings.filter(l => {
    const key = l.url || l.product_link || String(l.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─────────────────────────────────────────────
// BRAND NORMALIZER — strips brand names so embeddings
// focus on garment type + color + aesthetic, not brand
// ─────────────────────────────────────────────
const BRAND_WORDS = new Set([
  // Skate brands
  "thrasher","anti hero","antihero","santa cruz","independent","baker","element","real",
  "girl","blind","flip","creature","zero","alien workshop","emerica","osiris","dc shoes",
  "vans","almost","enjoi","spitfire","world industries","huf","alltimers","april","palace",
  "polar","fucking awesome","fa","pass~port","bronze","quasi","paradise",
  // Streetwear / hype
  "supreme","palace","stussy","bape","a bathing ape","off white","off-white","vlone",
  "kith","noah","aime leon dore","ald","cactus plant flea market","cpfm","human made",
  "mastermind","needles","wtaps","neighborhood","undercover","visvim",
  "nike","adidas","jordan","new balance","nb","reebok","puma","champion","fila",
  "carhartt","dickies","wrangler","levis","levi","lee","wrangler",
  // Grunge / band tees
  "nirvana","metallica","black sabbath","led zeppelin","pearl jam","soundgarden",
  "alice in chains","ramones","sex pistols","misfits","black flag","anti flag",
  "motorhead","ozzy","guns n roses","acdc","ac/dc","slayer","pantera","iron maiden",
  "deftones","nine inch nails","marilyn manson","system of a down","tool",
  // Luxury / old money
  "ralph lauren","polo","lacoste","burberry","gucci","prada","louis vuitton","lv",
  "versace","fendi","balenciaga","givenchy","saint laurent","ysl","celine",
  "loro piana","brioni","kiton","isaia","ermenegildo zegna","boglioli",
  // Fast fashion / general
  "zara","h&m","hm","uniqlo","gap","banana republic","j crew","jcrew","mango",
  "topshop","asos","urban outfitters","uo","free people","anthropologie",
  "patagonia","north face","columbia","arc'teryx","arcteryx","canada goose",
  "quiksilver","billabong","volcom","rip curl","o'neill","oneill",
  // Vintage / resale common
  "vintage","y2k","90s","80s","70s","2000s","00s","retro",
]);

export function normalizeForEmbedding(query: string): string {
  const words = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")  // strip punctuation
    .split(/\s+/)
    .filter(w => w.length > 1 && !BRAND_WORDS.has(w));
  // Also strip numeric sizes (xl, m, s, 32, etc.)
  const cleaned = words.filter(w => !/^(xs|s|m|l|xl|xxl|\d+)$/.test(w));
  return cleaned.join(" ").trim() || query.toLowerCase();
}

// ─────────────────────────────────────────────
// EMBEDDING HELPER — calls OpenAI text-embedding-3-small
// ─────────────────────────────────────────────
export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!openaiClient) return null;
  try {
    const normalized = normalizeForEmbedding(text);
    const res = await openaiClient.embeddings.create({
      model: "text-embedding-3-small",
      input: normalized,
      dimensions: 1536,
    });
    return res.data[0].embedding;
  } catch (e) {
    console.error("[embedding] failed:", e);
    return null;
  }
}

// ─────────────────────────────────────────────
// VECTOR CACHE LOOKUP — semantic similarity search
// Finds cached rows whose query string is semantically
// closest to the garment description from Gemini,
// filtered by aesthetic + garment_type first.
// Falls back to getDepopCacheByType if no embeddings available.
// ─────────────────────────────────────────────
export async function getDepopCacheByEmbedding(
  description: string,
  aesthetic: string,
  garmentType: string,
  limit = 8,
  colorHint = ""
): Promise<any[]> {
  // 1. Try vector search first
  if (openaiClient) {
    const embedding = await getEmbedding(description);
    if (embedding) {
      const vectorStr = `[${embedding.join(",")}]`;
      try {
        // Pull top candidates by cosine similarity, filtered by aesthetic + garment_type
        // Fetch 3x limit so we have room to re-rank by color afterward
        const rows = await client<{ listings: any[]; query: string }[]>`
          SELECT listings, query
          FROM depop_cache
          WHERE aesthetic = ${aesthetic}
            AND garment_type = ${garmentType}
            AND embedding IS NOT NULL
            AND (permanent = TRUE OR created_at > NOW() - INTERVAL '24 hours')
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${limit * 3}
        `;

        if (rows.length > 0) {
          // If colorHint has a color word, sort rows so color-matching query keys come first
          // (vector ordering is already good for garment type — we just nudge color rows up)
          const COLOR_KEYWORDS = [
            "black","white","grey","gray","navy","blue","red","green","brown","tan",
            "beige","cream","ivory","khaki","olive","yellow","orange","pink","purple",
            "burgundy","maroon","camel","rust","teal","charcoal","denim",
            "light wash","dark wash","washed","faded",
          ];
          const hintColors = colorHint
            ? COLOR_KEYWORDS.filter(c => colorHint.toLowerCase().includes(c))
            : [];

          let sortedRows = rows as { listings: any[]; query: string }[];
          if (hintColors.length) {
            // Stable-sort: rows whose query contains the color float to front
            // Rows without color match stay in original vector-similarity order
            sortedRows = [
              ...rows.filter(r => hintColors.some(c => r.query.toLowerCase().includes(c))),
              ...rows.filter(r => !hintColors.some(c => r.query.toLowerCase().includes(c))),
            ];
          }

          // Flatten listings preserving sorted order
          const all: any[] = [];
          const seen = new Set<string>();
          for (const row of sortedRows) {
            const listings = Array.isArray(row.listings) ? row.listings : JSON.parse(row.listings as any);
            for (const item of listings) {
              if (!seen.has(item.id)) { seen.add(item.id); all.push(item); }
            }
          }

          if (all.length >= limit) return all.slice(0, limit);
        }
      } catch (e) {
        console.error("[vector search] failed, falling back:", e);
      }
    }
  }

  // 2. Fallback to keyword-based search
  return getDepopCacheByType(aesthetic, garmentType, limit, colorHint || description);
}

export async function getDepopCache(query: string): Promise<any[] | null> {
  const rows = await client`
    SELECT listings, permanent FROM depop_cache
    WHERE query = ${query}
      AND (permanent = TRUE OR created_at > NOW() - INTERVAL '24 hours')
    LIMIT 1
  `;
  if (!rows.length) return null;
  const listings = rows[0].listings as any[];
  // Treat entries with no images as a cache miss so they get re-fetched
  if (listings.every((l: any) => !l.image)) return null;
  return listings;
}

// Same as getDepopCache but only returns results written AFTER a given timestamp.
// Used by depop-ready so it only serves fresh scrape results, never old aesthetic cache.
export async function getDepopCacheSince(query: string, since: Date): Promise<any[] | null> {
  const sinceIso = since instanceof Date ? since.toISOString() : new Date(since).toISOString();
  const rows = await client`
    SELECT listings FROM depop_cache
    WHERE query = ${query}
      AND created_at > ${sinceIso}::timestamptz
    LIMIT 1
  `;
  if (!rows.length) return null;
  const listings = rows[0].listings as any[];
  if (listings.every((l: any) => !l.image)) return null;
  return listings;
}

export async function setDepopCache(query: string, listings: any[], aesthetic?: string, permanent = false, garmentType?: string): Promise<void> {
  const deduped = dedupeListings(listings);

  // Generate embedding for semantic search (best-effort, don't block on failure)
  let embeddingVal: string | null = null;
  try {
    const vec = await getEmbedding(query);
    if (vec) embeddingVal = `[${vec.join(",")}]`;
  } catch (_) {}

  if (embeddingVal) {
    await client`
      INSERT INTO depop_cache (query, listings, aesthetic, permanent, garment_type, embedding, created_at)
      VALUES (${query}, ${JSON.stringify(deduped)}, ${aesthetic ?? null}, ${permanent}, ${garmentType ?? null}, ${embeddingVal}::vector, NOW())
      ON CONFLICT (query) DO UPDATE
        SET listings     = EXCLUDED.listings,
            aesthetic    = COALESCE(EXCLUDED.aesthetic, depop_cache.aesthetic),
            permanent    = EXCLUDED.permanent OR depop_cache.permanent,
            garment_type = COALESCE(EXCLUDED.garment_type, depop_cache.garment_type),
            embedding    = COALESCE(EXCLUDED.embedding, depop_cache.embedding),
            created_at   = NOW()
    `;
  } else {
    await client`
      INSERT INTO depop_cache (query, listings, aesthetic, permanent, garment_type, created_at)
      VALUES (${query}, ${JSON.stringify(deduped)}, ${aesthetic ?? null}, ${permanent}, ${garmentType ?? null}, NOW())
      ON CONFLICT (query) DO UPDATE
        SET listings     = EXCLUDED.listings,
            aesthetic    = COALESCE(EXCLUDED.aesthetic, depop_cache.aesthetic),
            permanent    = EXCLUDED.permanent OR depop_cache.permanent,
            garment_type = COALESCE(EXCLUDED.garment_type, depop_cache.garment_type),
            created_at   = NOW()
    `;
  }
}

// Common color keywords extracted from Depop listing titles
const COLOR_KEYWORDS = [
  "black","white","grey","gray","navy","blue","red","green","brown","tan","beige",
  "cream","ivory","khaki","olive","yellow","orange","pink","purple","burgundy",
  "maroon","camel","rust","teal","mint","lavender","coral","gold","silver",
  "charcoal","denim","light wash","dark wash","washed","faded",
];

function extractColors(query: string): string[] {
  const q = query.toLowerCase();
  return COLOR_KEYWORDS.filter(c => q.includes(c));
}

function scoreByColor(title: string, colors: string[]): number {
  if (!colors.length) return 0;
  const t = title.toLowerCase();
  return colors.filter(c => t.includes(c)).length;
}

// Fetch cached listings by aesthetic + garment_type for smart post-analysis recommendations
export async function getDepopCacheByType(aesthetic: string, garmentType: string, limit = 6, colorHint = ""): Promise<any[]> {
  const colors = extractColors(colorHint);
  const seen = new Set<number>();
  const all: any[] = [];

  function flattenRows(rows: any[]) {
    for (const row of rows) {
      for (const item of (row.listings as any[])) {
        if (!seen.has(item.id)) { seen.add(item.id); all.push(item); }
      }
    }
  }

  // Normalize t-shirt variants in colorHint before keyword matching
  const normalizedHint = colorHint.toLowerCase()
    .replace(/\bt-shirt\b|\btshirt\b/g, "tee")
    .replace(/\bgraphic tee\b/g, "tee")
    .replace(/\bt-shirts\b/g, "tees");

  if (colors.length) {
    // Step 1: fetch rows whose cache query key contains the color word(s)
    // Also filter by garment sub-term if present (e.g. 'jeans' prevents blue skirts showing for jeans query)
    const colorPattern = `%${colors[0]}%`;
    const garmentTerms: Record<string, string[]> = {
      bottoms:   ["jeans","pants","trousers","shorts","skirt","legging","cargo","chino","denim","wide leg"],
      tops:      ["tee","top","hoodie","tank","cami","long sleeve","crop","sweater","blouse"],
      outerwear: ["jacket","coat","blazer","vest","cardigan","puffer","bomber"],
      shoes:     ["boot","sneaker","shoe","loafer","heel","sandal","platform"],
      dresses:   ["dress","gown","romper","slip"],
    };
    const subTerms = (garmentTerms[garmentType] || []).filter(t => normalizedHint.includes(t));
    const subPattern = subTerms.length ? `%${subTerms[0]}%` : null;

    // Try color + garment subterm first for precision, fall back to color-only if too few results
    if (subPattern) {
      const precise = await client`
        SELECT listings FROM depop_cache
        WHERE aesthetic = ${aesthetic}
          AND garment_type = ${garmentType}
          AND query ILIKE ${colorPattern}
          AND query ILIKE ${subPattern}
          AND (permanent = TRUE OR created_at > NOW() - INTERVAL '24 hours')
        ORDER BY RANDOM()
        LIMIT 20
      `;
      flattenRows(precise);
    }
    // Always also fetch color-only rows to fill gaps (deduped by seen set)
    const colorOnly = await client`
      SELECT listings FROM depop_cache
      WHERE aesthetic = ${aesthetic}
        AND garment_type = ${garmentType}
        AND query ILIKE ${colorPattern}
        AND (permanent = TRUE OR created_at > NOW() - INTERVAL '24 hours')
      ORDER BY RANDOM()
      LIMIT 20
    `;
    flattenRows(colorOnly);
  }

  // Step 2: fill remainder — try garment-keyword-filtered first, then pure random
  // This prevents e.g. "flannel" rows from polluting a "graphic tee" tops request
  const needed = Math.max(0, limit * 3 - all.length); // fetch extra for ranking
  if (needed > 0) {
    // Extract the most specific garment keyword from the colorHint (e.g. "tee" from "graphic tee")
    const garmentKeywords: Record<string, string[]> = {
      bottoms:   ["jeans","cargo","chino","trousers","shorts","skirt","legging","pants"],
      tops:      ["tee","hoodie","blouse","tank","cami","sweater","sweatshirt","crop","long sleeve"],
      outerwear: ["jacket","coat","blazer","puffer","bomber","cardigan","vest"],
      shoes:     ["sneaker","boot","loafer","heel","sandal","platform","shoe"],
      dresses:   ["dress","romper","slip","gown"],
    };
    const hint = normalizedHint;
    const kwList = garmentKeywords[garmentType] || [];
    const matchedKw = kwList.find(kw => hint.includes(kw));

    if (matchedKw && all.length < limit) {
      // Try to fill with rows whose query key matches the specific garment keyword
      const kwPattern = `%${matchedKw}%`;
      const kwFill = await client`
        SELECT listings FROM depop_cache
        WHERE aesthetic = ${aesthetic}
          AND garment_type = ${garmentType}
          AND query ILIKE ${kwPattern}
          AND (permanent = TRUE OR created_at > NOW() - INTERVAL '24 hours')
        ORDER BY RANDOM()
        LIMIT ${needed}
      `;
      flattenRows(kwFill);
    }

    // Pure random fill for any remaining gaps
    const stillNeeded = Math.max(0, limit * 3 - all.length);
    if (stillNeeded > 0) {
      const fillRows = await client`
        SELECT listings FROM depop_cache
        WHERE aesthetic = ${aesthetic}
          AND garment_type = ${garmentType}
          AND (permanent = TRUE OR created_at > NOW() - INTERVAL '24 hours')
        ORDER BY RANDOM()
        LIMIT ${stillNeeded}
      `;
      flattenRows(fillRows);
    }
  }

  // Re-score by color (color-matched rows already at front, but re-sort for title matches too)
  if (colors.length) {
    all.sort((a, b) => scoreByColor(b.title || "", colors) - scoreByColor(a.title || "", colors));
  }

  return all.slice(0, limit);
}

export async function getDepopCacheByAesthetic(aesthetic: string, limit = 50): Promise<any[]> {
  // Use RANDOM() so we sample across all 500+ rows, not just the newest ones
  const rowLimit = Math.ceil(limit / 4) + 4;
  const rows = await client`
    SELECT listings FROM depop_cache
    WHERE aesthetic = ${aesthetic}
      AND (permanent = TRUE OR created_at > NOW() - INTERVAL '24 hours')
    ORDER BY RANDOM()
    LIMIT ${rowLimit}
  `;
  // Flatten, shuffle, return limit
  const all: any[] = rows.flatMap((r: any) => r.listings as any[]);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, limit);
}

export const storage: IStorage = {
  async createScan(scan) {
    const [row] = await db.insert(scans).values(scan).returning();
    return row;
  },
  async getScans(deviceId?: string) {
    // Exclude image_data from list queries — full images are only needed in getScan(id).
    // This prevents loading megabytes of base64 into memory on every /api/scans call.
    const cols = {
      id: scans.id,
      deviceId: scans.deviceId,
      aesthetic: scans.aesthetic,
      confidence: scans.confidence,
      styleBreakdown: scans.styleBreakdown,
      occasions: scans.occasions,
      keyPieces: scans.keyPieces,
      depopQueries: scans.depopQueries,
      colorPalette: scans.colorPalette,
      results: scans.results,
      createdAt: scans.createdAt,
    };
    if (deviceId) {
      return db.select(cols).from(scans).where(eq(scans.deviceId, deviceId)).orderBy(desc(scans.id));
    }
    return db.select(cols).from(scans).orderBy(desc(scans.id));
  },
  async getScan(id) {
    const [row] = await db.select().from(scans).where(eq(scans.id, id));
    return row;
  },
  async createWardrobeItem(item) {
    const [row] = await db.insert(wardrobeItems).values(item).returning();
    return row;
  },
  async getWardrobeItems() {
    return db.select().from(wardrobeItems).orderBy(desc(wardrobeItems.id));
  },
  async deleteWardrobeItem(id) {
    await db.delete(wardrobeItems).where(eq(wardrobeItems.id, id));
  },
  async getDiscoverCards() {
    return db.select().from(discoverCards).orderBy(desc(discoverCards.id));
  },
  async createDiscoverCard(card) {
    const [row] = await db.insert(discoverCards).values(card).returning();
    return row;
  },
  async discoverCardCount() {
    const rows = await db.select().from(discoverCards);
    return rows.length;
  },
  async clearDiscoverCards() {
    await db.delete(discoverCards);
  },
  async postUrlExists(postUrl: string) {
    const rows = await db.select({ id: discoverCards.id })
      .from(discoverCards)
      .where(eq(discoverCards.postUrl, postUrl))
      .limit(1);
    return rows.length > 0;
  },
  async incrementCardLikes(id: number) {
    await db
      .update(discoverCards)
      .set({ likesCount: sql`${discoverCards.likesCount} + 1` })
      .where(eq(discoverCards.id, id));
  },
  async pruneStaleCards(olderThanDays: number) {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(discoverCards)
      .where(
        and(
          lt(discoverCards.createdAt, cutoff),
          eq(discoverCards.likesCount, 0)
        )
      )
      .returning({ id: discoverCards.id });
    return deleted.length;
  },
  async getTrendingCards(limit: number) {
    return db
      .select()
      .from(discoverCards)
      .orderBy(desc(discoverCards.likesCount), desc(discoverCards.createdAt))
      .limit(limit);
  },
};

// ─────────────────────────────────────────────
// USER PROFILE / TASTE VECTOR FUNCTIONS
// ─────────────────────────────────────────────

/** Fetch a user's taste vector and metadata */
export async function getUserProfile(userId: string) {
  const rows = await client<{
    user_id: string;
    taste_vector: string | null;
    interaction_count: number;
    liked_ids: string[];
    skipped_ids: string[];
    onboarded: boolean;
  }[]>`
    SELECT user_id, taste_vector::text, interaction_count, liked_ids, skipped_ids, onboarded
    FROM user_profiles WHERE user_id = ${userId}
  `;
  return rows[0] ?? null;
}

/** Create or update a user profile with a new taste vector */
export async function upsertUserProfile(
  userId: string,
  tasteVector: number[],
  interactionDelta = 0,
  likedId?: string,
  skippedId?: string,
  onboarded?: boolean
) {
  const vecStr = `[${tasteVector.join(",")}]`;

  // Check if profile exists first (avoids complex INSERT type inference issues)
  const existing = await client`SELECT user_id FROM user_profiles WHERE user_id = ${userId}`;

  if (!existing.length) {
    // Fresh insert
    await client`
      INSERT INTO user_profiles (user_id, taste_vector, interaction_count, liked_ids, skipped_ids, onboarded, created_at, updated_at)
      VALUES (
        ${userId},
        ${vecStr}::vector,
        ${interactionDelta},
        ARRAY[]::text[],
        ARRAY[]::text[],
        ${onboarded ?? false},
        NOW(), NOW()
      )
    `;
  } else {
    // Update existing
    await client`
      UPDATE user_profiles SET
        taste_vector      = ${vecStr}::vector,
        interaction_count = interaction_count + ${interactionDelta},
        onboarded         = CASE WHEN ${onboarded ?? null}::boolean IS NOT NULL THEN ${onboarded ?? false} ELSE onboarded END,
        updated_at        = NOW()
      WHERE user_id = ${userId}
    `;
  }

  // Append liked/skipped IDs separately to avoid array type inference issues
  if (likedId) {
    await client`UPDATE user_profiles SET liked_ids = array_append(liked_ids, ${likedId}) WHERE user_id = ${userId}`;
  }
  if (skippedId) {
    await client`UPDATE user_profiles SET skipped_ids = array_append(skipped_ids, ${skippedId}) WHERE user_id = ${userId}`;
  }
}

/**
 * Get personalized For You recommendations for a user.
 * Finds depop_cache items whose embeddings are closest to the user's taste vector.
 * Excludes already-liked and skipped items.
 */
export async function getForYouRecommendations(
  userId: string,
  limit = 20,
  offset = 0
): Promise<{ items: any[]; hasMore: boolean }> {
  const profile = await getUserProfile(userId);
  if (!profile || !profile.taste_vector) {
    return { items: [], hasMore: false };
  }

  const excluded = [
    ...(profile.liked_ids || []),
    ...(profile.skipped_ids || []),
  ];

  // Cosine similarity across ALL aesthetics/types — pure taste-based
  const rows = await client<{ listings: any[]; query: string; aesthetic: string }[]>`
    SELECT listings, query, aesthetic
    FROM depop_cache
    WHERE embedding IS NOT NULL
      AND permanent = TRUE
      AND (${excluded.length} = 0 OR query != ALL(${excluded}::text[]))
    ORDER BY embedding <=> ${profile.taste_vector}::vector
    LIMIT ${limit * 3}
    OFFSET ${offset}
  `;

  // Flatten + dedupe
  const all: any[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const listings = Array.isArray(row.listings) ? row.listings : JSON.parse(row.listings as any);
    for (const item of listings) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        all.push({ ...item, _aesthetic: row.aesthetic });
      }
    }
  }

  return { items: all.slice(0, limit), hasMore: all.length > limit };
}

/**
 * Average a batch of existing embeddings from cache rows matching given aesthetics.
 * Used to seed a user's taste vector from onboarding picks.
 */
export async function getAverageEmbeddingForAesthetics(aesthetics: string[]): Promise<number[] | null> {
  if (!aesthetics.length) return null;

  // Sample up to 50 rows per aesthetic for the average
  const rows = await client<{ embedding: string }[]>`
    SELECT embedding::text FROM depop_cache
    WHERE aesthetic = ANY(${aesthetics}::text[])
      AND embedding IS NOT NULL
      AND permanent = TRUE
    ORDER BY RANDOM()
    LIMIT ${aesthetics.length * 50}
  `;

  if (!rows.length) return null;

  const dim = 1536;
  const avg = new Array(dim).fill(0);
  for (const row of rows) {
    // Parse "[0.1,0.2,...]" format
    const nums = row.embedding.slice(1, -1).split(",").map(Number);
    for (let i = 0; i < dim; i++) avg[i] += nums[i];
  }
  const n = rows.length;
  return avg.map(v => v / n);
}
