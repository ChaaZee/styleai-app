"""
purge_junk.py — Remove non-clothing and spam listings from the Depop cache.

HOW IT WORKS:
  Sometimes Depop search results include non-clothing items like trading cards,
  phone cases, posters, etc. This script scans every listing and removes anything
  that clearly isn't clothing based on keywords in the title.

  It also removes "spam" listings — items that appear in 20+ cache rows,
  which usually means they're generic/unrelated products that show up in every search.

WHEN TO RUN THIS:
  - After seeding new listings (to clean up any junk that got in)
  - If you notice weird non-clothing items appearing in the app

USAGE:
  pip install psycopg2-binary
  python scripts/python/purge_junk.py           # dry run — shows what would be removed
  python scripts/python/purge_junk.py --delete  # actually removes junk
"""

import sys
import json
import psycopg2
import psycopg2.extras

# ── CONFIG ────────────────────────────────────────────────────────────────────
DB_URL   = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
DRY_RUN  = "--delete" not in sys.argv
SPAM_THRESHOLD = 20  # listings appearing in this many rows are considered spam

# ── JUNK KEYWORDS ─────────────────────────────────────────────────────────────
# If any of these phrases appear in a listing title, it gets removed.
# Add more if you see junk slipping through.
JUNK_KEYWORDS = [
    # Trading cards / collectibles
    "trading card", "pokemon card", "yugioh", "yu-gi-oh", "magic the gathering",
    "mtg ", "sports card", "collectible", "funko", "action figure", "figurine",

    # Electronics / misc
    "video game", "console", "phone case", "phone cover",

    # Home goods
    "picture frame", "magnet frame", "poster", "sticker", "art print",
    "wall art", "candle", "mug", "cup", "pillow", "blanket",

    # Books / media
    "book", "magazine", "vinyl record", " dvd", " cd ",

    # Jewelry (non-clothing)
    "costume jewelry", "jewelry set", "earring set", "necklace set",

    # Junk phrases that sneak through
    "piece new costume", "eye candy", "padded no", "gathering mtg",
    "nwt victorias secret padded", "14 piece new", "magnet frames set",
]


# ── JUNK DETECTOR ─────────────────────────────────────────────────────────────
def is_junk(listing):
    """Returns True if this listing is clearly not clothing."""
    title = (listing.get("title") or "").lower()
    return any(keyword in title for keyword in JUNK_KEYWORDS)


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(DB_URL, sslmode="require")


def find_spam_urls(cursor):
    """
    Finds URLs that appear in too many cache rows.
    These are likely irrelevant items that show up in every search.
    """
    cursor.execute("""
        SELECT l->>'url' as url, COUNT(*) as cnt
        FROM depop_cache, jsonb_array_elements(listings) as l
        WHERE jsonb_typeof(listings) = 'array'
        GROUP BY url
        HAVING COUNT(*) > %s
    """, (SPAM_THRESHOLD,))
    rows = cursor.fetchall()
    spam = {row[0] for row in rows if row[0]}
    return spam


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    mode = "DRY RUN" if DRY_RUN else "LIVE — removing junk"
    print(f"\n🪡  Stitch Junk Purger ({mode})\n")

    conn   = get_connection()
    cursor = conn.cursor()

    # Step 1: Find spam URLs
    print("🔍  Finding spam URLs (appearing in too many rows)...")
    spam_urls = find_spam_urls(cursor)
    print(f"   Found {len(spam_urls)} spam URLs\n")

    # Step 2: Load all rows
    print("📦  Loading all cache rows...")
    cursor.execute("""
        SELECT query, listings FROM depop_cache
        WHERE listings IS NOT NULL AND listings::text NOT IN ('[]', 'null', '')
    """)
    rows = cursor.fetchall()
    print(f"   {len(rows)} rows loaded\n")

    # Step 3: Scan and clean
    total_removed = 0
    rows_updated  = 0
    rows_deleted  = 0

    for query, listings_raw in rows:
        # Parse listings
        if isinstance(listings_raw, str):
            try:
                listings = json.loads(listings_raw)
            except Exception:
                continue
        else:
            listings = listings_raw

        if not isinstance(listings, list) or not listings:
            continue

        # Filter out junk and spam
        cleaned = [
            l for l in listings
            if not is_junk(l) and l.get("url") not in spam_urls
        ]
        removed = len(listings) - len(cleaned)

        if removed == 0:
            continue  # nothing to remove

        total_removed += removed
        print(f"  🗑️  \"{query}\": removing {removed} junk listings ({len(listings)} → {len(cleaned)})")
        for l in listings:
            if is_junk(l):
                print(f"       junk: {l.get('title', '?')}")
            elif l.get("url") in spam_urls:
                print(f"       spam: {l.get('title', '?')}")

        if not DRY_RUN:
            if not cleaned:
                cursor.execute("DELETE FROM depop_cache WHERE query = %s", (query,))
                rows_deleted += 1
            else:
                cursor.execute(
                    "UPDATE depop_cache SET listings = %s::jsonb WHERE query = %s",
                    (json.dumps(cleaned), query)
                )
                rows_updated += 1
            conn.commit()

    cursor.close()
    conn.close()

    print(f"\n✅  Done!")
    print(f"   Junk removed: {total_removed} listings")
    if not DRY_RUN:
        print(f"   Rows updated: {rows_updated}")
        print(f"   Rows deleted: {rows_deleted}")
    else:
        print(f"\n   ℹ️  Dry run — re-run with --delete to actually remove them.")
    print()


if __name__ == "__main__":
    main()
