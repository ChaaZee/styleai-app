/**
 * migrate-gender-tags-fast.mjs
 * Retroactively stamps _gender on every listing in depop_cache.
 * Uses concurrent batches of 50 for speed.
 */

import postgres from "postgres";

const DATABASE_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";

const FEMALE_TITLE_SIGNALS = /\b(women|womens|woman|ladies|lady|girls?|female|feminine|womenswear|dress|dresses|skirt|skirts|blouse|bra|corset|midi|maxi|sundress|miniskirt|bodycon|camisole|romper|jumpsuit|floral|petite|heels?|stiletto|pumps?|ballet flat|wedge|kitten heel|crop top|halter|tube top|bustier|slip dress|wrap dress|pinafore|smock|prairie|lace top|ruffle|bow top|cardigan set|matching set|co-ord|kickpleat|kick pleat|peplum|spaghetti strap|off shoulder|one shoulder|asymmetric hem|babydoll|broderie|chiffon blouse|silk slip|lingerie|cami|nightgown|bikini|swimsuit|one-piece|sarong|palazzo|culottes|girlie|bardot|milkmaid|bralette|bodysuit|flowy|ditsy|smocked|tiered skirt|balloon sleeve|puff sleeve|frill|flutter sleeve|a-line|wrap skirt|mini dress|maxi dress|midi dress|shirt dress|tea dress|gown|ballgown|prom dress|bridesmaid|floaty|empire waist|sweetheart neck|scoop back|keyhole|lace dress|floral dress|slip skirt|denim skirt|pleated skirt|tennis skirt|plisse|shirred|smocking|eyelet|broderie anglaise|feminine dress|boho dress|summer dress|floral skirt)\b/i;

const MALE_TITLE_SIGNALS = /\b(men|mens|man|male|masculine|boys?|menswear|chinos|oxford shirt|blazer|loafer|brogues|suit jacket|trousers|dress shirt|polo shirt|henley|rugby shirt|harrington|overshirt|flight jacket|varsity jacket|cargo pants|cargo shorts|board shorts|swim trunks|flannel shirt|denim jacket men|chelsea boots|derby shoes|brogue|desert boots|work boots|mens hoodie|mens tee|mens jacket|mens coat|mens jeans|mens trousers|mens shorts|mens shirt|mens suit|mens blazer|mens chinos)\b/i;

function tagListingGender(listing) {
  const title = listing.title || listing.name || "";
  const hasFem  = FEMALE_TITLE_SIGNALS.test(title);
  const hasMasc = MALE_TITLE_SIGNALS.test(title);
  if (hasFem && !hasMasc)       listing._gender = "female";
  else if (hasMasc && !hasFem)  listing._gender = "male";
  else                           listing._gender = "both";
  return listing;
}

const client = postgres(DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  max: 5,
  prepare: false,
});

async function processBatch(rows) {
  await Promise.all(rows.map(row => {
    const listings = Array.isArray(row.listings) ? row.listings : [];
    const tagged = listings.map(tagListingGender);
    const jsonStr = JSON.stringify(tagged).replace(/'/g, "''");
    const escapedQuery = row.query.replace(/'/g, "''");
    return client.unsafe(
      `UPDATE depop_cache SET listings = '${jsonStr}'::jsonb WHERE query = '${escapedQuery}'`
    );
  }));
}

async function run() {
  const BATCH = 20;
  console.log("Fetching all depop_cache rows…");
  const rows = await client`SELECT query, listings FROM depop_cache`;
  console.log(`  ${rows.length} rows found. Processing in batches of ${BATCH}…`);

  let femaleTagged = 0;
  let maleTagged = 0;
  let bothTagged = 0;

  // Pre-compute tagged versions and count
  const allTagged = rows.map(row => {
    const listings = Array.isArray(row.listings) ? row.listings : [];
    const tagged = listings.map(tagListingGender);
    femaleTagged += tagged.filter(l => l._gender === "female").length;
    maleTagged   += tagged.filter(l => l._gender === "male").length;
    bothTagged   += tagged.filter(l => l._gender === "both").length;
    return { query: row.query, tagged };
  });

  console.log(`  Preview — female: ${femaleTagged}, male: ${maleTagged}, both/neutral: ${bothTagged}`);
  console.log(`  Starting DB updates…`);

  let done = 0;
  for (let i = 0; i < allTagged.length; i += BATCH) {
    const slice = allTagged.slice(i, i + BATCH);
    await Promise.all(slice.map(row => {
      const jsonStr = JSON.stringify(row.tagged).replace(/'/g, "''");
      const escapedQuery = row.query.replace(/'/g, "''");
      return client.unsafe(
        `UPDATE depop_cache SET listings = '${jsonStr}'::jsonb WHERE query = '${escapedQuery}'`
      );
    }));
    done += slice.length;
    console.log(`  ${done}/${allTagged.length} rows updated…`);
  }

  console.log(`\nDone! ${done} rows updated.`);
  await client.end();
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
