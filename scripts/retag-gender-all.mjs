/**
 * retag-gender-all.mjs
 * Re-runs gender tagging on ALL listings using their CURRENT stored titles.
 * Processes rows one at a time to avoid OOM. Concurrency 10.
 */
import postgres from "postgres";

const DATABASE_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const client = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false }, max: 12, prepare: false });

// Only explicit gender words in the title — no brands, no garment types.
// Matches storage.ts tagListingGender exactly.
const EXPLICIT_FEMALE = /\b(women[''\u2019]?s?|woman|womans|womena|ladies|lady|girls?|female|womenswear)\b/i;
const EXPLICIT_MALE   = /\b(men[''\u2019]?s?|man|male|boys?|menswear)\b/i;

function listingText(l) {
  const title = l.title || l.name || "";
  const url = l.url || "";
  const slugMatch = url.match(/\/products\/([^/?#]+)/i);
  const slugWords = slugMatch ? slugMatch[1].replace(/-/g, " ") : "";
  return `${title} ${slugWords}`;
}

function tagGender(l) {
  const text = listingText(l);
  const hasFem  = EXPLICIT_FEMALE.test(text);
  const hasMasc = EXPLICIT_MALE.test(text);
  if (hasFem && !hasMasc)  return "female";
  if (hasMasc && !hasFem)  return "male";
  return "both";  // no gender word, or both present (unisex)
}

async function run() {
  console.log("Loading query list...");
  const queryRows = await client`SELECT query FROM depop_cache WHERE jsonb_typeof(listings) = 'array' AND (listings::text != '[]')`;
  const queries = queryRows.map(r => r.query);
  console.log(`  ${queries.length} rows to retag`);

  const CONCURRENCY = 10;
  let done = 0, changed = 0, failed = 0;

  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    const slice = queries.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async query => {
      try {
        const [row] = await client`SELECT listings FROM depop_cache WHERE query = ${query}`;
        if (!row) return;

        let anyChanged = false;
        const retagged = row.listings.map(l => {
          const newGender = tagGender(l);
          if (newGender !== l._gender) {
            anyChanged = true;
            changed++;
            return { ...l, _gender: newGender };
          }
          return l;
        });

        if (anyChanged) {
          await client`UPDATE depop_cache SET listings = ${JSON.stringify(retagged)}::jsonb WHERE query = ${query}`;
        }
        done++;
      } catch (e) {
        failed++;
        console.error(`  ERROR on "${query}":`, e.message);
      }
    }));
    if (done % 500 === 0 && done > 0) {
      console.log(`  ${done}/${queries.length} rows processed, ${changed} listings retagged, ${failed} failed`);
    }
  }

  console.log(`\nDone! Rows processed: ${done}, Listings retagged: ${changed}, Failed: ${failed}`);
  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
