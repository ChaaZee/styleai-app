#!/usr/bin/env node
/**
 * cleanup-cache.mjs — Scan all cached Depop listings and remove ones that are
 * no longer available (404, sold, deleted).
 *
 * Usage:
 *   node scripts/cleanup-cache.mjs           # dry-run (shows what would be removed)
 *   node scripts/cleanup-cache.mjs --delete  # actually removes dead listings
 *
 * How it works:
 *   - Fetches each listing's Depop product page (HEAD request)
 *   - 404 = listing gone → mark for removal
 *   - Listings removed from a cache row; if a row has 0 listings left, row is deleted
 *   - Rate-limited to ~1 req/sec to avoid hammering Depop
 */

import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL || "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const DRY_RUN = !process.argv.includes("--delete");
const CONCURRENCY = 5;       // parallel checks at a time
const DELAY_MS = 200;        // ms between batches
const CHECK_TIMEOUT = 8_000;

const sql = postgres(DB_URL, { ssl: "require" });

// ── Check if a listing URL is still live ─────────────────────────────────────
async function isLive(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "accept": "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
    });
    // 200 = live, 404 = gone, 410 = gone, 301/302 to /not-found/ = gone
    if (res.status === 404 || res.status === 410) return false;
    if (res.status === 200) return true;
    // Some sold listings redirect — check final URL
    const finalUrl = res.url || url;
    if (finalUrl.includes("/not-found") || finalUrl.includes("sold")) return false;
    return res.status < 400;
  } catch {
    return true; // network error = assume live (don't delete on flaky connections)
  }
}

// ── Process in batches ────────────────────────────────────────────────────────
async function checkBatch(items) {
  return Promise.all(items.map(async item => ({
    ...item,
    live: await isLive(item.url),
  })));
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n🪡  Stitch Cache Cleanup ${DRY_RUN ? "(DRY RUN — pass --delete to actually remove)" : "(LIVE — will delete dead listings)"}\n`);

// Fetch all cache rows
const rows = await sql`
  SELECT query, listings, aesthetic, garment_type, permanent
  FROM depop_cache
  WHERE listings IS NOT NULL AND listings::text NOT IN ('[]', 'null', '')
`;
console.log(`📦  Loaded ${rows.length} cache rows\n`);

// Flatten all listings with their parent query
const allListings = [];
for (const row of rows) {
  let listings = row.listings;
  if (typeof listings === "string") {
    try { listings = JSON.parse(listings); } catch { continue; }
  }
  if (!Array.isArray(listings)) continue;
  for (const listing of listings) {
    if (listing.url) {
      allListings.push({ query: row.query, url: listing.url, listing });
    }
  }
}

console.log(`🔍  Checking ${allListings.length} listings...\n`);

let checked = 0, dead = 0, alive = 0;
const deadByQuery = {}; // query → Set of dead URLs

// Process in batches of CONCURRENCY
for (let i = 0; i < allListings.length; i += CONCURRENCY) {
  const batch = allListings.slice(i, i + CONCURRENCY);
  const results = await checkBatch(batch);

  for (const { query, url, live } of results) {
    checked++;
    if (live) {
      alive++;
    } else {
      dead++;
      if (!deadByQuery[query]) deadByQuery[query] = new Set();
      deadByQuery[query].add(url);
      console.log(`  ❌  dead: ${url}`);
    }
  }

  // Progress
  if (checked % 50 === 0 || checked === allListings.length) {
    process.stdout.write(`\r  Progress: ${checked}/${allListings.length} checked — ${dead} dead, ${alive} alive  `);
  }

  await new Promise(r => setTimeout(r, DELAY_MS));
}

console.log(`\n\n📊  Results: ${dead} dead listings across ${Object.keys(deadByQuery).length} cache rows\n`);

if (dead === 0) {
  console.log("✅  Cache is clean — no dead listings found!\n");
  await sql.end();
  process.exit(0);
}

if (DRY_RUN) {
  console.log("ℹ️   Dry run — re-run with --delete to remove them.\n");
  await sql.end();
  process.exit(0);
}

// ── Delete dead listings ──────────────────────────────────────────────────────
console.log("🗑️   Removing dead listings...\n");
let rowsUpdated = 0, rowsDeleted = 0;

for (const [query, deadUrls] of Object.entries(deadByQuery)) {
  const row = rows.find(r => r.query === query);
  if (!row) continue;

  let listings = row.listings;
  if (typeof listings === "string") {
    try { listings = JSON.parse(listings); } catch { continue; }
  }
  if (!Array.isArray(listings)) continue;

  const cleaned = listings.filter(l => !deadUrls.has(l.url));
  console.log(`  "${query}": ${listings.length} → ${cleaned.length} listings`);

  if (cleaned.length === 0) {
    // Delete the whole row
    await sql`DELETE FROM depop_cache WHERE query = ${query}`;
    rowsDeleted++;
  } else {
    // Update with cleaned listings
    await sql`
      UPDATE depop_cache
      SET listings = ${JSON.stringify(cleaned)}::jsonb
      WHERE query = ${query}
    `;
    rowsUpdated++;
  }
}

await sql.end();
console.log(`\n✅  Done — ${rowsUpdated} rows updated, ${rowsDeleted} rows deleted\n`);
