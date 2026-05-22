/**
 * migrate-titles-from-slug.mjs
 * Rebuilds the stored title for every listing in depop_cache from its URL slug,
 * then re-runs gender tagging on the new full title.
 *
 * Run once: node scripts/migrate-titles-from-slug.mjs
 */

import postgres from "postgres";

const DATABASE_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";

const FEMALE_TITLE_SIGNALS = /\b(women|womens|woman|ladies|lady|girls?|girlie|female|feminine|womenswear|dress|dresses|skirt|skirts|blouse|bra|corset|midi|maxi|sundress|miniskirt|bodycon|camisole|romper|jumpsuit|petite|heels?|stiletto|pumps?|ballet flat|wedge|kitten heel|crop top|halter|tube top|bustier|slip dress|wrap dress|pinafore|smock|prairie|lace top|ruffles?|bow top|cardigan set|matching set|co-ord|kickpleat|kick pleat|peplum|spaghetti strap|off shoulder|one shoulder|asymmetric hem|babydoll|broderie|chiffon blouse|silk slip|lingerie|cami|nightgown|bikini|swimsuit|one-piece|sarong|palazzo|culottes|wide leg crop|flare jeans women|mom jeans women|bardot|milkmaid|bralette|bodysuit|flowy|ditsy|smocked|tiered skirt|balloon sleeve|puff sleeve|frill|flutter sleeve|button front skirt|tennis skirt|micro skirt|tennis dress|shift dress|sheath dress|a-line|fit and flare|empire waist|sweetheart neck|strapless|tube dress|floral dress|gingham dress|linen dress|shirt dress|tea dress|swing dress|fairy dress|cottagecore dress|whimsigoth|kilt|kawaii|juniors?|junior size|victoria secret|victorias secret|edikted|cupshe|mistress rocks|free people|we the free|aritzia|lululemon women|loft women|the loft|justice girls?|fabletics women|chuu|nastygal|nasty gal|princess polly|showpo|urban outfitters women|revolve women|shein women|boohoo women|forever 21 women|h&m divided|asos women|topshop|zara women|anthropologie|reformation|abercrombie women|ae women|american eagle women)\b/i;

const MALE_TITLE_SIGNALS = /\b(men|mens|man|male|masculine|boys?|menswear|chinos|oxford shirt|blazer|loafer|brogues|suit jacket|trousers|dress shirt|polo shirt|henley|rugby shirt|harrington|overshirt|flight jacket|varsity jacket|cargo pants|cargo shorts|board shorts|swim trunks|flannel shirt|denim jacket men|chelsea boots|derby shoes|brogue|desert boots|work boots|mens hoodie|mens tee|mens jacket|mens coat|mens jeans|mens trousers|mens shorts|mens shirt|mens suit|mens blazer|mens chinos)\b/i;

/** Extract full title from the URL slug */
function titleFromUrl(url) {
  const slugMatch = (url || "").match(/\/products\/([^/?#]+)/i);
  if (!slugMatch) return null;
  const parts = slugMatch[1].split("-");
  // Drop first segment (seller username) and trailing 4-char hex hash
  const hasHash = parts.length > 1 && /^[a-f0-9]{4}$/i.test(parts[parts.length - 1]);
  const middle = parts.slice(1, hasHash ? -1 : undefined);
  if (!middle.length) return null;
  return middle.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function tagGender(title) {
  const hasFem  = FEMALE_TITLE_SIGNALS.test(title);
  const hasMasc = MALE_TITLE_SIGNALS.test(title);
  if (hasFem && !hasMasc)  return "female";
  if (hasMasc && !hasFem)  return "male";
  return "both";
}

const client = postgres(DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  max: 5,
  prepare: false,
});

async function run() {
  const BATCH = 20;
  console.log("Fetching all depop_cache rows…");
  const rows = await client`SELECT query, listings FROM depop_cache`;
  console.log(`  ${rows.length} rows. Rebuilding titles from URL slugs…`);

  let titlesUpdated = 0;
  let femaleUpdated = 0;
  let maleUpdated = 0;

  const allTagged = rows.map(row => {
    const listings = Array.isArray(row.listings) ? row.listings : [];
    const tagged = listings.map(l => {
      const slugTitle = titleFromUrl(l.url);
      if (slugTitle) {
        l.title = slugTitle; // replace with full slug-derived title
        titlesUpdated++;
      }
      // Re-tag gender using the new full title
      l._gender = tagGender(l.title || "");
      if (l._gender === "female") femaleUpdated++;
      if (l._gender === "male")   maleUpdated++;
      return l;
    });
    return { query: row.query, tagged };
  });

  console.log(`  Titles rebuilt: ${titlesUpdated}`);
  console.log(`  Female-tagged: ${femaleUpdated} | Male-tagged: ${maleUpdated} | Both: ${allTagged.reduce((s,r)=>s+r.tagged.filter(l=>l._gender==='both').length,0)}`);
  console.log(`  Writing to DB…`);

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
    if (done % 500 === 0) console.log(`  ${done}/${allTagged.length} rows updated…`);
  }

  console.log(`\nDone! ${done} rows updated.`);
  await client.end();
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
