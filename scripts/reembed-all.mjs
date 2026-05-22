/**
 * reembed-all.mjs — Step 2
 * Re-generates embeddings for all non-empty depop_cache rows.
 * Embeds: query + first 5 listing titles (now full slug-derived titles).
 * Concurrency: 8 parallel, ~1s/batch → ~17min for 8118 rows.
 */
import postgres from "postgres";
import OpenAI from "openai";

const DATABASE_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "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";

const openai = new OpenAI({ apiKey: OPENAI_KEY });
const client = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false }, max: 8, prepare: false });

async function embed(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 800),
    dimensions: 1536,
  });
  return res.data[0].embedding;
}

async function run() {
  console.log("Loading rows…");
  const rows = await client`SELECT query, listings FROM depop_cache WHERE jsonb_array_length(listings) > 0`;
  console.log(`  ${rows.length} non-empty rows to embed`);

  const CONCURRENCY = 8;
  let done = 0, failed = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async row => {
      try {
        const titles = (row.listings || []).slice(0, 5).map(l => l.title).filter(Boolean).join(", ");
        const text = `${row.query}: ${titles}`;
        const vec = await embed(text);
        const vecStr = `[${vec.join(",")}]`;
        const q = row.query.replace(/'/g, "''");
        await client.unsafe(`UPDATE depop_cache SET embedding = '${vecStr}'::vector WHERE query = '${q}'`);
        done++;
      } catch (e) {
        failed++;
        if (e?.status === 429) await new Promise(r => setTimeout(r, 8000));
      }
    }));
    if (done % 400 === 0 || i === 0) console.log(`  ${done}/${rows.length} embedded, ${failed} failed…`);
  }

  console.log(`\nDone! Embedded: ${done}, Failed: ${failed}`);
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
