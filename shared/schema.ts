import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Scans — each outfit analysis
export const scans = sqliteTable("scans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  imageData: text("image_data").notNull(), // base64 data URL
  aesthetic: text("aesthetic").notNull(),   // e.g. "Clean Minimal"
  confidence: integer("confidence").notNull(), // 0-100
  styleBreakdown: text("style_breakdown").notNull(), // JSON: [{label, score}]
  occasions: text("occasions").notNull(),   // JSON: string[]
  keyPieces: text("key_pieces").notNull(),  // JSON: string[]
  colorPalette: text("color_palette").notNull(), // JSON: string[]
  results: text("results").notNull(),       // JSON: ProductResult[]
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const insertScanSchema = createInsertSchema(scans).omit({
  id: true,
  createdAt: true,
});

export type InsertScan = z.infer<typeof insertScanSchema>;
export type Scan = typeof scans.$inferSelect;

// Wardrobe items
export const wardrobeItems = sqliteTable("wardrobe_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull(), // tops, bottoms, shoes, outerwear, accessories
  imageData: text("image_data").notNull(),
  brand: text("brand"),
  color: text("color"),
  aesthetic: text("aesthetic"),
  source: text("source").default("manual"), // manual, purchase, scan
  addedAt: integer("added_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const insertWardrobeItemSchema = createInsertSchema(wardrobeItems).omit({
  id: true,
  addedAt: true,
});

export type InsertWardrobeItem = z.infer<typeof insertWardrobeItemSchema>;
export type WardrobeItem = typeof wardrobeItems.$inferSelect;
