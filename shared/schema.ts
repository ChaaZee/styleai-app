import { pgTable, text, integer, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Scans — each outfit analysis
export const scans = pgTable("scans", {
  id: serial("id").primaryKey(),
  imageData: text("image_data").notNull(),
  aesthetic: text("aesthetic").notNull(),
  confidence: integer("confidence").notNull(),
  styleBreakdown: text("style_breakdown").notNull(), // JSON string
  occasions: text("occasions").notNull(),             // JSON string
  keyPieces: text("key_pieces").notNull(),            // JSON string
  colorPalette: text("color_palette").notNull(),      // JSON string
  results: text("results").notNull(),                 // JSON string
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertScanSchema = createInsertSchema(scans).omit({
  id: true,
  createdAt: true,
});

export type InsertScan = z.infer<typeof insertScanSchema>;
export type Scan = typeof scans.$inferSelect;

// Wardrobe items
export const wardrobeItems = pgTable("wardrobe_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  imageData: text("image_data").notNull(),
  brand: text("brand"),
  color: text("color"),
  aesthetic: text("aesthetic"),
  source: text("source").default("manual"),
  addedAt: timestamp("added_at").defaultNow(),
});

export const insertWardrobeItemSchema = createInsertSchema(wardrobeItems).omit({
  id: true,
  addedAt: true,
});

export type InsertWardrobeItem = z.infer<typeof insertWardrobeItemSchema>;
export type WardrobeItem = typeof wardrobeItems.$inferSelect;
