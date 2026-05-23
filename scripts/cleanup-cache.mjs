#!/usr/bin/env node
/**
 * cleanup-cache.mjs — Scan all cached Depop listings and remove ones that are
 * no longer available (404, sold, deleted).
 *
 * Usage:
 *   node scripts/cleanup-cache.mjs           # dry-run (shows what would be removed)
 *   node scripts/cleanup-cache.mjs --delete  # actually removes dead listings
 */

import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL || "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const DRY_RUN = !process.argv.includes("--delete");
const CONCURRENCY = 8;
const DELAY_MS = 150;
const CHECK_TIMEOUT = 8_000;
const BATCH_SIZE = 50; // rows fetched from DB at a time

const sql = postgres(DB_URL, { ssl: { rejectUnauthorized: false }, prepare: false });

async function isLive(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "user-agent": "Mozilla/5.0", "accept": "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
    });
    // Only treat explicit "gone" responses as dead — 403 means blocked, not dead
    if (res.status === 404 || res.status === 410) return false;
    if (res.status === 403 || res.status === 429 || res.status === 0) return true; // blocked = assume live
    const finalUrl = res.url || url;
    if (finalUrl.includes("/not-found") || finalUrl.includes("page-not-found")) return false;
    return res.status < 400;
  } catch {
    return true; // network error = assume live
  }
}

async function checkBatch(items) {
  return Promise.all(items.map(async item => ({ ...item, live: await isLive(item.url) })));
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n🪡  Stitch Cache Cleanup ${DRY_RUN ? "(DRY RUN)" : "(LIVE — deleting dead listings)"}\n`);

const [{ count }] = await sql`SELECT COUNT(*) FROM depop_cache WHERE listings IS NOT NULL AND listings::text NOT IN ('[]','null','')`;
const totalRows = parseInt(count);
console.log(`📦  ${totalRows} cache rows to scan\n`);

let totalChecked = 0, totalDead = 0, rowsUpdated = 0, rowsDeleted = 0;
let offset = 0;

while (offset < totalRows) {
  // Fetch a batch of rows
  const rows = await sql`
    SELECT query, listings
    FROM depop_cache
    WHERE listings IS NOT NULL AND listings::text NOT IN ('[]','null','')
    ORDER BY query
    LIMIT ${BATCH_SIZE} OFFSET ${offset}
  `;
  if (rows.length === 0) break;

  for (const row of rows) {
    let listings = row.listings;
    if (typeof listings === "string") {
      try { listings = JSON.parse(listings); } catch { continue; }
    }
    if (!Array.isArray(listings) || listings.length === 0) continue;

    // Collect all URLs for this row
    const items = listings
      .filter(l => l.url)
      .map(l => ({ url: l.url }));

    if (items.length === 0) continue;

    // Check in CONCURRENCY-sized batches
    const deadUrls = new Set();
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const batch = items.slice(i, i + CONCURRENCY);
      const results = await checkBatch(batch);
      for (const { url, live } of results) {
        totalChecked++;
        if (!live) {
          deadUrls.add(url);
          totalDead++;
          console.log(`  ❌  dead: ${url}`);
        }
      }
      if (i + CONCURRENCY < items.length) await new Promise(r => setTimeout(r, DELAY_MS));
    }

    // Update or delete row if needed
    if (deadUrls.size > 0 && !DRY_RUN) {
      const cleaned = listings.filter(l => !deadUrls.has(l.url));
      if (cleaned.length === 0) {
        await sql`DELETE FROM depop_cache WHERE query = ${row.query}`;
        rowsDeleted++;
        console.log(`  🗑️  deleted row: "${row.query}" (all ${listings.length} listings dead)`);
      } else {
        await sql`UPDATE depop_cache SET listings = ${JSON.stringify(cleaned)}::jsonb WHERE query = ${row.query}`;
        rowsUpdated++;
        console.log(`  ✂️  trimmed "${row.query}": ${listings.length} → ${cleaned.length}`);
      }
    }
  }

  offset += BATCH_SIZE;
  const pct = Math.min(100, Math.round((offset / totalRows) * 100));
  console.log(`\n  📊 Progress: ${Math.min(offset, totalRows)}/${totalRows} rows (${pct}%) — ${totalDead} dead so far\n`);
}

await sql.end();
console.log(`\n✅  Done!`);
console.log(`   Checked: ${totalChecked} listings across ${totalRows} rows`);
console.log(`   Dead:    ${totalDead} listings removed`);
if (!DRY_RUN) {
  console.log(`   Updated: ${rowsUpdated} rows trimmed`);
  console.log(`   Deleted: ${rowsDeleted} rows fully removed`);
} else {
  console.log(`\n   ℹ️  Dry run — re-run with --delete to remove them.`);
}
console.log();
