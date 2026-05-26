# AI.md — Stitch AI & Machine Learning System

## Table of Contents
1. [AI Architecture Overview](#1-ai-architecture-overview)
2. [Two-Pass Gemini Analysis](#2-two-pass-gemini-analysis)
3. [Pass 1: Garment Detection (Gemini 2.5 Flash-Lite)](#3-pass-1-garment-detection-gemini-25-flash-lite)
4. [Pass 2: Aesthetic Classification (Gemini 2.5 Flash)](#4-pass-2-aesthetic-classification-gemini-25-flash)
5. [The 41 Aesthetics Taxonomy](#5-the-41-aesthetics-taxonomy)
6. [Retry Logic & Error Handling](#6-retry-logic--error-handling)
7. [OpenAI Embeddings System](#7-openai-embeddings-system)
8. [The Taste Vector System](#8-the-taste-vector-system)
9. [Gender Filtering & Detection](#9-gender-filtering--detection)
10. [For You Feed: Semantic Search](#10-for-you-feed-semantic-search)
11. [Discover Cards: Reddit → Gemini Pipeline](#11-discover-cards-reddit--gemini-pipeline)
12. [`normalizeForEmbedding()` — Brand Stripping](#12-normalizeforembedding--brand-stripping)
13. [Gemini Structured Output (JSON Schemas)](#13-gemini-structured-output-json-schemas)
14. [AI Costs & Model Selection Rationale](#14-ai-costs--model-selection-rationale)

---

## 1. AI Architecture Overview

Stitch uses two AI systems:

```
┌─────────────────────────────────────────────────────────────┐
│                     AI SYSTEM MAP                           │
│                                                             │
│  IMAGE INPUT                                                │
│      │                                                      │
│      ▼                                                      │
│  ┌──────────────────────┐                                   │
│  │  Pass 1: Flash-Lite  │  ← Gemini 2.5 Flash-Lite         │
│  │  Garment Detection   │    Cheap, fast                    │
│  │                      │    Returns: garments list,        │
│  │  "What items are     │    palette, perceived gender      │
│  │   in this image?"    │                                   │
│  └──────────┬───────────┘                                   │
│             │                                               │
│             ▼                                               │
│  ┌──────────────────────┐                                   │
│  │  Pass 2: Flash       │  ← Gemini 2.5 Flash               │
│  │  Aesthetic Analysis  │    More capable, costs more       │
│  │                      │    Returns: aesthetic, confidence, │
│  │  "What aesthetic is  │    style breakdown, occasions,    │
│  │   this outfit?"      │    key pieces, Depop queries      │
│  └──────────┬───────────┘                                   │
│             │                                               │
│             ▼                                               │
│  ┌──────────────────────┐                                   │
│  │  Depop Search        │                                   │
│  │  + Cache Lookup      │                                   │
│  └──────────┬───────────┘                                   │
│             │                                               │
│             ▼                                               │
│         RESULTS                                             │
│                                                             │
│  EMBEDDINGS SYSTEM (separate)                               │
│  ┌─────────────────────────────────────────┐               │
│  │  OpenAI text-embedding-3-small (1536d)  │               │
│  │  Used for:                              │               │
│  │  - depop_cache.embedding (per query)    │               │
│  │  - user_profiles.taste_vector           │               │
│  │  - discover_cards.embedding             │               │
│  └─────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

**Two completely separate AI providers**:
- **Google Gemini** → Vision + reasoning (analysing images, generating aesthetic labels, writing search queries)
- **OpenAI** → Embeddings only (converting text to vectors for semantic similarity search)

---

## 2. Two-Pass Gemini Analysis

When a user uploads an image, the backend runs **two sequential Gemini API calls** before returning a response. This two-pass approach is a deliberate architectural decision.

### Why Two Passes?

**Single-pass attempt (abandoned)**:
```
Image → "What's the aesthetic and what items are in it?" → One big response
```
This produced inconsistent results. Gemini would sometimes focus on aesthetic classification and give vague garment descriptions, other times do the opposite. Accuracy suffered.

**Two-pass solution**:
```
Pass 1: "Just tell me what garments are in this image" (narrow, concrete task)
Pass 2: "Given these garments, what aesthetic is this?" (higher-level reasoning)
```

By separating concerns, each model does one thing well. Pass 1 uses the cheaper Flash-Lite because garment identification is straightforward. Pass 2 uses the more capable Flash because aesthetic classification requires nuanced cultural and stylistic reasoning.

**Python analogy**: This is like a two-step NLP pipeline:
```python
# Step 1: Named Entity Recognition (extract concrete items)
entities = ner_model.predict(text)  # ["blazer", "turtleneck", "oxford shoes"]

# Step 2: Classification (categorise based on extracted items)
category = classifier.predict(entities)  # "Dark Academia"
```

---

## 3. Pass 1: Garment Detection (Gemini 2.5 Flash-Lite)

**Model**: `gemini-2.5-flash-lite`  
**System instruction**: `GARMENT_SYSTEM_INSTRUCTION` (defined in `server/routes.ts`)  
**Input**: Base64-encoded image  
**Output schema**: `GARMENT_SCHEMA`

### What `GARMENT_SYSTEM_INSTRUCTION` Says

The system instruction tells Gemini to act as a fashion item detector:

> "You are a precise fashion item detector. Identify every garment and accessory visible in the image. For each item, describe: the item type, color, visible fabric/material, fit (oversized/slim/regular/etc.), and any notable style details (distressing, embroidery, brand logos, etc.). Also note the overall color palette and the perceived gender presentation of the outfit."

### `GARMENT_SCHEMA` — Structured Output

Gemini is forced to return JSON matching this schema:

```typescript
const GARMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    garments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          item: { type: "STRING" },       // e.g. "blazer"
          color: { type: "STRING" },      // e.g. "forest green"
          fabric: { type: "STRING" },     // e.g. "corduroy"
          fit: { type: "STRING" },        // e.g. "oversized"
          details: { type: "STRING" },    // e.g. "gold button accents, peak lapel"
        },
        required: ["item", "color", "fit"],
      }
    },
    overallPalette: {
      type: "ARRAY",
      items: { type: "STRING" },           // hex colours, e.g. "#2C4A2E"
    },
    layering: { type: "STRING" },          // e.g. "blazer over turtleneck"
    perceivedGender: {
      type: "STRING",
      enum: ["masculine", "feminine", "androgynous/neutral", "ambiguous"],
    },
  },
  required: ["garments", "perceivedGender"],
};
```

### Example Pass 1 Output

For a dark academia outfit photo:
```json
{
  "garments": [
    {
      "item": "blazer",
      "color": "dark brown",
      "fabric": "tweed",
      "fit": "oversized",
      "details": "three-button closure, patch elbow pads"
    },
    {
      "item": "turtleneck sweater",
      "color": "cream",
      "fabric": "knit wool",
      "fit": "fitted",
      "details": "ribbed texture"
    },
    {
      "item": "wide-leg trousers",
      "color": "dark brown",
      "fabric": "wool blend",
      "fit": "wide-leg",
      "details": "high-waisted, pressed crease"
    }
  ],
  "overallPalette": ["#4A3020", "#F5F0E8", "#2C1810"],
  "layering": "turtleneck under oversized blazer",
  "perceivedGender": "androgynous/neutral"
}
```

This structured output is passed directly into Pass 2.

---

## 4. Pass 2: Aesthetic Classification (Gemini 2.5 Flash)

**Model**: `gemini-2.5-flash`  
**System instruction**: `SYSTEM_INSTRUCTION` (very long — 41 aesthetics with detailed descriptions)  
**Input**: Pass 1 garment data + original image  
**Output schema**: `ANALYSIS_SCHEMA`

### `SYSTEM_INSTRUCTION` — The 41-Aesthetic Prompt

The system instruction is the most important piece of prompt engineering in the codebase. It is a detailed guide to Stitch's aesthetic taxonomy:

```
You are Stitch, an expert fashion aesthetics analyst with deep knowledge of contemporary 
style movements, subcultures, and fashion communities. Your task is to analyse outfit 
images and classify them into specific aesthetic categories.

You have identified the following garments in the image:
{garmentSummary}  ← injected from Pass 1

Below are the 41 aesthetics you can assign. Read their descriptions carefully before 
making your classification:

QUIET LUXURY
Definition: Understated, high-quality clothing that signals wealth without logos. 
Think The Row, Brunello Cucinelli. Neutral colour palette (beige, cream, camel, navy, 
white, black). Cashmere, silk, fine wool, leather. Tailored silhouettes...

STREETWEAR
Definition: Urban casual wear rooted in skateboarding, hip-hop, and youth culture. 
Bold graphics, oversized fits, athletic wear integrated into fashion. Hoodies, 
cargo pants, sneakers, caps...

DARK ACADEMIA
Definition: Intellectually-romanticised aesthetic drawing from Oxbridge, literature, 
and gothic romance. Neutral tones: brown, burgundy, black, forest green, cream. 
Blazers, turtlenecks, plaid, loafers, trench coats...

[... 38 more detailed descriptions ...]

Your response MUST follow the JSON schema provided. Choose PRIMARY and SECONDARY 
aesthetics from the exact list provided. Confidence should reflect how clearly 
the outfit fits the primary aesthetic.
```

**Why such a detailed system prompt?** Gemini knows fashion aesthetics in general, but Stitch has a specific 41-item taxonomy. Without explicit descriptions, Gemini would use its own understanding of "dark academia" which might not match the app's definition. The detailed prompt locks Gemini into Stitch's exact classification system.

### `ANALYSIS_SCHEMA` — Structured Output

```typescript
const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    visualSignals: {
      type: "ARRAY",
      items: { type: "STRING" },
      // e.g. ["tweed blazer with elbow pads", "turtleneck layering", "dark earth tones"]
    },
    evidenceStrength: {
      type: "STRING",
      enum: ["strong", "moderate", "weak"],
    },
    aesthetic: {
      type: "STRING",
      enum: [/* all 41 aesthetic names */],
    },
    secondaryAesthetic: {
      type: "STRING",
      enum: [/* all 41 aesthetic names */],
    },
    confidence: {
      type: "INTEGER",
      minimum: 0,
      maximum: 100,
    },
    styleBreakdown: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },  // aesthetic name
          pct: { type: "INTEGER" },   // percentage (0-100)
        },
      },
      // e.g. [{"label": "Dark Academia", "pct": 75}, {"label": "Vintage", "pct": 25}]
    },
    occasions: {
      type: "ARRAY",
      items: { type: "STRING" },
      // e.g. ["Library", "Autumn Walk", "University Class"]
    },
    keyPieces: {
      type: "ARRAY",
      items: { type: "STRING" },
      // e.g. ["Tweed blazer", "Ribbed turtleneck", "Wide-leg trousers"]
    },
    colorPalette: {
      type: "ARRAY",
      items: { type: "STRING" },
      // hex colours, e.g. ["#4A3020", "#F5F0E8"]
    },
    outfitRecs: {
      type: "ARRAY",
      items: { type: "STRING" },
      // styling suggestions
    },
    similarRecs: {
      type: "ARRAY",
      items: { type: "STRING" },
      // similar aesthetic inspirations
    },
    depopQueries: {
      type: "ARRAY",
      items: { type: "STRING" },
      // search queries to run on Depop, e.g. ["dark academia blazer women", ...]
    },
  },
  required: ["aesthetic", "confidence", "styleBreakdown", "depopQueries"],
};
```

### Example Pass 2 Output

```json
{
  "visualSignals": [
    "tweed blazer with elbow patches",
    "cream ribbed turtleneck layering",
    "earth tone colour palette",
    "high-waisted wide-leg trousers with press crease"
  ],
  "evidenceStrength": "strong",
  "aesthetic": "Dark Academia",
  "secondaryAesthetic": "Classic / Timeless",
  "confidence": 87,
  "styleBreakdown": [
    {"label": "Dark Academia", "pct": 75},
    {"label": "Classic / Timeless", "pct": 15},
    {"label": "Vintage / Thrift", "pct": 10}
  ],
  "occasions": ["University", "Library Session", "Autumn Walk", "Study Date"],
  "keyPieces": ["Tweed blazer", "Cream turtleneck", "Wide-leg trousers"],
  "colorPalette": ["#4A3020", "#F5F0E8", "#2C1810", "#8B6F47"],
  "outfitRecs": ["Add a leather satchel", "Try brogues or Oxford shoes", "Layer a long wool coat"],
  "depopQueries": [
    "dark academia tweed blazer women",
    "cream ribbed turtleneck vintage",
    "wide leg trousers dark academia",
    "oxford shoes dark academia women",
    "dark academia outfit set"
  ]
}
```

The `depopQueries` field is fed directly into the Depop search system to find matching products.

---

## 5. The 41 Aesthetics Taxonomy

The complete list of aesthetics Stitch recognises:

| # | Aesthetic | Character |
|---|-----------|-----------|
| 1 | Quiet Luxury | Understated, logoless, expensive fabrics |
| 2 | Clean Fit | Simple, well-fitted, everyday fashion |
| 3 | Classic / Timeless | Wardrobe staples, never trendy |
| 4 | Coquette | Feminine, bows, lace, pink — flirtatious romanticism |
| 5 | Soft Girl / Kawaii | Pastel, cute, youthful, anime-adjacent |
| 6 | Pink Pilates / Wellness | Athleisure meets wellness culture, pastels |
| 7 | Dark Feminine | Sensual, dramatic, dark colours, confident |
| 8 | Old School Preppy | Classic Ivy League: polos, loafers, cable knit |
| 9 | Modern Preppy | Updated preppy: mixing classic with contemporary |
| 10 | Streetwear | Urban casual, hoodies, cargo, sneakers |
| 11 | Hypebeast | Exclusive streetwear, drops culture, logos |
| 12 | Skatecore | Skate culture: baggy denim, graphic tees, Vans |
| 13 | Techwear | Functional, tactical, waterproof, muted tones |
| 14 | Baddie | Instagram-polish, curves, bodycon, bold |
| 15 | Cottagecore | Rural fantasy, florals, linen, pastoral |
| 16 | Dark Academia | Gothic intellectualism, tweed, libraries |
| 17 | Fairycore | Whimsical, ethereal, fairy-tale dressing |
| 18 | Gorpcore | Outdoor gear as fashion: fleece, Gore-Tex |
| 19 | Y2K | Early 2000s revival: low-rise, metallic, logo |
| 20 | 90s Grunge | Flannel, band tees, ripped denim |
| 21 | 70s-80s Retro | Disco, flare legs, bold prints |
| 22 | Vintage / Thrift | Secondhand, eclectic, decade-mixed |
| 23 | Maximalist | More is more: clashing prints, layers, colour |
| 24 | Glam / Party | Sequins, bodycon, heels, night-out |
| 25 | Rave | Festival wear: neon, mesh, body jewellery |
| 26 | E-Girl / Alt | Alt internet culture: chains, plaid, dark |
| 27 | Office Siren | Power dressing: blazer sets, tailored, sultry |
| 28 | Occasion Wear | Formal events: gowns, suits, cocktail dresses |
| 29 | Athleisure | Gym-to-street: leggings, sports luxe |
| 30 | Blokecore | Football casual: jerseys, Adidas, working class |
| 31 | Goth | Full gothic: black, velvet, fishnets, platforms |
| 32 | Grunge / Punk | Rebellious: spikes, leather, band tees |
| 33 | Bohemian | Free-spirited: flowy, earthy, layered |
| 34 | Western / Americana | Cowboys: denim, boots, plaid, belt buckles |
| 35 | K-Fashion | Korean fashion: oversized, clean, trendy |
| 36 | Retro-Futurism | Sci-fi past: metallic, geometric, futuristic |
| 37 | Historical Romanticism | Period-inspired: Victorian, Renaissance |
| 38 | Blokette | Blokecore + feminine: football kits with mini skirts |
| 39 | Indie Sleaze | 2008-era indie: American Apparel, lo-fi |
| 40 | Light Academia | Lighter version of Dark Academia: pastels, poetry |
| 41 | Granola Girl | Outdoorsy, natural: fleece, hiking boots, earthy |

### `FEMALE_ONLY_AESTHETICS`

Some aesthetics are inherently gendered. The `FEMALE_ONLY_AESTHETICS` set is used to prevent female-coded searches from appearing in male-profile feeds:

```typescript
const FEMALE_ONLY_AESTHETICS = new Set([
  "Coquette",
  "Soft Girl",       // Note: listed as "Soft Girl / Kawaii" in full taxonomy
  "Cottagecore",
  "Coastal Grandmother",  // Not in 41 — legacy entry
  "E-Girl",              // Note: listed as "E-Girl / Alt" in full taxonomy
  "Clean Girl",          // Legacy entry
  "Balletcore",          // Legacy entry
  "Romantic",            // Legacy entry
  "Fairycore",
]);
```

**Important**: This set uses simplified names, not the full taxonomy names. The gender filtering code in `storage.ts` checks whether the cache row's `aesthetic` field contains any of these strings (substring match, not exact match).

---

## 6. Retry Logic & Error Handling

Gemini API calls can fail with rate limit (429) or resource exhaustion (503, `RESOURCE_EXHAUSTED`) errors. The `geminiWithRetry()` function handles this:

```typescript
async function geminiWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRetryable =
        error.status === 503 ||
        error.status === 429 ||
        error.message?.includes("RESOURCE_EXHAUSTED");

      if (isRetryable && attempt < maxAttempts) {
        const delay = attempt === 1 ? 2000 : 4000;  // 2s, then 4s
        console.log(`Gemini attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;  // Non-retryable error or out of attempts
    }
  }
  throw new Error("Unreachable");
}
```

**Python equivalent**:
```python
import time
import functools

def gemini_with_retry(fn, max_attempts=3):
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except (RateLimitError, ServiceUnavailableError) as e:
            if attempt < max_attempts:
                delay = 2 if attempt == 1 else 4
                print(f"Attempt {attempt} failed, retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise
```

**Usage**:
```typescript
// Pass 1 (inside route handler)
const pass1Result = await geminiWithRetry(() =>
  geminiFlashLite.generateContent({
    contents: [{ role: "user", parts: [imagePart, { text: "Identify garments." }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: GARMENT_SCHEMA },
    systemInstruction: GARMENT_SYSTEM_INSTRUCTION,
  })
);

// Pass 2
const pass2Result = await geminiWithRetry(() =>
  geminiFlash.generateContent({
    contents: [{ role: "user", parts: [imagePart, { text: garmentSummary }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: ANALYSIS_SCHEMA },
    systemInstruction: filledSystemInstruction,
  })
);
```

---

## 7. OpenAI Embeddings System

**Model**: `text-embedding-3-small`  
**Dimensions**: 1536  
**Cost**: ~$0.02 per million tokens (~$0.01 per 4,000 rows of cache)

### What Gets Embedded

Two things are embedded:

**1. `depop_cache` rows** — The text `"{query}: title1, title2, title3, title4, title5"`:
```
"dark academia tweed blazer women: Vintage 90s tweed blazer dark academia, 
Brown oversized blazer academia aesthetic, Dark academia blazer corduroy, 
Vintage herringbone women blazer, Checkered blazer academia thrift"
```

**2. User onboarding picks** — The names of selected aesthetics joined together:
```
"Dark Academia Cottagecore Vintage / Thrift"
```

### Why Embed Query + Titles?

The query alone ("dark academia tweed blazer") encodes search intent. The titles encode what actually appears in results. Together, the embedding captures both dimensions — meaning you can find rows where the search is semantically similar AND the actual listings are semantically similar.

If a user's taste vector is in "Dark Academia" territory, they'll get matched with cache rows whose content (query + titles) is also in that territory.

### Embedding API Call

```typescript
// From server/routes.ts or storage.ts
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getEmbedding(text: string): Promise<number[]> {
  const normalised = normalizeForEmbedding(text);  // strip brand names first
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: normalised,
  });
  return response.data[0].embedding;  // 1536 floats
}
```

**Python equivalent**:
```python
from openai import OpenAI

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

def get_embedding(text: str) -> list[float]:
    normalized = normalize_for_embedding(text)
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=normalized,
    )
    return response.data[0].embedding  # list of 1536 floats
```

### Storing Embeddings in PostgreSQL

```typescript
const embedding = await getEmbedding(embedText);

await sql`
  UPDATE depop_cache
  SET embedding = ${JSON.stringify(embedding)}::vector
  WHERE query = ${query}
`;
```

The `::vector` cast tells pgvector to interpret the JSON array as a vector type. Without the cast, PostgreSQL doesn't know what to do with the array string.

---

## 8. The Taste Vector System

The taste vector is the core of personalisation. Every user has a 1536-dimensional vector in `user_profiles.taste_vector` that evolves as they interact with content.

### Initialisation (Onboarding)

When a user completes the quiz and picks their aesthetics, `getAverageEmbeddingForAesthetics()` is called:

```typescript
async function getAverageEmbeddingForAesthetics(aestheticNames: string[]): Promise<number[]> {
  // Get embedding for each selected aesthetic name
  const embeddings = await Promise.all(
    aestheticNames.map(name => getEmbedding(name))
  );

  // Average them element-wise
  const avg = new Array(1536).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < 1536; i++) {
      avg[i] += emb[i] / embeddings.length;
    }
  }

  // Normalise to unit length
  const magnitude = Math.sqrt(avg.reduce((sum, v) => sum + v * v, 0));
  return avg.map(v => v / magnitude);
}
```

**Python equivalent**:
```python
import numpy as np

def get_average_embedding_for_aesthetics(aesthetic_names: list[str]) -> list[float]:
    embeddings = [get_embedding(name) for name in aesthetic_names]
    avg = np.mean(embeddings, axis=0)  # element-wise average
    return (avg / np.linalg.norm(avg)).tolist()  # normalise
```

This initial vector is stored in `user_profiles.taste_vector` before any real interactions.

### Interaction Update (Like/Skip/Save)

Each time a user interacts with a listing, the backend:
1. Gets the embedding for that listing's cache row
2. Updates the taste vector with a weighted running average

```typescript
// Interaction weights
const WEIGHTS = { save: 3, like: 1, skip: -0.5 };

async function updateTasteVector(
  userId: string,
  itemEmbedding: number[],
  type: "save" | "like" | "skip"
): Promise<void> {
  const profile = await getUserProfile(userId);
  const n = profile.interactionCount;
  const oldVec = profile.tasteVector as number[];
  const weight = WEIGHTS[type];

  // Weighted running average formula:
  // new_vec[i] = (old_vec[i] * n + item_embedding[i] * weight) / (n + |weight|)
  const newVec = oldVec.map((v, i) =>
    (v * n + itemEmbedding[i] * weight) / (n + Math.abs(weight))
  );

  // Normalise to unit length (required for cosine similarity)
  const mag = Math.sqrt(newVec.reduce((s, v) => s + v * v, 0));
  const normalised = newVec.map(v => v / mag);

  await sql`
    UPDATE user_profiles
    SET
      taste_vector = ${JSON.stringify(normalised)}::vector,
      interaction_count = ${n + 1},
      liked_ids = ${type === "skip" ? sql`liked_ids` : sql`array_append(liked_ids, ${itemId})`},
      skipped_ids = ${type === "skip" ? sql`array_append(skipped_ids, ${itemId})` : sql`skipped_ids`},
      updated_at = NOW()
    WHERE user_id = ${userId}
  `;
}
```

### Why These Weights?

| Interaction | Weight | Rationale |
|------------|--------|-----------|
| Save (+3) | Strong positive | User wants to buy this — maximum signal |
| Like (+1) | Moderate positive | User liked the look but maybe won't buy |
| Skip (-0.5) | Weak negative | User wasn't interested — gentle correction |

Skip is weak because users often skip due to price or availability, not because they dislike the aesthetic. Making skip as strong as like would corrupt the taste vector too quickly.

### Normalisation — Why It Matters

After computing the weighted average, the vector is normalised to unit length (magnitude = 1). This is required for cosine similarity to work correctly.

**Intuition**: Cosine similarity measures the *angle* between two vectors, not their length. If one vector has magnitude 100 and another has magnitude 1, cosine similarity still gives you the angle. But if you use inner product (`<#>`) instead of cosine distance (`<=>`), the magnitudes matter. Normalising ensures consistent cosine distances.

```python
import numpy as np

# Non-normalised vectors — same direction, different lengths
a = np.array([3.0, 4.0])   # magnitude 5
b = np.array([0.6, 0.8])   # magnitude 1

# Cosine similarity — same angle, so similarity = 1.0 (identical direction)
cos_sim = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
# cos_sim = 1.0 — correct even without normalisation

# But pgvector's <=> uses normalised dot product internally
# Storing normalised vectors ensures <=> gives the right results
a_norm = a / np.linalg.norm(a)  # [0.6, 0.8]
b_norm = b / np.linalg.norm(b)  # [0.6, 0.8]
# Now a_norm == b_norm, distance = 0 ✓
```

---

## 9. Gender Filtering & Detection

### Listing-Level Gender Tagging

Every Depop listing is tagged with a gender when it's stored in `depop_cache.listings`. The tagging uses regex on the listing title and URL slug:

```typescript
// From server/storage.ts
const EXPLICIT_FEMALE = /\b(women[''']?s?|woman|womans|womena|ladies|lady|girls?|female|womenswear)\b/i;
const EXPLICIT_MALE = /\b(men[''']?s?|man|male|boys?|menswear)\b/i;

function listingText(title: string, url: string): string {
  // Extract word-like tokens from URL slug
  const slugWords = url
    .split("/")
    .pop()                          // last path segment
    ?.replace(/-/g, " ") ?? "";    // "dark-academia-blazer-women" → "dark academia blazer women"
  return `${title} ${slugWords}`;
}

function detectGender(title: string, url: string): "male" | "female" | "both" {
  const text = listingText(title, url);
  const isFemale = EXPLICIT_FEMALE.test(text);
  const isMale = EXPLICIT_MALE.test(text);

  if (isFemale && isMale) return "both";   // unisex brand collab etc.
  if (isFemale) return "female";
  if (isMale) return "male";
  return "both";  // No explicit signal → treat as unisex
}
```

**Why default to "both" when no signal?** Many Depop listings don't mention gender (e.g., "vintage denim jacket" with no gender indicator). Defaulting to "female" or "male" would wrongly exclude listings from half the user base. "Both" shows these listings to everyone.

### Depop Query-Level Gender Filtering

When building Depop search queries, gender context is added based on the user's profile:

```typescript
function addGenderToQuery(baseQuery: string, userGender: string, aesthetic: string): string {
  // Don't add gender to female-only aesthetics for non-female users
  if (FEMALE_ONLY_AESTHETICS.has(aesthetic) && userGender !== "female") {
    return baseQuery;  // Don't filter — will just return few/no results naturally
  }

  if (userGender === "male") return `${baseQuery} men`;
  if (userGender === "female") return `${baseQuery} women`;
  return baseQuery;  // "both" → no gender suffix
}
```

### Feed-Level Filtering

The For You feed query filters listings by gender:

```sql
-- For a female user
SELECT dc.query, dc.listings, dc.aesthetic
FROM depop_cache dc
CROSS JOIN (SELECT taste_vector FROM user_profiles WHERE user_id = $1) up
WHERE dc.embedding IS NOT NULL
  -- Filter: include listings where at least one listing matches the gender
  -- (implemented in application layer after fetch, not in SQL for JSONB filtering complexity)
ORDER BY dc.embedding <=> up.taste_vector::vector
LIMIT 50;
```

After fetching, the application layer filters `listings` arrays:
```typescript
const filtered = cacheRow.listings.filter(listing =>
  listing.gender === userGender || listing.gender === "both"
);
```

---

## 10. For You Feed: Semantic Search

The For You feed is powered by pgvector cosine similarity search. Here's the complete flow:

```
User opens For You tab
        │
        ▼
GET /api/for-you?userId=xxx&gender=female
        │
        ▼
storage.getForYouListings(userId, gender)
        │
        ▼
SQL: SELECT depop_cache rows
     ORDER BY embedding <=> user_taste_vector
     LIMIT 50
        │
        ▼
For each row: filter listings by gender
        │
        ▼
Return flattened listing array (shuffled slightly for freshness)
```

**The key SQL**:
```sql
SELECT
  dc.id,
  dc.query,
  dc.listings,
  dc.aesthetic,
  dc.garment_type,
  dc.embedding <=> up.taste_vector::vector AS cosine_distance
FROM depop_cache dc
CROSS JOIN (
  SELECT taste_vector
  FROM user_profiles
  WHERE user_id = $1
) up
WHERE
  dc.embedding IS NOT NULL
  AND dc.listings IS NOT NULL
  AND jsonb_array_length(dc.listings) > 0
ORDER BY cosine_distance ASC
LIMIT 50;
```

`CROSS JOIN` with a single-row subquery is the pattern for joining each depop_cache row against the user's single taste_vector row.

**Python analogy** (without pgvector):
```python
import numpy as np

def get_for_you_listings(user_taste_vector, all_cache_rows):
    # Compute cosine distance between taste vector and each cache row embedding
    results = []
    for row in all_cache_rows:
        if row.embedding is None:
            continue
        embedding = np.array(row.embedding)
        taste = np.array(user_taste_vector)
        distance = 1 - np.dot(taste, embedding)  # cosine distance (vectors normalised)
        results.append((distance, row))
    
    # Sort by distance (ascending = most similar first)
    results.sort(key=lambda x: x[0])
    return [row for _, row in results[:50]]
```

---

## 11. Discover Cards: Reddit → Gemini Pipeline

The Discover page feeds outfit images from Reddit through Gemini for aesthetic classification.

### `fetchSubredditImages()` Flow

```typescript
async function fetchSubredditImages(subreddit: string, limit = 20): Promise<RedditPost[]> {
  // Reddit has a public JSON API — no auth needed for public subreddits
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "StitchApp/1.0" }
  });
  const data = await response.json();

  return data.data.children
    .map((child: any) => child.data)
    .filter((post: any) =>
      post.url &&
      (post.url.match(/\.(jpg|jpeg|png|webp)$/i) || post.url.includes("i.redd.it"))
    )
    .map((post: any) => ({
      imageUrl: post.url,
      postUrl: `https://reddit.com${post.permalink}`,
      subreddit,
      title: post.title,
    }));
}
```

### Gemini Analysis of Reddit Images

Each fetched image URL is then analysed by Gemini (Pass 2 only, no garment pass for discover cards):

```typescript
for (const post of redditPosts) {
  // Check if already in DB
  const existing = await db.select()
    .from(schema.discoverCards)
    .where(eq(schema.discoverCards.postUrl, post.postUrl));
  if (existing.length > 0) continue;

  // Analyse with Gemini
  const analysis = await geminiWithRetry(() =>
    analyseImageUrl(post.imageUrl)  // Fetches image, sends to Gemini
  );

  // Store in DB
  await db.insert(schema.discoverCards).values({
    imageUrl: post.imageUrl,
    aesthetic: analysis.aesthetic,
    confidence: analysis.confidence,
    styleBreakdown: JSON.stringify(analysis.styleBreakdown),
    keyPieces: JSON.stringify(analysis.keyPieces),
    colorPalette: JSON.stringify(analysis.colorPalette),
    tags: JSON.stringify(analysis.tags || []),
    source: "reddit",
    postUrl: post.postUrl,
    subreddit: post.subreddit,
    likesCount: 0,
  });
}
```

### Subreddit Map

```typescript
const SUBREDDIT_MAP: Record<string, string> = {
  "femalefashionadvice": "Clean Fit",
  "malefashionadvice": "Clean Fit",
  "streetwear": "Streetwear",
  "darkacademia": "Dark Academia",
  "cottagecore": "Cottagecore",
  "Vintagefashion": "Vintage / Thrift",
  "femalefashion": "Baddie",
  "goodyearwelt": "Classic / Timeless",
  // ...more
};
```

The `aesthetic` field in this map is used to tag the discover cards with a predicted aesthetic before Gemini analysis, and to seed the right subreddits for each aesthetic.

---

## 12. `normalizeForEmbedding()` — Brand Stripping

Before computing embeddings, brand names are stripped from queries. This is critical for semantic clustering to work properly.

**The problem without normalisation**:
- "Nike dark academia blazer" → embedded near other Nike queries
- "Zara dark academia blazer" → embedded near other Zara queries
- These two queries describe the same *aesthetic* but would appear as semantically different

**With normalisation**:
- "dark academia blazer" → embedded near other dark academia queries ✓

```typescript
const BRANDS = new Set([
  "nike", "zara", "h&m", "hm", "asos", "shein", "boohoo", "prettylittlething",
  "topshop", "urban outfitters", "free people", "anthropologie", "revolve",
  "levi", "levis", "levi's", "wrangler", "lee", "gap", "old navy", "banana republic",
  "ralph lauren", "tommy hilfiger", "calvin klein", "lacoste", "burberry",
  "gucci", "prada", "louis vuitton", "chanel", "saint laurent", "balenciaga",
  "adidas", "puma", "new balance", "converse", "vans", "dr martens",
  // ... 200+ more
]);

function normalizeForEmbedding(text: string): string {
  const words = text.toLowerCase().split(/\s+/);
  const filtered = words.filter(word => !BRANDS.has(word.replace(/['']/g, "")));
  return filtered.join(" ").trim();
}
```

---

## 13. Gemini Structured Output (JSON Schemas)

Gemini's structured output feature forces the model to return valid JSON matching a provided schema. This is set via `responseMimeType: "application/json"` and `responseSchema`.

**Why this matters**: Without structured output, Gemini might add prose ("Here is the analysis:"), wrap JSON in markdown code blocks, or omit optional fields. Structured output guarantees parseable JSON every time.

```typescript
const response = await geminiFlash.generateContent({
  contents: [...],
  generationConfig: {
    responseMimeType: "application/json",     // Force JSON output
    responseSchema: ANALYSIS_SCHEMA,          // Enforce this exact structure
    temperature: 0.2,                         // Low temperature = more deterministic
  },
  systemInstruction: SYSTEM_INSTRUCTION,
});

// Parse the response
const text = response.response.text();
const analysis = JSON.parse(text);  // Always valid JSON due to structured output
```

**Temperature 0.2**: Lower temperature means less creative/random outputs. For classification tasks (this is definitely Dark Academia) you want determinism. Creative tasks would use higher temperature.

**Python equivalent** (using google-generativeai):
```python
import google.generativeai as genai

model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    generation_config=genai.GenerationConfig(
        response_mime_type="application/json",
        response_schema=ANALYSIS_SCHEMA,
        temperature=0.2,
    ),
    system_instruction=SYSTEM_INSTRUCTION,
)

