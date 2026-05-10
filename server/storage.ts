import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, and, lt, sql } from "drizzle-orm";
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

  if (colors.length) {
    // Step 1: fetch rows whose cache query key contains the color word(s)
    // Also filter by garment sub-term if present (e.g. 'jeans' prevents blue skirts showing for jeans query)
    const colorPattern = `%${colors[0]}%`;
    // Normalize t-shirt variants in colorHint before keyword matching
    const normalizedHint = colorHint.toLowerCase()
      .replace(/\bt-shirt\b|\btshirt\b/g, "tee")
      .replace(/\bgraphic tee\b/g, "tee")
      .replace(/\bt-shirts\b/g, "tees");
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
