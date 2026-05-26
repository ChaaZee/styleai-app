// ─────────────────────────────────────────────────────────────────────────────
// storage.ts — Database layer for StyleAI.
//
// Mental model for a Python dev:
//   - `drizzle` is a typed query-builder ORM, similar in spirit to SQLAlchemy
//     Core. We use it for the simpler CRUD on scans / wardrobe / discover_cards.
//   - `postgres` (the npm package, exposed here as `client`) is the underlying
//     async driver — analogous to `psycopg2` or `asyncpg`. `client\`...\``
//     is a tagged template literal: parameters inside `${}` are sent as bind
//     parameters, not string interpolation, so they're safe from SQL injection.
//     It's the JS equivalent of `await conn.execute("SELECT ... %s", (val,))`.
//   - We use raw SQL via `client\`...\`` instead of Drizzle ORM for the
//     `depop_cache` table because:
//       (a) we need pgvector ops (`embedding <=> $1::vector`) which Drizzle
//           doesn't have first-class support for, and
//       (b) we hit a postgres.js bug where JSONB array parameters wouldn't
//           serialize on some Render/Node environments — raw SQL with
//           `JSON.stringify(...)` sidesteps that entirely.
//
// Major sections in this file:
//   1. DB client setup + initDB() (runs CREATE TABLE IF NOT EXISTS at boot).
//   2. Depop cache helpers (raw SQL).
//   3. OpenAI embedding helper + vector cache lookups.
//   4. Drizzle-based storage object for scans / wardrobe / discover_cards.
//   5. User profile / taste vector helpers (cosine similarity over pgvector).
//   6. Gender filtering (regex-based) + aesthetic remapping.
//   7. Discover / Wardrobe / History recommendation helpers.
// ─────────────────────────────────────────────────────────────────────────────

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, and, lt, sql } from "drizzle-orm";
import OpenAI from "openai";

// Optional OpenAI client — only used to generate text embeddings for vector
// search. If the env var is missing we silently skip embedding and fall back
// to keyword-based cache lookups elsewhere. Like `openai_client = None`
// in Python with a guard before every call.
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

// Connection pool. `max: 10` is the pool size (like psycopg2 ThreadedConnectionPool).
// `ssl` follows Render/Heroku conventions — production needs TLS but we don't
// validate the cert (their certs are self-signed at the connection level).
const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
  // prepare: false disables named prepared statements and uses the Simple Query Protocol.
  // This avoids a postgres.js bug where ParameterDescription overrides our parameter type
  // with the column's OID (e.g. 3802 for jsonb), and the jsonb serializer (OID 3802) is
  // missing from options.serializers on some Render/Node environments — causing the
  // 'Received an instance of Array' TypeError in Bind() for JSONB array parameters.
  prepare: false,
});
// `db` is the Drizzle ORM wrapper around the raw `client`. Use `db` for typed
// queries (`db.select().from(scans)`) and `client` for raw tagged templates.
const db = drizzle(client);

// Create tables if they don't exist. Idempotent — safe to call on every boot.
// Each subsequent ALTER TABLE ADD COLUMN IF NOT EXISTS acts as a tiny inline
// migration: older deployments that pre-date these columns get them on next boot.
// Roughly equivalent to running Alembic's `upgrade --autogenerate` in Python,
// except hand-rolled.
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

  // pgvector: semantic search on cache query strings.
  // `vector(1536)` matches the OpenAI text-embedding-3-small output dimension.
  // The ivfflat index with cosine ops makes `embedding <=> query::vector`
  // (cosine distance) fast at scale; `lists = 100` is a tuning knob —
  // higher = faster queries but slower writes. Catches are because the
  // pgvector extension may not be installed on local dev databases.
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
  await client`ALTER TABLE discover_cards ADD COLUMN IF NOT EXISTS embedding vector(1536)`.catch(() => {});
  await client`ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS embedding vector(1536)`.catch(() => {});

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

  // scanned_pieces — every clothing piece seen in a real scan, deduplicated by piece+aesthetic
  // Used by seed-trending to know what real users are wearing on Depop
  await client`
    CREATE TABLE IF NOT EXISTS scanned_pieces (
      piece        TEXT NOT NULL,
      aesthetic    TEXT NOT NULL,
      garment_type TEXT,
      scan_count   INTEGER NOT NULL DEFAULT 1,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (piece, aesthetic)
    )
  `;
}