response = model.generate_content([image_part, text_part])
analysis = json.loads(response.text)
```

---

## 14. AI Costs & Model Selection Rationale

### Cost Breakdown (approximate)

| Operation | Model | Cost per Call | Calls per Day |
|-----------|-------|--------------|---------------|
| Pass 1 (garment detection) | gemini-2.5-flash-lite | ~$0.0003 | ~50 |
| Pass 2 (aesthetic analysis) | gemini-2.5-flash | ~$0.002 | ~50 |
| OpenAI embedding (scan queries) | text-embedding-3-small | ~$0.00001 | ~250 |
| OpenAI embedding (taste update) | text-embedding-3-small | ~$0.00001 | ~500 |
| Discover card analysis | gemini-2.5-flash | ~$0.002 | ~100 |

At low traffic, the total AI cost is roughly **$0.30–1.00/day**. The most expensive operations are the two Gemini passes per scan.

### Why Not One Gemini Model?

**Flash-Lite (Pass 1)**: Cheaper, fast. Good enough for concrete visual tasks — "what items are visible?" doesn't require deep reasoning.

**Flash (Pass 2)**: More capable, costs more. Aesthetic classification is genuinely hard — it requires cultural knowledge, understanding of how garments interact, and nuanced judgment. Flash's stronger reasoning is worth the cost.

**Why not Gemini Pro?**: Pro costs ~10x more than Flash. At this stage of development, Flash gives 90%+ of Pro's accuracy at 10% of the cost.

### Why OpenAI Embeddings Instead of Gemini?

Google offers embeddings via `textembedding-gecko`, but `text-embedding-3-small` has:
- Larger context window
- More widely tested for semantic search tasks
- Consistent 1536-dim output (matches the schema already set up)
- Very low cost ($0.02/million tokens)

Once you pick an embedding model, you can't switch without re-embedding every row (7,700+ rows). The choice is sticky — choose carefully.

### `gemini-2.5-flash-lite` vs `gemini-2.5-flash` in Code

```typescript
// Two separate model instances in routes.ts
const geminiFlashLite = genai.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
});

const geminiFlash = genai.getGenerativeModel({
  model: "gemini-2.5-flash",
});

// Pass 1 uses flash-lite
const garmentResult = await geminiWithRetry(() =>
  geminiFlashLite.generateContent(pass1Request)
);

// Pass 2 uses flash
const analysisResult = await geminiWithRetry(() =>
  geminiFlash.generateContent(pass2Request)
);
```
