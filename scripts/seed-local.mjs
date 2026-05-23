#!/usr/bin/env node
/**
 * seed-local.mjs — Add fresh Depop listings to the cache using your browser cookies.
 *
 * Usage:
 *   DEPOP_COOKIE="..." node scripts/seed-local.mjs
 *
 * To get your cookie string:
 *   1. Go to depop.com and search for anything
 *   2. DevTools → Network → find a GET request to www.depop.com/api/v3/search/products/
 *   3. Right-click → Copy as cURL
 *   4. Extract the -b "..." cookie string and set it as DEPOP_COOKIE env var
 *
 * Optionally override queries by editing SEED_QUERIES below.
 */

import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL || "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const COOKIE = process.env.DEPOP_COOKIE;
const DEVICE_ID = process.env.DEPOP_DEVICE_ID || "89954962-57bb-4300-bef7-91339e5f8281";
const SESSION_ID = process.env.DEPOP_SESSION_ID || "7262fa1b-fdd7-43d4-adc5-222dacd93f5e";
const ITEMS_PER_QUERY = parseInt(process.env.ITEMS_PER_QUERY || "12");
const DELAY_MS = 2500; // be polite

if (!COOKIE) {
  console.error("❌  Set DEPOP_COOKIE env var first. See usage comment at top of file.");
  process.exit(1);
}

// ── Queries to seed ──────────────────────────────────────────────────────────
// Each entry: { query, aesthetic, garmentType }
// Add or remove queries here as needed.
const SEED_QUERIES = [
  // Streetwear — mens
  { query: "mens streetwear cargo pants", aesthetic: "Streetwear", garmentType: "bottoms" },
  { query: "mens oversized graphic hoodie", aesthetic: "Streetwear", garmentType: "tops" },
  { query: "mens baggy jeans streetwear", aesthetic: "Streetwear", garmentType: "bottoms" },
  { query: "mens jordan sneakers", aesthetic: "Streetwear", garmentType: "shoes" },
  { query: "mens bomber jacket streetwear", aesthetic: "Streetwear", garmentType: "outerwear" },
  // Minimalist — mens
  { query: "mens minimalist linen shirt", aesthetic: "Minimalist", garmentType: "tops" },
  { query: "mens slim fit chinos", aesthetic: "Minimalist", garmentType: "bottoms" },
  { query: "mens white leather sneakers", aesthetic: "Minimalist", garmentType: "shoes" },
  { query: "mens neutral toned coat", aesthetic: "Minimalist", garmentType: "outerwear" },
  // Vintage / Old Money — mens
  { query: "mens vintage polo shirt", aesthetic: "Vintage", garmentType: "tops" },
  { query: "mens vintage blazer", aesthetic: "Old Money", garmentType: "outerwear" },
  { query: "mens vintage corduroy pants", aesthetic: "Vintage", garmentType: "bottoms" },
  { query: "mens preppy sweater vest", aesthetic: "Preppy", garmentType: "tops" },
  // Y2K — mens
  { query: "mens y2k windbreaker", aesthetic: "Y2K", garmentType: "outerwear" },
  { query: "mens y2k baggy jeans", aesthetic: "Y2K", garmentType: "bottoms" },
  // Dark Academia — mens
  { query: "mens dark academia trench coat", aesthetic: "Dark Academia", garmentType: "outerwear" },
  { query: "mens dark academia turtleneck", aesthetic: "Dark Academia", garmentType: "tops" },
  // Techwear — mens
  { query: "mens techwear jacket", aesthetic: "Techwear", garmentType: "outerwear" },
  { query: "mens techwear cargo pants", aesthetic: "Techwear", garmentType: "bottoms" },
  // Grunge / Skater — mens
  { query: "mens grunge flannel shirt", aesthetic: "Grunge", garmentType: "tops" },
  { query: "mens skater jeans", aesthetic: "Skater", garmentType: "bottoms" },
  { query: "mens vans skate shoes", aesthetic: "Skater", garmentType: "shoes" },
  // Boho — mens
  { query: "mens boho linen pants", aesthetic: "Boho", garmentType: "bottoms" },
];

