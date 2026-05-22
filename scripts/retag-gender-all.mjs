/**
 * retag-gender-all.mjs
 * Re-runs gender tagging on ALL listings using their CURRENT stored titles.
 * Processes rows one at a time to avoid OOM. Concurrency 10.
 */
import postgres from "postgres";

const DATABASE_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const client = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false }, max: 12, prepare: false });

// Same regex as storage.ts
const EXPLICIT_FEMALE = /\b(women|womens|woman|womans|womena|ladies|lady|girls?|female|feminine|womenswear)\b/i;
const EXPLICIT_MALE   = /\b(men|mens|man|male|masculine|boys?|menswear)\b/i;
const FEMALE_BRAND_SIGNALS = /\b(aerie|brandy melville|lululemon|alo yoga|alo|kate spade|loft|the loft|ann taylor|beyond yoga|white house black market|whbm|j\.? jill|eileen fisher|talbots|tularosa|anthropologie|free people|we the free|reformation|aritzia|revolve|madewell women|everlane women|vince camuto|bcbg|bcbgmaxazria|diane von furstenberg|dvf|alice olivia|alice \+ olivia|rebecca taylor|joie|velvet by graham|velvet clothing|equipment silk|theory women|frame women|ulla johnson|ba&sh|ba sh|sezane|rouje|realisation par|ganni|staud|cult gaia|zimmermann|camilla|lpa|johnny was|fp movement|free people movement|edikted|cupshe|mistress rocks|chuu|nastygal|nasty gal|princess polly|showpo|lulusfashion|lulus|lovestitch|storets|chicwish|with jean|city chic|yours clothing|evans|dorothy perkins|warehouse women|oasis fashion|river island women|quiz clothing|boohoo|missguided|plt|pretty little thing|shein women|romwe|zaful|forever 21|h&m divided|topshop|phase eight|boden women|pure collection|laura ashley|per una|bonmarche|kaleidoscope|monsoon women|accessorize|hobbs women|whistles women|coast women|ghost women|finery london|l k bennett|lk bennett|jigsaw women|karen millen|kaliko|anne klein|charter club|jones new york|liz claiborne|dana buchman|st john women|escada|max mara|max mara weekend|marina rinaldi|elena miro|vero moda|selected femme|pieces women|only women|jacqueline de yong|moss copenhagen|noisy may|baum und pferdgarten|stine goya|gestuz|rotate|by malene birger|second female|remain|stand studio|toteme|athleta|sweaty betty|varley|splits59|spiritual gangster|girlfriend collective|outdoor voices|vuori women|fp movement)\b/i;
const FEMALE_TITLE_SIGNALS = /\b(women|womens|woman|ladies|lady|girls?|girlie|female|feminine|womenswear|dress|dresses|skirt|skirts|blouse|bra|corset|midi|maxi|sundress|miniskirt|bodycon|camisole|romper|jumpsuit|petite|heels?|stiletto|pumps?|ballet flat|wedge|kitten heel|crop top|halter|tube top|bustier|slip dress|wrap dress|pinafore|smock|prairie|lace top|ruffles?|bow top|cardigan set|matching set|co-ord|kickpleat|kick pleat|peplum|spaghetti strap|off shoulder|one shoulder|asymmetric hem|babydoll|broderie|chiffon blouse|silk slip|lingerie|cami|nightgown|bikini|swimsuit|one-piece|sarong|palazzo|culottes|wide leg crop|flare jeans women|mom jeans women|bardot|milkmaid|bralette|bodysuit|flowy|ditsy|smocked|tiered skirt|balloon sleeve|puff sleeve|frill|flutter sleeve|button front skirt|tennis skirt|micro skirt|tennis dress|shift dress|sheath dress|a-line|fit and flare|empire waist|sweetheart neck|strapless|tube dress|floral dress|gingham dress|linen dress|shirt dress|tea dress|swing dress|fairy dress|cottagecore dress|whimsigoth|kilt|kawaii|juniors?|junior size|victoria secret|victorias secret)\b/i;
const MALE_TITLE_SIGNALS = /\b(men|mens|man|male|masculine|boys?|menswear|chinos|oxford shirt|blazer|loafer|brogues|suit jacket|trousers|dress shirt|tie|necktie|cufflinks|polo shirt|henley|rugby shirt|harrington|overshirt|flight jacket|varsity jacket|bomber men|coach jacket|track jacket men|cargo pants men|cargo shorts|board shorts|swim trunks|joggers men|sweatpants men|hoodie men|crewneck men|quarter zip|flannel shirt|workwear|denim jacket men|chelsea boots men|derby shoes|monk strap|brogue|desert boots|work boots men)\b/i;

function listingText(l) {
  const title = l.title || l.name || "";
  const url = l.url || "";
  const slugMatch = url.match(/\/products\/([^/?#]+)/i);
  const slugWords = slugMatch ? slugMatch[1].replace(/-/g, " ") : "";
  return `${title} ${slugWords}`;
}

function tagGender(l) {
  const text = listingText(l);
  if (FEMALE_BRAND_SIGNALS.test(text)) return "female";
  const hasFem  = FEMALE_TITLE_SIGNALS.test(text);
  const hasMasc = MALE_TITLE_SIGNALS.test(text);
  if (hasFem && !hasMasc)  return "female";
  if (hasMasc && !hasFem)  return "male";
  if (hasFem && hasMasc) {
    const explicitFem  = EXPLICIT_FEMALE.test(text);
    const explicitMasc = EXPLICIT_MALE.test(text);
    if (explicitFem && !explicitMasc) return "female";
    if (explicitMasc && !explicitFem) return "male";
  }
  return "both";
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
