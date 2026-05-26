# DATABASE.md — Stitch Database Architecture

## Table of Contents
1. [Overview & Tech Stack](#1-overview--tech-stack)
2. [Connection Setup](#2-connection-setup)
3. [Drizzle ORM vs Raw SQL — Why Both?](#3-drizzle-orm-vs-raw-sql--why-both)
4. [Table: `scans`](#4-table-scans)
5. [Table: `depop_cache`](#5-table-depop_cache)
6. [Table: `user_profiles`](#6-table-user_profiles)
7. [Table: `discover_cards`](#7-table-discover_cards)
8. [Table: `wardrobe_items`](#8-table-wardrobe_items)
9. [Table: `scanned_pieces`](#9-table-scanned_pieces)
10. [Vector Embeddings Deep Dive](#10-vector-embeddings-deep-dive)
11. [JSONB Columns Explained](#11-jsonb-columns-explained)
12. [Storage Layer: `storage.ts`](#12-storage-layer-storageys)
13. [Common Query Patterns](#13-common-query-patterns)
14. [Known Bugs & Workarounds](#14-known-bugs--workarounds)

---

## 1. Overview & Tech Stack

Stitch uses **Supabase** as a managed PostgreSQL host, accessed over the standard PostgreSQL wire protocol (not the Supabase JavaScript SDK). The stack is:

| Layer | Tool | Role |
|-------|------|------|
| Database host | Supabase (AWS us-east-1) | Managed PostgreSQL 15 with pgvector |
| Connection pool | Supabase connection pooler | PgBouncer-based pooling |
| Node.js driver | `postgres` npm package | Raw SQL queries from Express |
| ORM | `drizzle-orm` | Schema definitions + query builder for simple tables |
| Schema migrations | `drizzle-kit` | `drizzle-kit push` applies schema changes |
| Vector extension | `pgvector` | 1536-dimensional embeddings, cosine similarity |

**Why Supabase and not a plain Render PostgreSQL?** Supabase gives you pgvector out of the box, a web UI for exploring data, and a connection pooler that handles the high-connection-count issue you get with serverless/cloud deployments. The actual database is just Postgres — there's nothing Supabase-specific in the query code.

**Python analogy**: Think of this setup as SQLAlchemy (Drizzle) sitting on top of `psycopg2` (`postgres` npm), connecting to a managed DB instance like Amazon RDS or ElephantSQL.

---

## 2. Connection Setup

**File**: `server/storage.ts` (top section)

```typescript
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../shared/schema";

const connectionString = process.env.DATABASE_URL!;

// Raw SQL client — used for vector queries, user_profiles, depop_cache
const sql = postgres(connectionString, { prepare: false });

// Drizzle ORM client — wraps the same connection, used for simple tables
export const db = drizzle(sql, { schema });
```

**The `prepare: false` flag is critical.** Normally, PostgreSQL drivers use *prepared statements* — the driver sends the query structure to Postgres once, Postgres plans it, and then subsequent calls just send parameters. This is a performance optimisation.

However, on Render.com's infrastructure (and with pgvector's JSONB handling), prepared statements cause a bug where JSONB parameters get serialised incorrectly. Setting `prepare: false` forces every query to be sent as a plain string, avoiding this entirely. The performance hit is negligible for this app's traffic.

**Python equivalent**:
```python
# Python psycopg2 — similar concept
import psycopg2

conn = psycopg2.connect(DATABASE_URL)
cursor = conn.cursor()

# "prepare: false" equivalent — don't use server-side prepared statements
# psycopg2 uses client-side parameter binding by default, which is safe
cursor.execute("SELECT * FROM scans WHERE device_id = %s", (device_id,))
```

The `sql` object is a tagged template literal function:

```typescript
// This is how you write raw SQL in TypeScript with the postgres npm package
const rows = await sql`SELECT * FROM scans WHERE device_id = ${deviceId}`;

// The ${deviceId} is NOT string interpolation — it's a parameterised query
// The library sends: SELECT * FROM scans WHERE device_id = $1
// with deviceId as the parameter value. SQL injection safe.
```

**Python equivalent**:
```python
# Exact same concept in Python
cursor.execute("SELECT * FROM scans WHERE device_id = %s", (device_id,))
```

---

## 3. Drizzle ORM vs Raw SQL — Why Both?

Drizzle ORM is used for **three tables**: `scans`, `wardrobe_items`, `discover_cards`.

Raw SQL (`sql` tagged templates) is used for **two tables**: `user_profiles`, `depop_cache`.

**Why the split?** The two raw-SQL tables have `vector(1536)` columns. Drizzle's type system doesn't natively understand pgvector's `vector` type or its `<=>` cosine-distance operator. Trying to build queries like `ORDER BY embedding <=> $1::vector` through an ORM is awkward — you'd have to use escape hatches. It's cleaner to write those queries in raw SQL from the start.

The ORM tables (`scans`, `wardrobe_items`, `discover_cards`) are straightforward CRUD — no vector math — so Drizzle's query builder gives you type safety for free.

**Drizzle is like SQLAlchemy's Core (not ORM)**. It maps directly to SQL expressions rather than hiding them behind object relationships. There's no lazy loading, no sessions, no `flush()`. You just write queries and get typed results back.

```typescript
// Drizzle query — feels almost like SQL
const recentScans = await db
  .select()
  .from(schema.scans)
  .where(eq(schema.scans.deviceId, deviceId))
  .orderBy(desc(schema.scans.createdAt))
  .limit(20);

// Python SQLAlchemy Core equivalent
result = conn.execute(
    select(scans).where(scans.c.device_id == device_id)
    .order_by(desc(scans.c.created_at))
    .limit(20)
)
```

**Schema definition** lives in `shared/schema.ts`. The `shared/` directory is accessible by both the frontend (for type imports) and the backend. This is a TypeScript monorepo pattern.

```typescript
// shared/schema.ts — Drizzle table definition
import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const scans = pgTable("scans", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id"),
  imageData: text("image_data"),
  aesthetic: text("aesthetic"),
  // ...
});
```

```python
# Python SQLAlchemy equivalent
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class Scan(Base):
    __tablename__ = "scans"
    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String)
    image_data = Column(Text)
    aesthetic = Column(String)
```

---

## 4. Table: `scans`

**Purpose**: Stores every outfit analysis the app has ever performed. Each row represents one image upload + Gemini analysis result.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PRIMARY KEY` | Auto-incrementing integer ID |
| `device_id` | `TEXT` | The device that triggered this scan (from localStorage) |
| `image_data` | `TEXT` | Full base64-encoded image (data URI, e.g. `data:image/jpeg;base64,...`) |
| `aesthetic` | `TEXT` | Primary aesthetic label, e.g. `"Dark Academia"` |
| `confidence` | `INTEGER` | Gemini's confidence score (0–100) |
| `style_breakdown` | `TEXT` | JSON string: `[{"label": "Dark Academia", "pct": 75}, ...]` |
| `occasions` | `TEXT` | JSON string: `["Everyday", "Library", "Autumn Walk"]` |
| `key_pieces` | `TEXT` | JSON string: `["Oversized blazer", "Turtleneck", "Oxford shoes"]` |
| `depop_queries` | `TEXT` | JSON string: array of search queries sent to Depop |
| `color_palette` | `TEXT` | JSON string: array of hex colours, e.g. `["#2C1810", "#4A3728"]` |
| `results` | `TEXT` | JSON string: the full Depop product listings returned to the user |
| `created_at` | `TIMESTAMP` | When the scan was created |

### Why TEXT instead of JSONB for JSON columns?

You'll notice `style_breakdown`, `occasions`, `key_pieces` etc. are stored as `TEXT` (JSON strings) rather than PostgreSQL's `JSONB` type. This was a pragmatic choice — it avoids the parameterised-query JSONB serialisation issues on Render (see [Known Bugs](#14-known-bugs--workarounds)), and since these columns are read-back-and-parsed rather than queried against, there's no need for JSONB's operator support.

When reading: `JSON.parse(scan.styleBreakdown)` turns the string back into an array.
When writing: `JSON.stringify(styleBreakdown)` turns the array into a string before saving.

```typescript
// Writing a scan
await db.insert(schema.scans).values({
  deviceId: deviceId,
  imageData: imageDataBase64,
  aesthetic: analysis.aesthetic,
  confidence: analysis.confidence,
  styleBreakdown: JSON.stringify(analysis.styleBreakdown),  // array → string
  occasions: JSON.stringify(analysis.occasions),
  keyPieces: JSON.stringify(analysis.keyPieces),
  depopQueries: JSON.stringify(queries),
  colorPalette: JSON.stringify(analysis.colorPalette),
  results: JSON.stringify(depopResults),
});

// Reading a scan
const scan = await db.select().from(schema.scans).where(eq(schema.scans.id, id));
const styleBreakdown = JSON.parse(scan[0].styleBreakdown);  // string → array
```

### `imageData` column — base64 storage

Storing images as base64 in the database is not common in production systems (usually you'd use S3 or Cloudflare R2), but for a side project it simplifies deployment enormously — no object storage to configure, no signed URL management. The downside is that the `scans` table gets large quickly, and base64 is ~33% larger than the binary equivalent.

A full-resolution JPEG might be 200KB. As base64, that's ~270KB stored as a text string. After 1000 scans, the table holds ~270MB of image data.

---

## 5. Table: `depop_cache`

This is the most important and complex table in the database. It is the heart of the search system.

**Purpose**: Cache Depop search results so the app doesn't call Depop's API on every user request. Also stores vector embeddings for semantic similarity search ("For You" feed).

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL` | Auto-incrementing integer |
| `query` | `TEXT UNIQUE` | The Depop search query string (acts as primary key) |
| `listings` | `JSONB` | Array of normalised listing objects |
| `aesthetic` | `TEXT` | Which aesthetic this query belongs to (e.g. `"Dark Academia"`) |
| `permanent` | `BOOLEAN` | If TRUE, never expire. If FALSE, expire after 24h. |
| `garment_type` | `TEXT` | Category label (e.g. `"tops"`, `"trousers"`, `"dresses"`) |
| `embedding` | `vector(1536)` | OpenAI text-embedding-3-small vector |
| `created_at` | `TIMESTAMP` | When this cache entry was created |

### `query` as Unique Key

The `query` column is `UNIQUE`, which means it functions as a natural primary key. When you want to look up cached results for a search, you do:

```sql
SELECT * FROM depop_cache WHERE query = 'dark academia blazer women'
```

If that row exists and was created less than 24 hours ago (or has `permanent = TRUE`), the cached listings are returned directly — no Depop API call needed.

### `listings` — JSONB Array

Each row's `listings` column holds an array of normalised listing objects. Here's what one element looks like:

```json
[
  {
    "id": "dep-12345",
    "title": "Vintage 90s Plaid Blazer Dark Academia",
    "price": "35.00",
    "currency": "GBP",
    "imageUrl": "https://d3csawd27ejgw2.cloudfront.net/...",
    "url": "https://www.depop.com/products/username-vintage-90s-plaid/",
    "seller": "thriftingwitch",
    "gender": "female",
    "likes": 47
  },
  { ... }
]
```

The `gender` field on each listing is added by Stitch's own gender detection logic (see `server/storage.ts` → `detectGender()`), not by Depop.

### The 24-Hour TTL System

`depop_cache` rows expire after 24 hours unless `permanent = TRUE`. This is implemented in the application layer, not in PostgreSQL (no `pg_cron` or `EXPIRES` column):

```typescript
// From storage.ts — checking if cache is fresh
async function getCachedListings(query: string): Promise<Listing[] | null> {
  const rows = await sql`
    SELECT listings, created_at, permanent
    FROM depop_cache
    WHERE query = ${query}
  `;

  if (rows.length === 0) return null;  // Cache miss

  const row = rows[0];
  const ageHours = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;

  if (!row.permanent && ageHours > 24) {
    return null;  // Cache expired — treat as miss, caller will re-fetch
  }

  return row.listings;  // Cache hit
}
```

**Why 24 hours?** Depop listings change throughout the day — items sell out, new items get listed. Stale cache means users see sold-out items. 24 hours is a balance between API load and freshness.

**`permanent = TRUE`** rows are seeded by `scripts/python/seed.py` and represent curated base queries the app wants to always have fresh data for. The daily cron job (`startDailyRefreshCron()`) re-fetches permanent rows to keep them fresh without deleting them.

### `embedding` — The Vector Column

The `embedding` column stores a 1536-dimensional floating-point vector for each cache row. This vector represents the *semantic meaning* of that query and its top listing titles.

**What gets embedded**: The string `"{query}: title1, title2, title3, title4, title5"` — the query itself followed by the first five listing titles. This captures both the search intent and the actual product vocabulary.

Example embed text:
```
"dark academia blazer women: Vintage 90s plaid blazer dark academia, 
Brown tweed blazer oversized, Dark academia corduroy blazer, 
Vintage herringbone blazer women, Checkered blazer academia aesthetic"
```

This string is sent to OpenAI's `text-embedding-3-small` model, which returns 1536 numbers representing the text in "embedding space" — a high-dimensional coordinate system where semantically similar text clusters together.

**The IVFFlat Index**:

```sql
CREATE INDEX ON depop_cache USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

Without this index, finding the nearest embedding to a query vector would require computing cosine distance to every single row — an O(n) scan over 7,700+ vectors. With the IVFFlat (Inverted File Flat) index, Postgres organises vectors into 100 "buckets" (lists) and only searches the nearest buckets, making similarity search much faster (approximate O(√n) in practice).

`vector_cosine_ops` means the index is optimised for cosine distance, which is the right metric for text embeddings (it measures angle between vectors, ignoring magnitude).

**Python equivalent** (using numpy for intuition):
```python
import numpy as np

def cosine_distance(a, b):
    # 1 - cosine_similarity
    return 1 - np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# PostgreSQL's <=> operator does exactly this, but across millions of vectors
# The IVFFlat index makes this fast by approximation
```

### 7,700+ Rows — Why So Many?

Each aesthetic has many sub-queries. For "Dark Academia" you might have:
- `dark academia blazer women`
- `dark academia turtleneck`
- `dark academia trousers wide leg`
- `oxford shoes dark academia`
- `corduroy jacket dark academia`
- ...and 30+ more

Multiply that across 41 aesthetics × ~30 queries each = 1,200+ seed queries, plus ad-hoc queries generated during user scans. Over time the table grows to 7,700+ rows, each with cached Depop results.

---

## 6. Table: `user_profiles`

**Purpose**: Stores each user's taste preferences and interaction history. This is what makes the "For You" feed personalised.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | `TEXT PRIMARY KEY` | UUID from localStorage (`stitch_user_id`) |
| `taste_vector` | `vector(1536)` | Running average embedding of liked items |
| `interaction_count` | `INTEGER` | Total number of interactions (likes + saves + skips) |
| `liked_ids` | `TEXT[]` | Array of liked listing IDs |
| `skipped_ids` | `TEXT[]` | Array of skipped listing IDs |
| `onboarded` | `BOOLEAN` | Has the user completed the style quiz? |
| `liked_items` | `JSONB` | Full listing objects for liked items (for History page) |
| `gender` | `TEXT` | `'male'`, `'female'`, or `'both'` |
| `created_at` | `TIMESTAMPTZ` | Profile creation time (with timezone) |
| `updated_at` | `TIMESTAMPTZ` | Last modification time |

### `taste_vector` — The Core of Personalisation

The `taste_vector` is a 1536-dimensional vector that represents the user's taste. It starts as the average of embeddings for their selected aesthetics (from the quiz), then evolves as they interact with listings.

**How it's updated** (from `storage.ts`):

```typescript
async function updateTasteVector(
  userId: string,
  itemEmbedding: number[],  // 1536 floats
  interactionType: "like" | "save" | "skip"
) {
  const weights = { save: 3, like: 1, skip: -0.5 };
  const weight = weights[interactionType];

  const profile = await getUserProfile(userId);
  const n = profile.interactionCount;
  const oldVec = profile.tasteVector;  // 1536 floats

  // Weighted running average
  const newVec = oldVec.map((v, i) => (v * n + itemEmbedding[i] * weight) / (n + Math.abs(weight)));

  // Normalise to unit length (required for cosine similarity to work correctly)
  const magnitude = Math.sqrt(newVec.reduce((sum, v) => sum + v * v, 0));
  const normalised = newVec.map(v => v / magnitude);

  await sql`
    UPDATE user_profiles
    SET taste_vector = ${JSON.stringify(normalised)}::vector,
        interaction_count = ${n + 1},
        updated_at = NOW()
    WHERE user_id = ${userId}
  `;
}
```

**Python equivalent**:
```python
import numpy as np

def update_taste_vector(old_vec, item_embedding, interaction_type, n):
    weights = {"save": 3, "like": 1, "skip": -0.5}
    weight = weights[interaction_type]
    
    old_vec = np.array(old_vec)
    item_embedding = np.array(item_embedding)
    
    # Weighted running average
    new_vec = (old_vec * n + item_embedding * weight) / (n + abs(weight))
    
    # Normalise to unit length
    new_vec = new_vec / np.linalg.norm(new_vec)
    
    return new_vec.tolist()
```

**Why a running average instead of storing all interactions?** A running average is O(1) storage — the taste vector never grows regardless of how many items a user interacts with. You'd need to store every interaction to do better, which would be a separate `interactions` table. The running average approach loses some precision (you can't un-apply an old interaction) but is simple and effective.

### `liked_items` — JSONB for History

`liked_items` stores full listing objects so the History page can display them without hitting Depop's API again. It's a JSONB column (real JSON, not a string) because Stitch appends to it using a raw SQL approach:

```typescript
// From storage.ts — appendLikedItem
// NOTE: Uses raw string interpolation (NOT parameterised) due to a Render JSONB bug
async function appendLikedItem(userId: string, item: ListingObject) {
  const itemJson = JSON.stringify(item);
  // jsonb_insert appends to the end of a JSONB array
  await sql.unsafe(`
    UPDATE user_profiles
    SET liked_items = CASE
      WHEN liked_items IS NULL THEN '[]'::jsonb
      ELSE liked_items
    END || '${itemJson.replace(/'/g, "''")}'::jsonb
    WHERE user_id = '${userId}'
  `);
}
```

**Warning**: `sql.unsafe()` bypasses parameterised queries. This is necessary due to the Render JSONB bug but means careful sanitisation of `itemJson` is required. The `replace(/'/g, "''")` escapes single quotes for SQL safety.

### `liked_ids` and `skipped_ids` — PostgreSQL Arrays

```sql
-- Adding to a PostgreSQL array
UPDATE user_profiles
SET liked_ids = array_append(liked_ids, 'dep-12345')
WHERE user_id = 'abc-uuid';

-- Checking if an ID is in the array
SELECT * FROM user_profiles WHERE 'dep-12345' = ANY(liked_ids);
```

**Python equivalent** (conceptual):
```python
# PostgreSQL TEXT[] is like a Python list stored in a column
profile["liked_ids"].append("dep-12345")
```

---

## 7. Table: `discover_cards`

**Purpose**: Stores outfit inspiration cards for the Discover page — the TikTok-style swipe feed. These come from Reddit outfit posts, analysed by Gemini.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PRIMARY KEY` | Auto-incrementing integer |
| `image_url` | `TEXT` | URL to the Reddit post image |
| `aesthetic` | `TEXT` | Gemini-assigned aesthetic label |
| `confidence` | `INTEGER` | Default 80. Gemini's confidence score. |
| `style_breakdown` | `TEXT` | JSON string: `[{label, pct}]` |
| `key_pieces` | `TEXT` | JSON string: `["item1", "item2"]` |
| `color_palette` | `TEXT` | JSON string: `["#hex1", "#hex2"]` |
| `tags` | `TEXT` | JSON string: `["minimalist", "monochrome"]` |
| `source` | `TEXT` | Default `'reddit'`. Where the image came from. |
| `post_url` | `TEXT` | Link to the original Reddit post |
| `subreddit` | `TEXT` | e.g. `"femalefashionadvice"` |
| `likes_count` | `INTEGER` | How many times users liked this card in-app |
| `embedding` | `vector(1536)` | For future recommendation use |
| `created_at` | `TIMESTAMP` | When the card was added |

### The Discover Pipeline

1. `fetchSubredditImages()` in `server/routes.ts` hits Reddit's JSON API for a subreddit's hot posts
2. Image posts are filtered (must have a direct image URL)
3. Each image is sent to Gemini 2.5 Flash for aesthetic analysis
4. Results are inserted into `discover_cards`
5. The daily cron job (`startDailyRefreshCron()`) re-runs this at 3am

**SUBREDDIT_MAP** maps subreddits to their expected aesthetics:
```typescript
const SUBREDDIT_MAP: Record<string, string> = {
  "femalefashionadvice": "Clean Fit",
  "malefashionadvice": "Clean Fit",
  "streetwear": "Streetwear",
  "darkacademia": "Dark Academia",
  "cottagecore": "Cottagecore",
  // ...more
};
```

### Daily Pruning

The cron job at 3am also prunes old discover cards:

```sql
DELETE FROM discover_cards
WHERE created_at < NOW() - INTERVAL '30 days'
AND likes_count = 0;
```

This removes cards older than 30 days that no user ever liked, keeping the table from growing unbounded. Cards with at least one like are kept indefinitely.

---

## 8. Table: `wardrobe_items`

**Purpose**: Stores items the user has added to their personal wardrobe in the app. Currently a simple table with no vector columns — just metadata.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PRIMARY KEY` | Auto-incrementing integer |
| `name` | `TEXT` | Item name, e.g. `"Vintage Levi's 501"` |
| `category` | `TEXT` | e.g. `"jeans"`, `"tops"`, `"shoes"` |
| `image_data` | `TEXT` | Base64 image of the item |
| `brand` | `TEXT` | Brand name if known |
| `color` | `TEXT` | Primary colour |
| `aesthetic` | `TEXT` | Aesthetic assigned to this item |
| `source` | `TEXT` | Default `'manual'`. Could be `'scan'` if added from a scan result. |
| `added_at` | `TIMESTAMP` | When the item was added |

This table is entirely managed by Drizzle ORM — no special SQL needed.

---

## 9. Table: `scanned_pieces`

**Purpose**: Tracks what garment types and aesthetics appear most often in real user scans. This data is used to prioritise which items get seeded into `depop_cache`.

### Schema

| Column | Type | Constraint | Description |
|--------|------|-----------|-------------|
| `piece` | `TEXT` | Composite PK (with `aesthetic`) | A garment item, e.g. `"oversized blazer"` |
| `aesthetic` | `TEXT` | Composite PK (with `piece`) | The aesthetic context |
| `garment_type` | `TEXT` | — | Category: `"tops"`, `"outerwear"`, etc. |
| `scan_count` | `INTEGER` | — | How many times this piece appeared in scans |
| `last_seen_at` | `TIMESTAMPTZ` | — | Most recent scan timestamp |

**Composite Primary Key**: The pair `(piece, aesthetic)` is unique. `("oversized blazer", "Dark Academia")` and `("oversized blazer", "Streetwear")` are different rows because the same garment means different things in different aesthetic contexts.

### How It's Populated

After every scan in `server/routes.ts`, the key pieces extracted by Gemini are upserted into `scanned_pieces`:

```sql
INSERT INTO scanned_pieces (piece, aesthetic, garment_type, scan_count, last_seen_at)
VALUES ($1, $2, $3, 1, NOW())
ON CONFLICT (piece, aesthetic) DO UPDATE
SET scan_count = scanned_pieces.scan_count + 1,
    last_seen_at = NOW();
```

**`ON CONFLICT DO UPDATE`** is PostgreSQL's "upsert" — insert if not exists, update if exists. Python's equivalent would be `INSERT OR REPLACE INTO ...` in SQLite, or `session.merge()` in SQLAlchemy.

### How It's Used

The seed-trending feature reads `scanned_pieces` to understand what real users are wearing:

```sql
SELECT piece, aesthetic, scan_count
FROM scanned_pieces
ORDER BY scan_count DESC
LIMIT 50;
```

This lets the app automatically seed cache rows for the most-searched items, improving cache hit rate.

---

## 10. Vector Embeddings Deep Dive

This section explains the pgvector extension and how Stitch uses it for semantic search.

### What is a Vector Embedding?

An embedding is a list of floating-point numbers that represents the *meaning* of a piece of text. OpenAI's `text-embedding-3-small` model maps any text to exactly 1536 numbers.

```python
# Python intuition
import openai

response = openai.embeddings.create(
    model="text-embedding-3-small",
    input="dark academia blazer women"
)
embedding = response.data[0].embedding  # List of 1536 floats, e.g. [0.023, -0.14, ...]
```

The magic is that *semantically similar texts produce similar vectors*. "Dark academia blazer" and "Gothic scholar coat" will have vectors that are close together in the 1536-dimensional space. "Cat food" will be very far away from both.

### pgvector Syntax

```sql
-- Store a vector
UPDATE depop_cache
SET embedding = '[0.023, -0.14, ...]'::vector
WHERE query = 'dark academia blazer women';

-- Find the 10 most similar rows to a given vector (cosine distance)
SELECT query, aesthetic, embedding <=> '[0.023, -0.14, ...]'::vector AS distance
FROM depop_cache
ORDER BY distance ASC
LIMIT 10;
```

The `<=>` operator computes **cosine distance** (0 = identical direction, 2 = opposite direction). Lower is better (more similar). The result you want is the rows with the smallest distance.

**Other pgvector operators**:
- `<->` — Euclidean (L2) distance
- `<#>` — Negative inner product
- `<=>` — Cosine distance ← used in Stitch

### How "For You" Feed Works End-to-End

1. User completes onboarding quiz, picks aesthetics they like (e.g. "Dark Academia", "Cottagecore")
2. `getAverageEmbeddingForAesthetics()` computes the average embedding of those aesthetic names
3. This average is stored as the initial `taste_vector` in `user_profiles`
4. As user interacts (like/save/skip), `taste_vector` is updated with a weighted running average
5. When user opens For You feed:

```sql
SELECT dc.query, dc.listings, dc.aesthetic, dc.garment_type,
       dc.embedding <=> up.taste_vector::vector AS distance
FROM depop_cache dc
CROSS JOIN (
  SELECT taste_vector FROM user_profiles WHERE user_id = $1
) up
WHERE dc.embedding IS NOT NULL
  AND dc.listings IS NOT NULL
ORDER BY distance ASC
LIMIT 50;
```

This returns the 50 cache rows whose content is most semantically similar to the user's taste vector — i.e., the searches most aligned with what the user has liked.

### `normalizeForEmbedding()` — Stripping Brand Names

Before embedding a query, brand names are stripped out:

```typescript
function normalizeForEmbedding(query: string): string {
  // Strip brand names from a 200+ word list (Nike, Zara, Levi's, etc.)
  const brandRegex = /\b(nike|zara|levis|h&m|...200 more...)\b/gi;
  return query.replace(brandRegex, "").trim().replace(/\s+/g, " ");
}
```

**Why?** If you embed "Nike dark academia blazer" and "Zara dark academia blazer" separately, they'd land in slightly different parts of embedding space because the brand name adds signal. Stripping brands makes embeddings about the *style* not the *brand*, which is what you want for aesthetic similarity matching.

---

## 11. JSONB Columns Explained

JSONB (JSON Binary) is PostgreSQL's native JSON type. Unlike storing JSON as TEXT, JSONB:
- Is stored in a binary format (faster reads)
- Can be queried with operators (`->`, `->>`, `@>`, `?`)
- Can be indexed
- Validates JSON on insert (will error if malformed)

### JSONB in `depop_cache.listings`

```sql
-- Get the first listing from a cache row
SELECT listings->0 FROM depop_cache WHERE query = 'dark academia blazer';

-- Get the title of the first listing
SELECT listings->0->>'title' FROM depop_cache WHERE query = 'dark academia blazer';

-- Filter: only cache rows where any listing is by seller 'thriftingwitch'
SELECT * FROM depop_cache WHERE listings @> '[{"seller": "thriftingwitch"}]';
```

**`->` returns JSONB, `->>`  returns TEXT** (dereferences the value as a string).

### JSONB in `user_profiles.liked_items`

```sql
-- Append a new liked item to the array
UPDATE user_profiles
SET liked_items = liked_items || '{"id": "dep-99", "title": "Plaid Blazer"}'::jsonb
WHERE user_id = 'abc-uuid';

-- Count liked items
SELECT jsonb_array_length(liked_items) FROM user_profiles WHERE user_id = 'abc-uuid';
```

The `||` operator on JSONB arrays concatenates them (same as Python's `list + list`).

---

## 12. Storage Layer: `storage.ts`

`server/storage.ts` is the data access layer — think of it as a Python `db.py` module that wraps all database operations. The Express routes import functions from here rather than writing SQL directly.

### Key Functions

```typescript
// User profile management
getUserProfile(userId: string): Promise<UserProfile>
createUserProfile(userId: string): Promise<UserProfile>
updateGender(userId: string, gender: string): Promise<void>
updateTasteVector(userId: string, embedding: number[], type: string): Promise<void>
appendLikedItem(userId: string, item: Listing): Promise<void>

// Depop cache
getCachedListings(query: string): Promise<Listing[] | null>
setCachedListings(query: string, listings: Listing[], aesthetic: string, ...): Promise<void>
getForYouListings(userId: string, gender: string): Promise<CacheRow[]>
getTrendingListings(gender?: string): Promise<CacheRow[]>

// Scans
saveScan(data: ScanData): Promise<Scan>
getScanById(id: number): Promise<Scan | null>
getScansByDevice(deviceId: string): Promise<Scan[]>

// Discover cards
getDiscoverCards(limit: number): Promise<DiscoverCard[]>
likeDiscoverCard(id: number): Promise<void>
```

### Gender Detection

Every listing fetched from Depop is tagged with a gender. The `detectGender()` function in `storage.ts` reads the listing title and URL slug:

```typescript
const EXPLICIT_FEMALE = /\b(women[''']?s?|woman|womans|womena|ladies|lady|girls?|female|womenswear)\b/i;
const EXPLICIT_MALE = /\b(men[''']?s?|man|male|boys?|menswear)\b/i;

function detectGender(title: string, url: string): "male" | "female" | "both" {
  const text = listingText(title, url);  // title + URL slug words
  const isFemale = EXPLICIT_FEMALE.test(text);
  const isMale = EXPLICIT_MALE.test(text);
  
  if (isFemale && isMale) return "both";
  if (isFemale) return "female";
  if (isMale) return "male";
  return "both";  // No signal → assume unisex
}
```

This gender tag is used to filter the For You and Trending feeds based on the user's gender preference in their profile.

---

## 13. Common Query Patterns

### Upsert (Insert or Update)

```sql
-- PostgreSQL upsert syntax
INSERT INTO depop_cache (query, listings, aesthetic)
VALUES ($1, $2, $3)
ON CONFLICT (query)
DO UPDATE SET
  listings = EXCLUDED.listings,
  created_at = NOW();
```

**`EXCLUDED`** refers to the row that was rejected by the conflict. This is how you say "use the new values".

**Python SQLAlchemy equivalent**:
```python
from sqlalchemy.dialects.postgresql import insert

stmt = insert(depop_cache).values(query=q, listings=l, aesthetic=a)
stmt = stmt.on_conflict_do_update(
    index_elements=["query"],
    set_={"listings": stmt.excluded.listings, "created_at": func.now()}
)
session.execute(stmt)
```

### Batch Fetch

```typescript
// Fetch all permanent cache rows for re-embedding
const rows = await sql`
  SELECT id, query, listings
  FROM depop_cache
  WHERE embedding IS NULL
  ORDER BY id ASC
`;
```

### Array Append

```sql
-- Append to a PostgreSQL TEXT[] column
UPDATE user_profiles
SET liked_ids = array_append(liked_ids, 'dep-12345')
WHERE user_id = $1;
```

---

## 14. Known Bugs & Workarounds

### Bug 1: JSONB Parameterisation on Render

**Symptom**: When using parameterised queries (`$1`, `$2`) with JSONB values, Postgres on Render (or via Supabase pooler) sometimes fails with a type serialisation error.

**Root cause**: The `postgres` npm package's type coercion for JSONB interacts badly with PgBouncer (Supabase's connection pooler) when `prepare: true`.

**Fix 1**: `prepare: false` on the connection (applied globally).
**Fix 2**: For the `liked_items` append specifically, `sql.unsafe()` with manual JSON serialisation is used as a belt-and-suspenders approach.

### Bug 2: Vector Cast Syntax

When passing a vector to a parameterised query, you must explicitly cast:

```typescript
// WRONG — will fail
await sql`UPDATE user_profiles SET taste_vector = ${vectorArray} WHERE user_id = ${id}`;

// CORRECT — explicit cast tells pgvector the type
await sql`
  UPDATE user_profiles
  SET taste_vector = ${JSON.stringify(vectorArray)}::vector
  WHERE user_id = ${id}
`;
```

The `::vector` cast tells PostgreSQL to interpret the JSON string as a pgvector vector type.

### Bug 3: IVFFlat Index Requires Minimum Rows

The IVFFlat index on `depop_cache.embedding` requires at least `lists * 3` rows to be built (`100 * 3 = 300 rows`). If you `TRUNCATE depop_cache` and then try to run a vector similarity query, it may fail or fall back to a sequential scan. Run `REINDEX` after bulk inserts if performance degrades.

---

## Quick Reference: SQL to Python Mapping

| PostgreSQL | Python/SQLAlchemy |
|-----------|------------------|
| `SERIAL PRIMARY KEY` | `Column(Integer, primary_key=True, autoincrement=True)` |
| `TEXT[]` | `Column(ARRAY(String))` |
| `JSONB` | `Column(JSONB)` |
| `vector(1536)` | No native equivalent; use `pgvector` Python library |
| `ON CONFLICT DO UPDATE` | `session.merge()` or `insert().on_conflict_do_update()` |
| `array_append(col, val)` | `col.append(val)` (Python list) |
| `<=>` cosine distance | `1 - numpy.dot(a, b) / (norm(a) * norm(b))` |
| `@>` JSONB contains | `dict_a.items() <= dict_b.items()` (conceptually) |
| `TIMESTAMPTZ` | `datetime` with `tzinfo` |