export interface IStorage {
  createScan(scan: InsertScan): Promise<Scan>;
  getScans(deviceId?: string): Promise<Scan[]>;
  getScan(id: number): Promise<Scan | undefined>;
  deleteScan(id: number): Promise<void>;
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
// We use raw SQL (the `client\`...\`` tagged-template syntax) instead of
// Drizzle for this table because Drizzle doesn't ship first-class pgvector
// support, AND because of the postgres.js JSONB-array serializer bug noted
// at the top of this file. Raw SQL with stringified JSON dodges both issues.

// Deduplicate listings by URL — keeps first occurrence.
// Same idea as `seen = set(); [x for x in xs if (k := key(x)) not in seen and not seen.add(k)]`
// in modern Python, just spelled differently.
export function dedupeListings(listings: any[]): any[] {
  const seen = new Set<string>();
  return listings.filter(l => {
    const key = l.url || l.product_link || String(l.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Scanned pieces tracking ─────────────────────────────────────────────────
// Records every clothing piece detected in a user scan, deduped by (piece, aesthetic).
// Used by the seed-trending pipeline so the Depop cache is biased toward what
// real users actually wear. The `garmentTypes` map is optional metadata for
// each piece → "tops" | "bottoms" | "shoes" etc.
//
// SECURITY NOTE: this function uses `client.unsafe(...)` (raw string SQL,
// no bind params) with manual single-quote escaping. The reason is the same
// JSONB-bind bug as elsewhere. Inputs here come from our own server code
// (Gemini output we already control), never from raw user input, so SQL
// injection isn't a realistic concern — but if you ever wire this up to a
// user-supplied string, switch back to `client\`...\`` template parameters.
export async function upsertScannedPieces(
  pieces: string[],
  aesthetic: string,
  garmentTypes: Record<string, string> = {}, // piece → garmentType, optional
): Promise<void> {
  if (!pieces.length) return;
  for (const piece of pieces) {
    const pieceSafe     = piece.replace(/'/g, "''");
    const aestheticSafe = aesthetic.replace(/'/g, "''");
    const gt            = (garmentTypes[piece] || null);
    const gtVal         = gt ? `'${gt.replace(/'/g, "''")}'` : "NULL";
    await client.unsafe(`
      INSERT INTO scanned_pieces (piece, aesthetic, garment_type, scan_count, last_seen_at)
      VALUES ('${pieceSafe}', '${aestheticSafe}', ${gtVal}, 1, NOW())
      ON CONFLICT (piece, aesthetic)
      DO UPDATE SET
        scan_count   = scanned_pieces.scan_count + 1,
        garment_type = COALESCE(EXCLUDED.garment_type, scanned_pieces.garment_type),
        last_seen_at = NOW()
    `);
  }
}

// Return the most-scanned pieces, ordered by scan_count DESC.
// Returns a list of typed dicts (TypeScript objects) — like a Python list
// of dataclass instances. The DB columns use snake_case; we map to camelCase
// here at the boundary.
export async function getScannedPieces(limit = 200): Promise<{ piece: string; aesthetic: string; garmentType: string | null; scanCount: number }[]> {
  const rows = await client`
    SELECT piece, aesthetic, garment_type, scan_count
    FROM scanned_pieces
    ORDER BY scan_count DESC
    LIMIT ${limit}
  `;
  return rows.map(r => ({
    piece:       r.piece,
    aesthetic:   r.aesthetic,
    garmentType: r.garment_type ?? null,
    scanCount:   r.scan_count,
  }));
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

// Strip brand names and sizes from `query` so the resulting embedding is
// dominated by garment type + color + aesthetic. Without this, two queries
// for the same item ("nike air force 1" vs "supreme air force 1") would
// embed very differently because the brand word dwarfs the garment word.
//
// Pipeline (chained like Python's `.lower().replace(...).split()`):
//   1. lowercase + replace anything non-alphanumeric with a space
//   2. split on whitespace into tokens
//   3. drop single-character tokens and any token in BRAND_WORDS
//   4. drop size tokens (xs/s/m/l/xl/xxl/<digits>)
//   5. rejoin; fall back to original lowercased query if everything got stripped
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
// Returns a 1536-dim float vector for the input text, or null if anything
// goes wrong (no API key, network error, etc.). All callers handle null by
// falling back to keyword search. Equivalent to:
//   openai.embeddings.create(model="text-embedding-3-small", input=text)
//                          .data[0].embedding
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
//
// Algorithm:
//   1. Embed `description` via OpenAI -> a 1536-dim vector.
//   2. Run `ORDER BY embedding <=> $1::vector` — the `<=>` operator is
//      pgvector's cosine distance. Smaller = more similar.
//   3. Re-rank to push rows whose query string contains a colorHint word
//      to the front (vector similarity gets the garment type right; this
//      nudge gets the color right).
//   4. Flatten and dedupe the resulting listings.
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

// Exact-query cache lookup. Returns null on miss (or stale, or imageless rows).
// The `permanent = TRUE OR created_at > NOW() - INTERVAL '24 hours'` clause
// gives us two cache tiers:
//   - permanent rows (seed-trending) never expire
//   - one-off scrape results expire after 24h so the cache stays fresh
//
// The `client\`...\`` tagged-template form turns `${query}` into a bind
// parameter ($1), like psycopg2's `cur.execute("WHERE query = %s", (q,))`.
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

// Upsert a depop_cache row.
// Steps:
//   1. Tag each listing with a `_gender` field via tagListingGender.
//   2. Dedupe by URL.
//   3. (Best effort) compute an OpenAI embedding for the query string.
//   4. INSERT ... ON CONFLICT (query) DO UPDATE — upsert with a merge:
//      - `permanent OR existing permanent` (sticky once permanent)
//      - `COALESCE(new, old)` for aesthetic/garment_type/embedding so we
//        never lose existing metadata when re-scraping.
// Behaves like Python:
//   with conn.cursor() as cur:
//       cur.execute("INSERT INTO ... ON CONFLICT (query) DO UPDATE ...")
export async function setDepopCache(query: string, listings: any[], aesthetic?: string, permanent = false, garmentType?: string): Promise<void> {
  const tagged = listings.map(tagListingGender);
  const deduped = dedupeListings(tagged);

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

// Fetch cached listings by aesthetic + garment_type for smart post-analysis recommendations.
// Pure keyword/ILIKE-based — used as a fallback when getDepopCacheByEmbedding
// can't run (no OpenAI key) or returns too few results.
//
// Strategy (gets progressively looser):
//   Step 1: rows whose query key contains the color AND a garment subterm
//           (e.g. color="blue" + "jeans" specifically — avoids blue skirts).
//   Step 2: rows whose query key contains the color only.
//   Step 3: rows matching the specific garment keyword (e.g. "tee" or "jeans").
//   Step 4: pure random fill within the aesthetic+garment_type.
// Final pass re-sorts the merged pool by how many color words appear in
// each listing's title, so the best color matches float to the top.
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

// Random sample of listings across the whole aesthetic. Used for the home feed
// when we want variety, not personalization. `ORDER BY RANDOM()` is the
// equivalent of Python's `random.sample(...)` but done in SQL so we don't
// have to pull 500 rows just to pick 50. The final Fisher–Yates shuffle is
// in JS to mix the order across cache rows.
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
  // Flatten, dedup by URL (same item can appear in multiple cache rows), shuffle, return limit
  const seen = new Set<string>();
  const all: any[] = rows.flatMap((r: any) => r.listings as any[]).filter((l: any) => {
    const key = l.url || l.product_link || (l.image ? l.image.split('?')[0] : '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, limit);
}

// ─────────────────────────────────────────────
// `storage` object: typed Drizzle-based CRUD for scans / wardrobe /
// discover_cards. Think of it as a Python class with methods, except
// expressed as a single object literal. Each method maps to one SQL
// operation behind the scenes.
// ─────────────────────────────────────────────
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
  async deleteScan(id) {
    await db.delete(scans).where(eq(scans.id, id));
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
  // Atomic SQL increment: `UPDATE discover_cards SET likes_count = likes_count + 1`.
  // `sql\`${col} + 1\`` is Drizzle's escape hatch into raw SQL fragments —
  // similar to SQLAlchemy's `column.op('+')(1)` or `func.x + 1`.
  async incrementCardLikes(id: number) {
    await db
      .update(discoverCards)
      .set({ likesCount: sql`${discoverCards.likesCount} + 1` })
      .where(eq(discoverCards.id, id));
  },
  // Daily-refresh maintenance: drop discover cards older than N days that
  // have zero likes. Returns how many we deleted. `Date.now()` returns the
  // current epoch in ms (Python: `int(time.time() * 1000)`).
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
// The "taste vector" is a 1536-dim float vector that represents what a user
// likes. It starts as the average of embeddings from their onboarding
// aesthetic picks, then evolves via a weighted running average each time
// they like/save/skip an item (see routes.ts /api/interact). Recommendations
// are then nearest-neighbour lookups via pgvector's `<=>` cosine distance.

/** Fetch a user's taste vector and metadata.
 *  Note: we explicitly `taste_vector::text` so the driver gives us the raw
 *  "[0.1,0.2,...]" string format. We parse it on demand instead of letting
 *  pgvector serialize it (saves a round trip and avoids OID weirdness). */
export async function getUserProfile(userId: string) {
  const rows = await client<{
    user_id: string;
    taste_vector: string | null;
    interaction_count: number;
    liked_ids: string[];
    skipped_ids: string[];
    onboarded: boolean;
  }[]>`
    SELECT user_id, taste_vector::text, interaction_count, liked_ids, skipped_ids, onboarded, gender
    FROM user_profiles WHERE user_id = ${userId}
  `;
  return rows[0] ?? null;
}

/** Create or update a user profile with a new taste vector.
 *  Split into "INSERT if missing, UPDATE if exists" because postgres.js's
 *  type inference choked on the combined ON CONFLICT path when vector +
 *  text[] columns were involved. Liked/skipped IDs are appended in
 *  separate small UPDATEs for the same reason. */
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

/** Append a full liked item object to the liked_items JSONB array.
 *
 *  Why the convoluted two-step "fetch JSON, merge in JS, write back as
 *  inline SQL literal" pattern?
 *    - The natural shape would be `liked_items = liked_items || $1::jsonb`
 *      to append, then we'd bind `$1` as JSONB.
 *    - That hits the postgres.js JSONB-OID bug on Render/Node where the
 *      driver omits the JSONB serializer and throws "Received an instance
 *      of Array".
 *    - So we read the existing array, dedupe in JS, JSON.stringify the
 *      result, and embed it directly into the SQL string via `client.unsafe`.
 *    - We escape single quotes in the JSON literal AND in userId to keep
 *      the inline SQL safe. Inputs come from our own server code, never
 *      from raw user input. */
export async function appendLikedItem(userId: string, item: {
  id: string;
  title: string;
  image?: string;
  url?: string;
  price?: number;
  brand?: string;
  _aesthetic?: string;
  likedAt: string;
}) {
  // Use url as stable dedup key (id is just a sequential index, not unique across sessions)
  const dedupKey = item.url || item.id;

  // Two-step: fetch current array, merge in JS, write back as inline SQL literal.
  // We embed the JSON directly in the query string to bypass ALL postgres.js parameter-
  // binding issues (prepared-statement type override, missing JSONB OID serializer on Render).
  // Safe: items come from our own server code, never from untrusted user input.
  const rows = await client`SELECT liked_items FROM user_profiles WHERE user_id = ${userId}`;
  const existing: any[] = Array.isArray(rows[0]?.liked_items) ? rows[0].liked_items : [];
  const normalized = existing.map((el: any) => (typeof el === "string" ? JSON.parse(el) : el));
  const deduped = normalized.filter((el: any) => el?.url !== dedupKey && el?.id !== dedupKey);
  const newItems = [item, ...deduped];
  const jsonLiteral = JSON.stringify(newItems).replace(/'/g, "''");
  const userIdSafe  = userId.replace(/'/g, "''");

  if (rows.length > 0) {
    // Row exists — just update liked_items
    await client.unsafe(`UPDATE user_profiles SET liked_items = '${jsonLiteral}'::jsonb WHERE user_id = '${userIdSafe}'`);
  } else {
    // Row doesn't exist yet (first interaction fires before upsertUserProfile creates it).
    // Insert a minimal stub row so the liked item isn't lost.
    // upsertUserProfile runs immediately after and will fill in taste_vector properly.
    const zeroVec = `[${new Array(1536).fill('0').join(',')}]`;
    await client.unsafe(`
      INSERT INTO user_profiles (user_id, taste_vector, interaction_count, liked_ids, skipped_ids, onboarded, liked_items, gender, created_at, updated_at)
      VALUES ('${userIdSafe}', '${zeroVec}'::vector, 0, ARRAY[]::text[], ARRAY[]::text[], false, '${jsonLiteral}'::jsonb, 'both', NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET liked_items = '${jsonLiteral}'::jsonb
    `);
  }
}

/** Remove a single liked item by its id or url dedup key.
 *  Same fetch-merge-write pattern as appendLikedItem, for the same JSONB
 *  serializer-bug reason. */
export async function removeLikedItem(userId: string, itemKey: string) {
  const rows = await client`SELECT liked_items FROM user_profiles WHERE user_id = ${userId}`;
  const existing: any[] = Array.isArray(rows[0]?.liked_items) ? rows[0].liked_items : [];
  const newItems = existing
    .map((el: any) => (typeof el === "string" ? JSON.parse(el) : el))
    .filter((el: any) => el?.url !== itemKey && el?.id !== itemKey);
  const jsonLiteral = JSON.stringify(newItems).replace(/'/g, "''");
  const userIdSafe  = userId.replace(/'/g, "''");
  await client.unsafe(`UPDATE user_profiles SET liked_items = '${jsonLiteral}'::jsonb WHERE user_id = '${userIdSafe}'`);
}

/** Fetch all liked items for a user, newest first.
 *  Newest-first is enforced at write time in appendLikedItem (we prepend).
 *  The `el is string ? JSON.parse(el) : el` step is defensive: a previous
 *  double-serialization bug stored some entries as JSON strings instead of
 *  objects; this normalises them on read. */
export async function getLikedItems(userId: string): Promise<any[]> {
  const rows = await client`
    SELECT liked_items FROM user_profiles WHERE user_id = ${userId}
  `;
  if (!rows.length) return [];
  const items = rows[0].liked_items;
  if (!Array.isArray(items)) return [];
  // Normalise: legacy rows may be stored as JSON strings due to old double-serialization bug
  return items.map((el: any) => (typeof el === "string" ? JSON.parse(el) : el));
}

// ── Gender-gated aesthetics ──────────────────────────────────────────────────
// `Set` in JS is the same as Python's `set` — O(1) `has` lookup.
// Aesthetics that should never appear for male users (these are inherently
// femme-coded styles; a male user picking them is likely an onboarding mistake).
export const FEMALE_ONLY_AESTHETICS = new Set([
  "Coquette", "Soft Girl", "Cottagecore", "Coastal Grandmother", "E-Girl",
  "Clean Girl", "Balletcore", "Romantic", "Fairycore",
]);
// Remap: if Gemini returns a female-only aesthetic for a male user, use this
// instead. Picked by hand for "closest masculine equivalent" — e.g. Clean
// Girl → Minimalist, Coquette → Old Money, E-Girl → Grunge.
// Equivalent to a Python `Dict[str, str]`.
export const MALE_AESTHETIC_REMAP: Record<string, string> = {
  "Clean Girl":          "Minimalist",
  "Coquette":            "Old Money",
  "Soft Girl":           "Preppy",
  "Soft Girl / Kawaii":  "Preppy",
  "Cottagecore":         "Boho",
  "E-Girl":              "Grunge",
  "E-Girl / Alt":        "Grunge",
  "Coastal Grandmother": "Minimalist",
  "Balletcore":          "Minimalist",
  "Romantic":            "Vintage",
  "Fairycore":           "Boho",
};

export function remapAestheticForGender(aesthetic: string, gender: string): string {
  if (gender !== "male") return aesthetic;
  return MALE_AESTHETIC_REMAP[aesthetic] ?? aesthetic;
}

// Gender detection: only look at explicit gender words in the title.
// If the title says "women" or "men", tag it. Otherwise it's "both".
// No brand signals, no garment-type inference — Depop always states the gender in the title when it's gendered.
// Matches "women", "womens", "women's", "women's", "woman", etc.
// The apostrophe acts as a word boundary so \bwomen\b already catches "Women's",
// but we also add explicit apostrophe forms to be airtight.
//
// Regex breakdown:
//   \b          word boundary
//   women       literal
//   [''’]?      optional apostrophe (straight ASCII or two flavours of curly)
//   s?          optional plural / possessive 's'
//   |woman|...  alternations for each variant spelling
//   /i          case-insensitive
// In Python this would be: re.compile(r"\b(...)\b", re.IGNORECASE)
const EXPLICIT_FEMALE = /\b(women[''’]?s?|woman|womans|womena|ladies|lady|girls?|female|womenswear)\b/i;
const EXPLICIT_MALE   = /\b(men[''’]?s?|man|male|boys?|menswear)\b/i;
// Keep these exported so retag script and client code still compile, but they are no longer used for filtering
export const FEMALE_TITLE_SIGNALS = EXPLICIT_FEMALE;
export const MALE_TITLE_SIGNALS   = EXPLICIT_MALE;

/**
 * Extract all searchable text from a listing.
 * Combines the stored title with words extracted from the URL slug —
 * the slug always contains the full product name including gender keywords
 * that get cut off from the 80-char title field.
 * e.g. slug "username-hot-topic-womens-black-hoodie-ab12" → "hot topic womens black hoodie"
 */
function listingText(listing: any): string {
  const title = listing.title || listing.name || "";
  const url: string = listing.url || "";
  const slugMatch = url.match(/\/products\/([^/?#]+)/i);
  const slugWords = slugMatch ? slugMatch[1].replace(/-/g, " ") : "";
  return `${title} ${slugWords}`;
}

/**
 * Tag a listing object with a _gender field: "male" | "female" | "both"
 * based on title + URL slug signals. Mutates and returns the listing.
 */
export function tagListingGender(listing: any): any {
  const text = listingText(listing);
  // Only use explicit gender words in the title — no brands, no garment types.
  // If the title says "women" or "men", tag it. Otherwise both.
  const hasFem  = EXPLICIT_FEMALE.test(text);
  const hasMasc = EXPLICIT_MALE.test(text);
  if (hasFem && !hasMasc)       listing._gender = "female";
  else if (hasMasc && !hasFem)  listing._gender = "male";
  else                          listing._gender = "both";  // ambiguous or neutral
  return listing;
}

// Returns true if a listing should be shown to a user with the given gender
// preference. Decision rules (in order):
//   - gender="both" → always allow.
//   - title has both gender words (rare; "unisex mens womens") → allow all.
//   - title has only female word → only female users.
//   - title has only male word → only male users.
//   - no gender word at all → neutral, allow everyone.
export function genderPassesFilter(listing: any, gender: string): boolean {
  if (gender === "both") return true;
  const text = typeof listing === "string" ? listing : listingText(listing);
  // Only explicit gender words decide — no brands, no garment types.
  const hasFem  = EXPLICIT_FEMALE.test(text);
  const hasMasc = EXPLICIT_MALE.test(text);
  if (hasFem && hasMasc) return true;  // title has both (e.g. "unisex mens womens") — show to all
  if (hasFem)  return gender === "female";
  if (hasMasc) return gender === "male";
  return true;  // no gender word — neutral, show to everyone
}

/**
 * Get personalized For You recommendations for a user.
 * Finds depop_cache items whose embeddings are closest to the user's taste vector.
 * Excludes already-liked and skipped items. Filters by gender preference.
 *
 * The core SQL is:
 *   SELECT ... FROM depop_cache
 *   WHERE embedding IS NOT NULL AND permanent = TRUE
 *     AND query != ALL(excluded::text[])  -- exclude already-seen
 *   ORDER BY embedding <=> $taste_vector::vector  -- cosine distance, smallest first
 *   LIMIT N OFFSET M
 *
 * We pull `fetchMultiple * limit` rows so we have headroom for gender
 * filtering — male users may discard 60-80% of rows, so we 6x the pull.
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

  const gender: string = (profile as any).gender || "both";

  const excluded = [
    ...(profile.liked_ids || []),
    ...(profile.skipped_ids || []),
  ];

  // Pull more rows to compensate for gender filtering (3x for both, 6x for single gender)
  const fetchMultiple = gender === "both" ? 3 : 6;

  // Cosine similarity across ALL aesthetics/types — pure taste-based
  // For male users: exclude cache rows whose query contains female keywords
  const genderQueryFilter = gender === "male"
    ? client`AND NOT (query ILIKE ANY(ARRAY['%women%','%womens%','%womans%','%woman%','%ladies%','%girls%','%female%']))`
    : client``;
  const rows = await client<{ listings: any[]; query: string; aesthetic: string }[]>`
    SELECT listings, query, aesthetic
    FROM depop_cache
    WHERE embedding IS NOT NULL
      AND permanent = TRUE
      AND (${excluded.length} = 0 OR query != ALL(${excluded}::text[]))
      ${genderQueryFilter}
    ORDER BY embedding <=> ${profile.taste_vector}::vector
    LIMIT ${limit * fetchMultiple}
    OFFSET ${offset}
  `;

  // Flatten + dedupe + gender filter + aesthetic block
  const all: any[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // Skip entire cache rows from aesthetics blocked for this gender
    if (gender === "male" && FEMALE_ONLY_AESTHETICS.has(row.aesthetic)) continue;
    const listings = Array.isArray(row.listings) ? row.listings : JSON.parse(row.listings as any);
    for (const item of listings) {
      const key = item.url || item.id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!genderPassesFilter(item, gender)) continue;
      all.push({ ...item, _aesthetic: row.aesthetic });
      if (all.length >= limit + 1) break;
    }
    if (all.length >= limit + 1) break;
  }

  return { items: all.slice(0, limit), hasMore: all.length > limit };
}

/**
 * Average a batch of existing embeddings from cache rows matching given aesthetics.
 * Used to seed a user's taste vector from onboarding picks.
 *
 * Steps:
 *   1. (If gender is set) filter out aesthetics the user shouldn't see.
 *   2. Sample up to N rows per aesthetic with permanent=true.
 *   3. Drop rows where <40% of listings pass the gender filter — these are
 *      probably mis-tagged (e.g. a "Y2K" row that's actually all womenswear).
 *   4. Sum the embedding vectors and divide by row count to get an average.
 *      Equivalent to numpy: `np.mean(np.array(vectors), axis=0)`.
 */
export async function getAverageEmbeddingForAesthetics(aesthetics: string[], gender?: string): Promise<number[] | null> {
  if (!aesthetics.length) return null;

  // For male users, exclude female-only aesthetics from the seed pool
  const seedAesthetics = (gender === "male")
    ? aesthetics.filter(a => !FEMALE_ONLY_AESTHETICS.has(a))
    : aesthetics;
  if (!seedAesthetics.length) return null;

  // Sample up to 50 rows per aesthetic for the average
  const rows = await client<{ embedding: string; listings: any[] }[]>`
    SELECT embedding::text, listings FROM depop_cache
    WHERE aesthetic = ANY(${seedAesthetics}::text[])
      AND embedding IS NOT NULL
      AND permanent = TRUE
    ORDER BY RANDOM()
    LIMIT ${seedAesthetics.length * 80}
  `;

  if (!rows.length) return null;

  // For gendered users, filter rows where the majority of listings pass the title check
  // This steers the seed vector away from womenswear-heavy cache rows
  const filteredRows = (gender === "male" || gender === "female")
    ? rows.filter(row => {
        const listings = Array.isArray(row.listings) ? row.listings : JSON.parse(row.listings as any);
        const passCount = listings.filter((l: any) => genderPassesFilter(l, gender!)).length;
        // Keep the row if >40% of its listings pass the gender filter
        return passCount / Math.max(listings.length, 1) >= 0.4;
      })
    : rows;

  const useRows = filteredRows.length >= 5 ? filteredRows : rows; // fallback if too few pass

  const dim = 1536;
  const avg = new Array(dim).fill(0);
  for (const row of useRows) {
    // Parse "[0.1,0.2,...]" format
    const nums = (row.embedding as unknown as string).slice(1, -1).split(",").map(Number);
    for (let i = 0; i < dim; i++) avg[i] += nums[i];
  }
  const n = useRows.length;
  return avg.map(v => v / n);
}

// ─────────────────────────────────────────────
// DISCOVER — personalized ordering + shop-the-look
// ─────────────────────────────────────────────

/**
 * Get discover cards ordered by similarity to a user's taste vector.
 * Falls back to likes_count ordering if user has no taste vector.
 * The `1 - (embedding <=> $1::vector) AS taste_score` expression converts
 * cosine *distance* (0 = identical) to a *similarity* score (1 = identical)
 * for client display.
 */
export async function getDiscoverCardsByTaste(userId: string): Promise<any[]> {
  const profile = await getUserProfile(userId);
  if (!profile?.taste_vector) {
    // Fallback: order by likes_count desc
    return client`
      SELECT * FROM discover_cards ORDER BY likes_count DESC, created_at DESC LIMIT 50
    `;
  }
  // Order by cosine similarity to taste vector
  return client`
    SELECT *, 1 - (embedding <=> ${profile.taste_vector}::vector) AS taste_score
    FROM discover_cards
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${profile.taste_vector}::vector
    LIMIT 50
  `;
}

/**
 * "Shop the Look" — given a discover card's aesthetic + key pieces,
 * find real Depop cache listings using semantic search.
 * For each piece (up to 4), runs one getDepopCacheByEmbedding lookup with
 * the inferred garment type. Returns one group per piece for client display.
 */
export async function getShopTheLookItems(
  aesthetic: string,
  keyPieces: string[],
  limit = 3
): Promise<{ piece: string; items: any[] }[]> {
  const results: { piece: string; items: any[] }[] = [];
  for (const piece of keyPieces.slice(0, 4)) {
    const description = `${aesthetic} ${piece}`;
    const items = await getDepopCacheByEmbedding(description, aesthetic, inferGarmentType(piece), limit, piece)
      .catch(() => []);
    results.push({ piece, items });
  }
  return results;
}

// Infer garment type from a piece name. Same idea as `inferGarmentType`
// in routes.ts — kept duplicated rather than imported so storage.ts has no
// circular dep on routes.ts. Regex-based classifier with a fallback to "tops".
function inferGarmentType(piece: string): string {
  const p = piece.toLowerCase();
  if (/jean|pant|trouser|cargo|short|skirt|legging/.test(p)) return "bottoms";
  if (/shoe|sneaker|boot|heel|sandal|loafer|platform/.test(p)) return "shoes";
  if (/dress|romper|jumpsuit|slip/.test(p)) return "dresses";
  if (/jacket|coat|blazer|cardigan|vest|puffer|bomber|outerwear|flannel|overshirt/.test(p)) return "outerwear";
  return "tops";
}

// ─────────────────────────────────────────────
// WARDROBE — gap analysis via vector search
// ─────────────────────────────────────────────

/**
 * Given a user's wardrobe items, find what's missing.
 *
 * Heuristic: count how many items the user owns per garment category;
 * any category with <2 owned items is a "gap". Then pull taste-matched
 * Depop listings whose garment_type is in those gap categories.
 *
 * Originally this used vector-distance to *individual* wardrobe items, but
 * counting categories is simpler, faster, and gives users obvious wins
 * (e.g. "you have no outerwear — try these jackets").
 */
export async function getWardrobeGapRecommendations(
  userId: string,
  wardrobeItems: { name: string; category: string; brand?: string }[],
  limit = 6
): Promise<any[]> {
  if (!wardrobeItems.length) return [];
  const profile = await getUserProfile(userId);
  if (!profile?.taste_vector) return [];

  // Get items from depop_cache closest to taste vector
  // but exclude garment types the user already owns a lot of
  const categoryCount: Record<string, number> = {};
  for (const item of wardrobeItems) {
    categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
  }
  // Find categories with 0 or few items
  const ALL_TYPES = ["tops", "bottoms", "shoes", "outerwear", "dresses"];
  const missingTypes = ALL_TYPES.filter(t => (categoryCount[t] || 0) < 2);

  if (!missingTypes.length) {
    // Wardrobe is complete — just return taste-based recommendations
    return getForYouRecommendations(userId, limit).then(r => r.items);
  }

  // Pull items from taste vector search filtered to missing types
  const rows = await client<{ listings: any[]; query: string; garment_type: string; aesthetic: string }[]>`
    SELECT listings, query, garment_type, aesthetic
    FROM depop_cache
    WHERE garment_type = ANY(${missingTypes}::text[])
      AND embedding IS NOT NULL
      AND permanent = TRUE
    ORDER BY embedding <=> ${profile.taste_vector}::vector
    LIMIT ${limit * 4}
  `;

  const all: any[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const listings = Array.isArray(row.listings) ? row.listings : JSON.parse(row.listings as any);
    for (const item of listings) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        all.push({ ...item, _garmentType: row.garment_type, _aesthetic: row.aesthetic });
      }
    }
  }
  return all.slice(0, limit);
}

// ─────────────────────────────────────────────
// HISTORY — similar scans via aesthetic vector
// ─────────────────────────────────────────────

/**
 * Given a scan's aesthetic + style breakdown, find other scans
 * with similar aesthetic using cosine similarity on discover_cards embeddings.
 * Returns the top N most similar cards to show as "similar outfits".
 *
 * Vector source: we embed the string `"<aesthetic> <tag1> <tag2> ..."` so the
 * search isn't purely aesthetic-name-matching; tags add nuance (e.g. two
 * "Streetwear" outfits with "minimal" vs "loud" tags will rank differently).
 */
export async function getSimilarDiscoverCards(
  aesthetic: string,
  tags: string[],
  excludeId?: number,
  limit = 4
): Promise<any[]> {
  if (!openaiClient) return [];
  try {
    const text = `${aesthetic} ${tags.join(" ")}`.trim();
    const vec = await getEmbedding(text);
    if (!vec) return [];
    const vecStr = `[${vec.join(",")}]`;
    const rows = await client`
      SELECT id, image_url, aesthetic, tags, key_pieces, post_url, subreddit,
             1 - (embedding <=> ${vecStr}::vector) AS similarity
      FROM discover_cards
      WHERE embedding IS NOT NULL
        AND id != ${excludeId ?? -1}
      ORDER BY embedding <=> ${vecStr}::vector
      LIMIT ${limit}
    `;
    return rows;
  } catch (e) {
    console.error("[getSimilarDiscoverCards]", e);
    return [];
  }
}

// ─────────────────────────────────────────────
// UTILITY — embed and store a single discover_card
// Called after card creation to populate the embedding column.
// "Fire and forget": failures are warnings, not exceptions, because the
// embedding is a nice-to-have for vector search but not required for the
// card to function.
// ─────────────────────────────────────────────
export async function embedDiscoverCard(id: number, aesthetic: string, tags: string[], keyPieces: string[]): Promise<void> {
  if (!openaiClient) return;
  try {
    const text = `${aesthetic} ${tags.join(" ")} ${keyPieces.join(" ")}`.trim();
    const vec = await getEmbedding(text);
    if (!vec) return;
    const vecStr = `[${vec.join(",")}]`;
    await client`UPDATE discover_cards SET embedding = ${vecStr}::vector WHERE id = ${id}`;
  } catch (e: any) {
    console.warn("[embedDiscoverCard]", e.message);
  }
}
