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

export async function setDepopCache(query: string, listings: any[], aesthetic?: string, permanent = false): Promise<void> {
  const deduped = dedupeListings(listings);
  await client`
    INSERT INTO depop_cache (query, listings, aesthetic, permanent, created_at)
    VALUES (${query}, ${JSON.stringify(deduped)}, ${aesthetic ?? null}, ${permanent}, NOW())
    ON CONFLICT (query) DO UPDATE
      SET listings   = EXCLUDED.listings,
          aesthetic  = COALESCE(EXCLUDED.aesthetic, depop_cache.aesthetic),
          permanent  = EXCLUDED.permanent OR depop_cache.permanent,
          created_at = NOW()
  `;
}

export async function getDepopCacheByAesthetic(aesthetic: string, limit = 50): Promise<any[]> {
  // Fetch enough rows to cover the requested limit (each row has ~6 listings)
  const rowLimit = Math.ceil(limit / 4) + 2;
  const rows = await client`
    SELECT listings FROM depop_cache
    WHERE aesthetic = ${aesthetic}
      AND (permanent = TRUE OR created_at > NOW() - INTERVAL '24 hours')
    ORDER BY created_at DESC
    LIMIT ${rowLimit}
  `;
  // Flatten all cached listings for this aesthetic, shuffle, return limit
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
    if (deviceId) {
      return db.select().from(scans).where(eq(scans.deviceId, deviceId)).orderBy(desc(scans.id));
    }
    return db.select().from(scans).orderBy(desc(scans.id));
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
