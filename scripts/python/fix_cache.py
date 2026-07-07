"""
fix_cache.py -- One-pass depop_cache repair.

Fixes four problems in a single pass:
  1. Double-encoded listings (JSONB string instead of array) -> re-encoded as proper array
  2. Empty/null listings rows -> deleted
  3. Listings missing _source -> tagged "depop" (verified: all no-source rows are depop.com)
  4. Gender tags -> re-applied from title text (explicit "women's"/"men's" beats any old tag;
     ambiguous titles keep their existing tag so vision-based tags are preserved)

USAGE:
  python scripts/python/fix_cache.py            # dry run (default, no writes)
  python scripts/python/fix_cache.py --apply    # write changes
"""

import argparse
import json
import os
import re
import sys

import psycopg2


def load_db_url():
    """Read DATABASE_URL from env or the project .env file."""
    url = os.getenv("DATABASE_URL", "")
    if not url:
        env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
        if os.path.exists(env_path):
            for line in open(env_path):
                if line.startswith("DATABASE_URL="):
                    url = line.split("=", 1)[1].strip().strip('"')
                    break
    if not url:
        print("ERROR: DATABASE_URL not set. Export it or add to .env")
        sys.exit(1)
    return url


DB_URL = load_db_url()

# Same regexes as server/storage.ts -- curly and straight apostrophes
EXPLICIT_FEMALE = re.compile(r"\b(women[’']?s?|woman|womans|ladies|lady|girls?|female|womenswear)\b", re.I)
EXPLICIT_MALE   = re.compile(r"\b(men[’']?s?|man|male|boys?|menswear)\b", re.I)


def detect_gender_from_title(title):
    """Explicit title text wins; returns None when the title is ambiguous."""
    has_fem = bool(EXPLICIT_FEMALE.search(title))
    has_masc = bool(EXPLICIT_MALE.search(title))
    if has_fem and not has_masc:
        return "female"
    if has_masc and not has_fem:
        return "male"
    return None  # ambiguous -> keep existing tag


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Write changes (default is dry run)")
    args = parser.parse_args()
    dry = not args.apply

    conn = psycopg2.connect(DB_URL, sslmode="require")
    cur = conn.cursor()

    print(f"\n{'DRY RUN' if dry else 'APPLYING'} -- depop_cache repair\n")

    # 1) Delete empty rows
    cur.execute("SELECT COUNT(*) FROM depop_cache WHERE listings IS NULL OR listings::text IN ('[]','null','\"\"','')")
    n_empty = cur.fetchone()[0]
    print(f"Empty rows to delete: {n_empty}")
    if not dry and n_empty:
        cur.execute("DELETE FROM depop_cache WHERE listings IS NULL OR listings::text IN ('[]','null','\"\"','')")
        conn.commit()

    # 2-4) Walk every remaining row, normalize + fix source + retag gender
    cur.execute("SELECT query, listings::text FROM depop_cache")
    rows = cur.fetchall()

    fixed_encoding = 0
    fixed_source = 0
    gender_changed = 0
    rows_updated = 0
    broken_rows = []

    wcur = conn.cursor()
    for query, raw in rows:
        try:
            listings = json.loads(raw)
            was_string = isinstance(listings, str)
            if was_string:
                listings = json.loads(listings)
        except Exception:
            broken_rows.append(query)
            continue
        if not isinstance(listings, list) or not listings:
            continue

        row_dirty = was_string
        if was_string:
            fixed_encoding += 1

        new_listings = []
        for item in listings:
            if not isinstance(item, dict):
                new_listings.append(item)
                continue
            item = dict(item)

            if not item.get("_source"):
                url = item.get("url", "")
                if "depop.com" in url:
                    item["_source"] = "depop"
                    fixed_source += 1
                    row_dirty = True

            title = item.get("title") or item.get("name") or ""
            text_gender = detect_gender_from_title(title)
            old = item.get("_gender", "both")
            if text_gender and text_gender != old:
                item["_gender"] = text_gender
                gender_changed += 1
                row_dirty = True
            elif not item.get("_gender"):
                item["_gender"] = "both"
                row_dirty = True

            new_listings.append(item)

        if row_dirty:
            rows_updated += 1
            if not dry:
                wcur.execute(
                    "UPDATE depop_cache SET listings = %s::jsonb WHERE query = %s",
                    (json.dumps(new_listings), query),
                )
                if rows_updated % 200 == 0:
                    conn.commit()
                    print(f"  ...committed {rows_updated} rows")

    if not dry:
        conn.commit()

    print(f"\nRows scanned:            {len(rows)}")
    print(f"Double-encoded fixed:    {fixed_encoding}")
    print(f"_source tags added:      {fixed_source}")
    print(f"Gender tags corrected:   {gender_changed}")
    print(f"Rows updated:            {rows_updated}")
    if broken_rows:
        print(f"Unparseable rows (left untouched): {len(broken_rows)}")
        for q in broken_rows[:10]:
            print(f"  {q!r}")
    print(f"\n{'No changes written (dry run). Re-run with --apply.' if dry else 'Done -- changes committed.'}\n")

    conn.close()


if __name__ == "__main__":
    main()
