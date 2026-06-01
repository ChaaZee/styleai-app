"""
delete_depop.py — Remove all Depop listings from the cache
===========================================================

HOW IT WORKS:
    1. Loads every row from depop_cache
    2. For each row, filters out any listing where:
         - _source == "depop"   (explicit source tag)
         - url contains "depop.com"  (fallback for untagged items)
    3. Rows that become empty after removal → deleted entirely
    4. Rows that still have non-Depop listings → updated in place

USAGE:
    pip install psycopg2-binary
    python scripts/python/delete_depop.py              # dry run (safe preview)
    python scripts/python/delete_depop.py --delete     # actually delete
===========================================================
"""

import sys
import json
import psycopg2
import psycopg2.extras

# ── CONFIG ────────────────────────────────────────────────────────────────────
DB_URL  = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
DRY_RUN = "--delete" not in sys.argv  # safe by default


# ── HELPERS ───────────────────────────────────────────────────────────────────
def is_depop(listing: dict) -> bool:
    """Return True if a listing belongs to Depop."""
    if listing.get("_source") == "depop":
        return True
    url = listing.get("url", "")
    if "depop.com" in url:
        return True
    return False


def get_connection():
    return psycopg2.connect(DB_URL, sslmode="require")


def get_all_rows(cursor):
    """Load every non-empty cache row."""
    cursor.execute("""
        SELECT query, listings
        FROM depop_cache
        WHERE jsonb_typeof(listings) = 'array'
          AND jsonb_array_length(listings) > 0
        ORDER BY query
    """)
    return cursor.fetchall()


def delete_row(cursor, query: str):
    cursor.execute("DELETE FROM depop_cache WHERE query = %s", (query,))


def update_row(cursor, query: str, listings: list):
    cursor.execute(
        "UPDATE depop_cache SET listings = %s::jsonb WHERE query = %s",
        (json.dumps(listings), query),
    )


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    mode = "DRY RUN" if DRY_RUN else "LIVE DELETE MODE"
    print(f"\nStitch — Delete Depop Listings — {mode}\n")
    if DRY_RUN:
        print("  Pass --delete to actually remove Depop listings.\n")

    conn = get_connection()
    cur  = conn.cursor()

    print("Loading cache rows...")
    rows = get_all_rows(cur)
    print(f"  {len(rows)} rows loaded\n")

    total_depop   = 0   # individual listings removed
    rows_deleted  = 0   # entire rows dropped (all were depop)
    rows_updated  = 0   # rows trimmed (mixed sources)
    rows_clean    = 0   # rows with no depop at all

    for query, listings_raw in rows:
        # Parse listings JSON (may arrive as str or dict depending on psycopg2)
        if isinstance(listings_raw, str):
            try:
                listings = json.loads(listings_raw)
            except Exception:
                continue
        else:
            listings = listings_raw

        if not isinstance(listings, list) or not listings:
            continue

        depop_items = [l for l in listings if is_depop(l)]
        keep_items  = [l for l in listings if not is_depop(l)]

        if not depop_items:
            rows_clean += 1
            continue  # nothing to do for this row

        total_depop += len(depop_items)

        if not keep_items:
            # Every listing in this row is Depop → delete the whole row
            print(f"  [delete row] \"{query}\" — {len(depop_items)} listing(s) removed, row gone")
            if not DRY_RUN:
                delete_row(cur, query)
                conn.commit()
            rows_deleted += 1
        else:
            # Mixed row → keep non-Depop listings, drop Depop ones
            print(
                f"  [trim row]   \"{query}\" — "
                f"{len(listings)} → {len(keep_items)} "
                f"({len(depop_items)} depop removed)"
            )
            if not DRY_RUN:
                update_row(cur, query, keep_items)
                conn.commit()
            rows_updated += 1

    cur.close()
    conn.close()

    print(f"\n{'='*55}")
    print(f"Done!")
    print(f"  Depop listings found : {total_depop}")
    print(f"  Rows fully deleted   : {rows_deleted}")
    print(f"  Rows trimmed         : {rows_updated}")
    print(f"  Rows unchanged       : {rows_clean}")
    if DRY_RUN:
        print(f"\n  Dry run only — re-run with --delete to apply changes.")
    print()


if __name__ == "__main__":
    main()
