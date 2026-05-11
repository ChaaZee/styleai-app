/**
 * Backfill embeddings for all depop_cache rows that don't have one yet.
 * Run once after deploying the pgvector migration:
 *   npx tsx scripts/backfill-embeddings.ts
 *
 * Uses text-embedding-3-small. Processes in batches of 50 with a small
 * delay between batches to stay within OpenAI rate limits.
 *
 * Brand names are stripped before embedding so the vectors represent
 * garment type + color + aesthetic, not brand identity.
 */

import postgres from "postgres";
import OpenAI from "openai";

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DATABASE_URL) throw new Error("DATABASE_URL required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required");

const client = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false }, max: 5 });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ── Brand normalizer (same as storage.ts) ──
const BRAND_WORDS = new Set([
  "thrasher","anti hero","antihero","santa cruz","independent","baker","element","real",
  "girl","blind","flip","creature","zero","alien workshop","emerica","osiris","dc shoes",
  "vans","almost","enjoi","spitfire","world industries","huf","alltimers","april","palace",
  "polar","fucking awesome","fa","pass~port","bronze","quasi","paradise",
  "supreme","stussy","bape","a bathing ape","off white","off-white","vlone",
  "kith","noah","aime leon dore","ald","cactus plant flea market","cpfm","human made",
  "mastermind","needles","wtaps","neighborhood","undercover","visvim",
  "nike","adidas","jordan","new balance","nb","reebok","puma","champion","fila",
  "carhartt","dickies","wrangler","levis","levi","lee",
  "nirvana","metallica","black sabbath","led zeppelin","pearl jam","soundgarden",
  "alice in chains","ramones","sex pistols","misfits","black flag","anti flag",
  "motorhead","ozzy","guns n roses","acdc","slayer","pantera","iron maiden",
  "deftones","nine inch nails","marilyn manson","system of a down","tool",
  "ralph lauren","polo","lacoste","burberry","gucci","prada","louis vuitton","lv",
  "versace","fendi","balenciaga","givenchy","saint laurent","ysl","celine",
  "loro piana","brioni","kiton","isaia","ermenegildo zegna","boglioli",
  "zara","hm","uniqlo","gap","banana republic","j crew","jcrew","mango",
  "topshop","asos","urban outfitters","uo","free people","anthropologie",
  "patagonia","north face","columbia","arcteryx","canada goose",
  "quiksilver","billabong","volcom","rip curl","oneill",
]);

function normalizeForEmbedding(query: string): string {
  const words = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !BRAND_WORDS.has(w))
    .filter(w => !/^(xs|s|m|l|xl|xxl|\d+)$/.test(w));
  return words.join(" ").trim() || query.toLowerCase();
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
    dimensions: 1536,
  });
  return res.data.map(d => d.embedding);
}

async function main() {
  console.log("Starting embedding backfill...");

  // Count rows needing backfill
  const [{ count }] = await client<{ count: string }[]>`
    SELECT COUNT(*) as count FROM depop_cache WHERE embedding IS NULL
  `;
  const total = parseInt(count);
  console.log(`Rows without embeddings: ${total}`);

  if (total === 0) {
    console.log("All rows already have embeddings!");
    await client.end();
    return;
  }

  const BATCH_SIZE = 100; // OpenAI allows up to 2048 inputs per request
  let processed = 0;
  let cursor = 0;

  while (processed < total) {
    // Fetch batch of rows without embeddings
    const rows = await client<{ id: number; query: string }[]>`
      SELECT id, query FROM depop_cache
      WHERE embedding IS NULL
      ORDER BY id
      LIMIT ${BATCH_SIZE}
      OFFSET ${cursor}
    `;

    if (rows.length === 0) break;

    const normalized = rows.map(r => normalizeForEmbedding(r.query));
    console.log(`  Embedding batch ${Math.floor(processed / BATCH_SIZE) + 1}: "${normalized[0]}" ... (${rows.length} items)`);

    try {
      const embeddings = await embedBatch(normalized);

      // Update each row with its embedding
      for (let i = 0; i < rows.length; i++) {
        const vecStr = `[${embeddings[i].join(",")}]`;
        await client`
          UPDATE depop_cache
          SET embedding = ${vecStr}::vector
          WHERE id = ${rows[i].id}
        `;
      }

      processed += rows.length;
      cursor += rows.length;
      console.log(`  ✓ ${processed}/${total} done`);
    } catch (e) {
      console.error(`  ✗ Batch failed:`, e);
      // Wait and retry
      await new Promise(r => setTimeout(r, 5000));
    }

    // Small delay between batches to respect rate limits
    if (processed < total) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\nBackfill complete! ${processed} rows embedded.`);
  await client.end();
}

main().catch(console.error);
