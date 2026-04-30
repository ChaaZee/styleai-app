import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc } from "drizzle-orm";
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
  await client`ALTER TABLE discover_cards ADD COLUMN IF NOT EXISTS subreddit TEXT`;
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
};