// ── DB helpers ────────────────────────────────────────────────────────────────
const sql = postgres(DB_URL, { ssl: { rejectUnauthorized: false }, prepare: false });

async function getCached(query) {
  const rows = await sql`SELECT query FROM depop_cache WHERE query = ${query}`;
  return rows.length > 0;
}

async function upsertCache(query, listings, aesthetic, garmentType) {
  await sql`
    INSERT INTO depop_cache (query, listings, aesthetic, permanent, garment_type, created_at)
    VALUES (${query}, ${JSON.stringify(listings)}, ${aesthetic}, true, ${garmentType}, NOW())
    ON CONFLICT (query) DO UPDATE SET
      listings = EXCLUDED.listings,
      aesthetic = EXCLUDED.aesthetic,
      garment_type = EXCLUDED.garment_type,
      created_at = NOW()
  `;
}

// ── Depop fetch ───────────────────────────────────────────────────────────────
async function fetchDepop(query, limit) {
  const url = `https://www.depop.com/api/v3/search/products/?` +
    `what=${encodeURIComponent(query)}&items_per_page=${limit}&country=us&currency=USD` +
    `&from=in_country_search&include_like_count=true&force_fee_calculation=false`;

  const res = await fetch(url, {
    headers: {
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/json",
      "cookie": COOKIE,
      "depop-device-id": DEVICE_ID,
      "depop-session-id": SESSION_ID,
      "origin": "https://www.depop.com",
      "referer": `https://www.depop.com/search/?q=${encodeURIComponent(query)}`,
      "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      "x-cached-sizes": "true",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.products || data.objects || []);
}

function normalise(item, query) {
  const slug = item.slug || "";
  const slugTitle = slug.replace(/-/g, " ").replace(/^[a-z0-9]+ /, "").trim();
  const title = item.title || item.name || slugTitle || item.description || "";
  const preview = item.preview?.[0] || item.pictures?.[0];
  const image = preview?.url || preview?.src || item.previewSmall?.[0]?.url || "";
  const price = item.price?.priceAmount
    ? `$${(parseInt(item.price.priceAmount) / 100).toFixed(2)}`
    : item.pricing?.original_price?.total_price
    ? `$${item.pricing.original_price.total_price}`
    : "";
  const seller = item.seller?.username || item.sellerUsername || "";
  const productSlug = item.slug || "";
  const url = productSlug ? `https://www.depop.com/products/${productSlug}/` : "";
  return { title, image, price, url, seller, slug: productSlug, query };
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n🪡  Stitch Cache Seeder — ${SEED_QUERIES.length} queries, ${ITEMS_PER_QUERY} items each\n`);
let seeded = 0, skipped = 0, failed = 0;

for (const { query, aesthetic, garmentType } of SEED_QUERIES) {
  const alreadyCached = await getCached(query);
  if (alreadyCached) {
    console.log(`  ⏭  skip  "${query}" (already cached)`);
    skipped++;
    continue;
  }

  process.stdout.write(`  ⬇  fetch "${query}" ... `);
  try {
    const raw = await fetchDepop(query, ITEMS_PER_QUERY);
    const listings = raw.map(i => normalise(i, query)).filter(l => l.image && l.url);
    if (listings.length === 0) {
      console.log(`0 results`);
      failed++;
    } else {
      await upsertCache(query, listings, aesthetic, garmentType);
      console.log(`✅  ${listings.length} listings saved`);
      seeded++;
    }
  } catch (e) {
    console.log(`❌  ${e.message}`);
    failed++;
  }

  await new Promise(r => setTimeout(r, DELAY_MS));
}

await sql.end();
console.log(`\n✅  Done — seeded: ${seeded}, skipped: ${skipped}, failed: ${failed}\n`);
