/**
 * purge-and-reembed.mjs
 * 1. Remove spam listings (appearing in too many rows, or clearly non-clothing)
 * 2. Spot-check live Depop URLs — remove any that 404 or redirect to search
 * 3. Re-generate embeddings for all cache rows from their query strings
 *    (now backed by proper full slug-derived titles)
 *
 * Run: node scripts/purge-and-reembed.mjs
 */

import postgres from "postgres";
import OpenAI from "openai";

const DATABASE_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "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";

const openai = new OpenAI({ apiKey: OPENAI_KEY });
const client = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false }, max: 5, prepare: false });

// ── Step 1: Find spam listings (URLs appearing in 20+ rows) ───────────────────
async function getSpamUrls() {
  const rows = await client`
    SELECT l->>'url' as url
    FROM depop_cache, jsonb_array_elements(listings) as l
    GROUP BY url
    HAVING COUNT(*) > 20
  `;
  return new Set(rows.map(r => r.url).filter(Boolean));
}

// Non-clothing signals in title
const JUNK_SIGNALS = [
  "trading card","pokemon card","yugioh","yu-gi-oh","magic the gathering","mtg ",
  "sports card","collectible","funko","action figure","figurine",
  "video game","console","phone case","magnet frame","picture frame",
  "poster","sticker","art print","wall art","candle","mug","cup",
  "pillow","blanket","book","magazine","vinyl record"," dvd",
  "costume jewelry","jewelry set","earring set","necklace set",
  "piece new costume","eye candy","padded no",
];

function isJunk(listing) {
  const t = (listing.title || "").toLowerCase();
  return JUNK_SIGNALS.some(s => t.includes(s));
}

// ── Step 2: Check if Depop URLs are still live (sample, not all 62k) ──────────
async function checkLiveUrls(urls, sampleSize = 200) {
  const sample = urls.sort(() => Math.random() - 0.5).slice(0, sampleSize);
  const dead = new Set();
  const BATCH = 10;

  for (let i = 0; i < sample.length; i += BATCH) {
    const slice = sample.slice(i, i + BATCH);
    await Promise.all(slice.map(async url => {
      if (!url?.startsWith("https://www.depop.com/products/")) return;
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        // 404 = sold/removed. 301/302 to search page = also dead
        if (res.status === 404) { dead.add(url); return; }
        const finalUrl = res.url || url;
        if (finalUrl.includes("/search/")) dead.add(url);
      } catch {
        // timeout or network — skip, assume alive
      }
    }));
    process.stdout.write(`  URL check: ${Math.min(i + BATCH, sample.length)}/${sample.length}\r`);
  }
  return dead;
}

// ── Step 3: Re-embed from query string ────────────────────────────────────────
async function getEmbedding(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 800),
    dimensions: 1536,
  });
  return res.data[0].embedding;
}

async function run() {
  // --- Step 1: collect spam URLs ---
  console.log("Finding spam listings (appearing in 20+ rows)…");
  const spamUrls = await getSpamUrls();
  console.log(`  ${spamUrls.size} spam URLs found`);

  // --- Load all rows ---
  console.log("Loading all cache rows…");
  const rows = await client`SELECT query, listings, aesthetic, permanent, garment_type FROM depop_cache`;
  console.log(`  ${rows.length} rows loaded`);

  // --- Collect all unique listing URLs for live-check sample ---
  const allUrls = [];
  for (const row of rows) {
    for (const l of (row.listings || [])) {
      if (l.url?.startsWith("https://www.depop.com/products/")) allUrls.push(l.url);
    }
  }
  const uniqueUrls = [...new Set(allUrls)];
  console.log(`  ${uniqueUrls.length} unique listing URLs`);

  // --- Step 2: live URL check on sample ---
  console.log("Spot-checking 300 random listing URLs for dead links…");
  const deadUrls = await checkLiveUrls(uniqueUrls, 300);
  console.log(`\n  Dead URLs found: ${deadUrls.size}`);

  // --- Step 3: purge + clean each row ---
  console.log("Purging junk/dead listings from all rows…");
  let totalRemoved = 0;
  const cleanedRows = rows.map(row => {
    const before = row.listings.length;
    const cleaned = row.listings.filter(l => {
      if (spamUrls.has(l.url)) return false;
      if (deadUrls.has(l.url)) return false;
      if (isJunk(l)) return false;
      return true;
    });
    totalRemoved += before - cleaned.length;
    return { ...row, listings: cleaned };
  });
  console.log(`  Removed ${totalRemoved} junk/dead listings across all rows`);

  // --- Step 4: re-embed each row (concurrency 5) ---
  console.log("Re-generating embeddings from query strings…");
  const EMBED_BATCH = 5;
  let embedded = 0;
  let failed = 0;

  for (let i = 0; i < cleanedRows.length; i += EMBED_BATCH) {
    const slice = cleanedRows.slice(i, i + EMBED_BATCH);
    await Promise.all(slice.map(async row => {
      if (!row.listings.length) return; // skip empty rows
      try {
        // Embed the query + first few listing titles for richer signal
        const sampleTitles = row.listings.slice(0, 5).map(l => l.title).join(", ");
        const text = `${row.query}: ${sampleTitles}`;
        const vec = await getEmbedding(text);
        const vecStr = `[${vec.join(",")}]`;
        const jsonStr = JSON.stringify(row.listings).replace(/'/g, "''");
        const escapedQuery = row.query.replace(/'/g, "''");
        await client.unsafe(`
          UPDATE depop_cache
          SET listings = '${jsonStr}'::jsonb,
              embedding = '${vecStr}'::vector
          WHERE query = '${escapedQuery}'
        `);
        embedded++;
      } catch (e) {
        failed++;
        // On rate limit, slow down
        if (e?.status === 429) await new Promise(r => setTimeout(r, 5000));
      }
    }));
    if ((i / EMBED_BATCH) % 20 === 0) {
      console.log(`  ${Math.min(i + EMBED_BATCH, cleanedRows.length)}/${cleanedRows.length} rows processed…`);
    }
  }

  console.log(`\nDone!`);
  console.log(`  Embedded: ${embedded} rows`);
  console.log(`  Failed:   ${failed} rows`);
  await client.end();
}

run().catch(err => {
  console.error("Script failed:", err);
  process.exit(1);
});
