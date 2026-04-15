import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";
import { scans, wardrobeItems, type Scan, type InsertScan, type WardrobeItem, type InsertWardrobeItem } from "@shared/schema";

const sqlite = new Database("styleai.db");
const db = drizzle(sqlite);

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_data TEXT NOT NULL,
    aesthetic TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    style_breakdown TEXT NOT NULL,
    occasions TEXT NOT NULL,
    key_pieces TEXT NOT NULL,
    color_palette TEXT NOT NULL,
    results TEXT NOT NULL,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS wardrobe_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    image_data TEXT NOT NULL,
    brand TEXT,
    color TEXT,
    aesthetic TEXT,
    source TEXT DEFAULT 'manual',
    added_at INTEGER
  );
`);

export interface IStorage {
  createScan(scan: InsertScan): Scan;
  getScans(): Scan[];
  getScan(id: number): Scan | undefined;
  createWardrobeItem(item: InsertWardrobeItem): WardrobeItem;
  getWardrobeItems(): WardrobeItem[];
  deleteWardrobeItem(id: number): void;
}

export const storage: IStorage = {
  createScan(scan) {
    return db.insert(scans).values(scan).returning().get();
  },
  getScans() {
    return db.select().from(scans).orderBy(desc(scans.id)).all();
  },
  getScan(id) {
    return db.select().from(scans).where(eq(scans.id, id)).get();
  },
  createWardrobeItem(item) {
    return db.insert(wardrobeItems).values(item).returning().get();
  },
  getWardrobeItems() {
    return db.select().from(wardrobeItems).orderBy(desc(wardrobeItems.id)).all();
  },
  deleteWardrobeItem(id) {
    db.delete(wardrobeItems).where(eq(wardrobeItems.id, id)).run();
  },
};
