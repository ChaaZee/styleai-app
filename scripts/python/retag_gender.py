"""
retag_gender.py — Re-run gender tagging on every listing in the Depop cache.

HOW IT WORKS:
  Every listing stored in depop_cache has a "_gender" field ("male", "female", or "both").
  This field is used to filter out wrong-gendered recommendations.

  This script re-reads every listing's title + URL slug and re-applies the gender
  detection logic, then saves the updated _gender back to the database.

WHEN TO RUN THIS:
  - After seeding new listings (they may need gender tags)
  - If you change the gender detection logic and want to retroactively update old listings
  - If you notice wrong-gendered clothes appearing in the app

GENDER DETECTION LOGIC:
  - Looks for explicit words like "women's", "mens", "ladies", "male", etc. in the title
  - Also checks the URL slug (e.g. /products/seller-mens-jacket-a1b2/)
  - If only female words found → "female"
  - If only male words found   → "male"
  - If both or neither found   → "both" (neutral / unisex)

USAGE:
  pip install psycopg2-binary
  python scripts/python/retag_gender.py
"""

import json
import re
import psycopg2
import psycopg2.extras
from concurrent.futures import ThreadPoolExecutor

# ── CONFIG ────────────────────────────────────────────────────────────────────
DB_URL      = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
CONCURRENCY = 10   # how many rows to process at once
BATCH_SIZE  = 100  # how many rows to fetch from DB at a time

# ── GENDER REGEXES ────────────────────────────────────────────────────────────
# These match storage.ts exactly — keep them in sync if you change either.
# \b means "word boundary" — so "women" matches but "womenswear" only matches via its own term
FEMALE_RE = re.compile(
    r"\b(women[\u2019\u2018\']?s?|woman|womans|womena|ladies|lady|girls?|female|womenswear)\b",
    re.IGNORECASE
)
MALE_RE = re.compile(
    r"\b(men[\u2019\u2018\']?s?|man|male|boys?|menswear)\b",
    re.IGNORECASE
)


def gender_from_text(text):
    """Returns 'male', 'female', or 'both' for an arbitrary string."""
    has_female = bool(FEMALE_RE.search(text))
    has_male   = bool(MALE_RE.search(text))
    if has_female and not has_male:
        return "female"
    if has_male and not has_female:
        return "male"
    return "both"  # neutral, unisex, or no gender word at all


def tag_gender(listing):
    """
    Returns ('male'|'female'|'both', source) for a single listing.

    Title takes priority — only fall back to the URL as a tiebreaker when the
    title is ambiguous ("both"). source is "title", "url", or None (the latter
    when the result is "both" or the title was already definitive).
    """
    title = listing.get("title") or listing.get("name") or ""
    url   = listing.get("url") or ""

    title_gender = gender_from_text(title)
    if title_gender != "both":
        return title_gender, None  # title definitive — no annotation needed

    # Title ambiguous — try the URL as a tiebreaker
    url_gender = gender_from_text(url)
    if url_gender != "both":
        return url_gender, "url"

    return "both", None  # both ambiguous → fall back to "both"


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(DB_URL, sslmode="require")


def process_row(args):
    """
    Re-tags all listings in a single cache row.
    Returns (query, changed_count, new_listings) or None on error.
    """
    query, listings_raw = args
    # Handle both list and JSON string formats
    if isinstance(listings_raw, str):
        try:
            listings = json.loads(listings_raw)
        except Exception:
            return None
    else:
        listings = listings_raw
    if not isinstance(listings, list) or not listings:
        return None

    changed = 0
    updated = []
    counts  = {"male": 0, "female": 0, "both": 0}
    for listing in listings:
        new_gender, source = tag_gender(listing)
        old_gender = listing.get("_gender")
        # Print the title + URL used to determine gender, plus the resulting tag.
        # Annotate the source only when the URL broke a tie on an ambiguous title.
        title = listing.get("title") or listing.get("name") or ""
        url   = listing.get("url") or ""
        annotation = f" (from {source})" if source else ""
        print(f'[retag] "{title}" | {url} → {new_gender}{annotation}')
        counts[new_gender] += 1
        if new_gender != old_gender:
            changed += 1
        listing["_gender"] = new_gender
        updated.append(listing)

    return query, changed, updated, counts


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    print("\n🪡  Stitch Gender Retagger\n")

    conn   = get_connection()
    cursor = conn.cursor()

    # Count rows first
    cursor.execute("""
        SELECT COUNT(*) FROM depop_cache
        WHERE listings IS NOT NULL AND listings::text NOT IN ('[]', 'null', '')
    """)
    total = cursor.fetchone()[0]
    print(f"📦  {total} rows to retag\n")

    total_changed = 0
    processed     = 0
    offset        = 0
    gender_totals = {"male": 0, "female": 0, "both": 0}

    while offset < total:
        # Fetch a batch of rows — using ::text cast handles both jsonb array and string storage
        cursor.execute("""
            SELECT query, listings::text FROM depop_cache
            WHERE listings IS NOT NULL AND listings::text NOT IN ('[]', 'null', '')
            ORDER BY query
            LIMIT %s OFFSET %s
        """, (BATCH_SIZE, offset))
        rows = cursor.fetchall()
        if not rows:
            break

        # Process rows concurrently
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
            results = list(executor.map(process_row, rows))

        # Save updated listings back to DB
        for result in results:
            if result is None:
                continue
            query, changed, updated_listings, counts = result
            total_changed += changed
            processed     += 1
            for g in gender_totals:
                gender_totals[g] += counts[g]
            cursor.execute(
                "UPDATE depop_cache SET listings = %s::jsonb WHERE query = %s",
                (json.dumps(updated_listings), query)
            )

        conn.commit()
        offset += BATCH_SIZE
        pct = min(100, round(offset / total * 100))
        print(f"  Progress: {min(offset, total)}/{total} rows ({pct}%) — {total_changed} gender tags changed so far")

    cursor.close()
    conn.close()

    print(f"\n✅  Done — {processed} rows processed, {total_changed} gender tags updated")
    print(
        f"   Summary: {gender_totals['male']} male / "
        f"{gender_totals['female']} female / {gender_totals['both']} both\n"
    )


if __name__ == "__main__":
    main()
