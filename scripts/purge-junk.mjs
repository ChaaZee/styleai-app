/**
 * purge-junk.mjs — Step 1
 * Remove spam listings (20+ rows) and non-clothing junk from all cache rows.
 * Also checks a sample of URLs for dead listings.
 */
import postgres from "postgres";

const DATABASE_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const client = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false }, max: 5, prepare: false });

const JUNK_TITLE = [
  "trading card","pokemon card","yugioh","yu-gi-oh","magic the gathering","mtg ",
  "sports card","collectible","funko","action figure","figurine",
  "video game","console","phone case","magnet frame","picture frame",
  "poster","sticker","art print","wall art","candle","mug","cup",
  "pillow","blanket","book","magazine","vinyl record"," dvd",
  "costume jewelry","jewelry set","piece new costume","eye candy",
  "padded no","gathering mtg","nwt victorias secret padded",
  "14 piece new","magnet frames set",
];

function isJunk(l) {
  const t = (l.title || "").toLowerCase();
  return JUNK_TITLE.some(s => t.includes(s));
}

async function checkDead(urls, n = 150) {
  const sample = [...urls].sort(() => Math.random() - 0.5).slice(0, n);
  const dead = new Set();
  const BATCH = 15;
  for (let i = 0; i < sample.length; i += BATCH) {
    const slice = sample.slice(i, i + BATCH);
    await Promise.all(slice.map(async url => {
      if (!url?.startsWith("https://www.depop.com/products/")) return;
      try {
        const res = await fetch(url, {
          method: "HEAD", redirect: "follow",
          signal: AbortSignal.timeout(5000),
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (res.status === 404 || (res.url || "").includes("/search/")) dead.add(url);
      } catch { /* timeout = assume alive */ }
    }));
    process.stdout.write(`  URL check ${Math.min(i+BATCH, sample.length)}/${sample.length}\r`);
  }
  return dead;
}

async function run() {
  console.log("Finding spam URLs (20+ rows)…");
  const spamRows = await client`
    SELECT l->>'url' as url FROM depop_cache, jsonb_array_elements(listings) as l
    GROUP BY url HAVING COUNT(*) > 20
  `;
  const spamUrls = new Set(spamRows.map(r => r.url).filter(Boolean));
  console.log(`  ${spamUrls.size} spam URLs`);

  console.log("Loading all rows…");
  const rows = await client`SELECT query, listings FROM depop_cache`;

  // Collect unique product URLs for dead-check
  const allUrls = new Set();
  for (const row of rows)
    for (const l of (row.listings || []))
      if (l.url?.startsWith("https://www.depop.com/products/")) allUrls.add(l.url);

  console.log(`Spot-checking 150 URLs for dead listings…`);
  const deadUrls = await checkDead(allUrls);
  console.log(`\n  Dead: ${deadUrls.size}`);

  console.log("Purging…");
  let removed = 0;
  const BATCH = 20;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await Promise.all(slice.map(row => {
      const before = row.listings.length;
      const cleaned = (row.listings || []).filter(l =>
        !spamUrls.has(l.url) && !deadUrls.has(l.url) && !isJunk(l)
      );
      removed += before - cleaned.length;
      const jsonStr = JSON.stringify(cleaned).replace(/'/g, "''");
      const q = row.query.replace(/'/g, "''");
      return client.unsafe(`UPDATE depop_cache SET listings = '${jsonStr}'::jsonb WHERE query = '${q}'`);
    }));
    if (i % 500 === 0) console.log(`  ${i}/${rows.length}…`);
  }
  console.log(`Done! Removed ${removed} junk/dead listings.`);
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
