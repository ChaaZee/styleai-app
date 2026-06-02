"""
tag_sources.py — Backfill the `_source` field on every cached listing from its URL
===========================================================================

THE PROBLEM:
    Listings in depop_cache carry a `_source` field ("depop", "asos", "pacsun",
    "grailed", "vinted", "shopify") used for source-diversity in recommendations.
    Older listings predate this field, and a few have the wrong source. The source
    is always derivable from the listing URL, so we can backfill it deterministically.

WHAT THIS SCRIPT DOES:
    1. Loads every depop_cache row (no SQL filtering — listings is parsed in Python
       because some rows store it as a double-encoded JSON string)
    2. For each listing, detects the source from its URL
    3. Sets `_source` if it's missing or "unknown"; warns + overwrites if it differs
    4. Writes changed rows back to the DB (upsert on `query`)
    5. Prints a per-listing log of changes and a final summary

SOURCE DETECTION (priority order, by URL substring):
    depop.com → depop, asos.com → asos, pacsun.com → pacsun,
    grailed.com → grailed, vinted.com → vinted,
    Shopify brands (civilregime.com, mnml.la, unionlosangeles.com,
    carhartt-wip.com) → shopify, anything else → unknown.

USAGE (PowerShell):
    pip install psycopg2-binary
    python scripts/python/tag_sources.py            # dry run (safe, no writes)
    python scripts/python/tag_sources.py --apply    # actually write changes
===========================================================================
"""

import os
import sys
import json
import psycopg2

# ── CONFIG ────────────────────────────────────────────────────────────────────
# Prefer the DATABASE_URL env var; fall back to the shared hardcoded value used
# by the other scripts in this folder.
DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres",
)

DRY_RUN = "--apply" not in sys.argv   # safe by default — pass --apply to write


# ── SOURCE DETECTION ────────────────────────────────────────────────────────--
def detect_source(url: str) -> str:
    """Map a listing URL to its source. First match wins; default 'unknown'."""
    if not url:
        return "unknown"
    if "depop.com" in url:           return "depop"
    if "asos.com" in url:            return "asos"
    if "pacsun.com" in url:          return "pacsun"
    if "grailed.com" in url:         return "grailed"
    if "vinted.com" in url:          return "vinted"
    if "civilregime.com" in url:     return "shopify"
    if "mnml.la" in url:             return "shopify"
    if "unionlosangeles.com" in url: return "shopify"
    if "carhartt-wip.com" in url:    return "shopify"
    return "unknown"


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(DB_URL, sslmode="require")


def get_all_rows(cursor):
    """Load all non-empty cache rows as (query, listings_list).

    Mirrors cleanup.py / fix_depop_titles.py: no jsonb functions in SQL because
    some rows store listings as a double-encoded JSON string. We parse and filter
    out non-array / empty rows in Python instead.
    """
    cursor.execute("SELECT query, listings FROM depop_cache ORDER BY query")
    all_rows = cursor.fetchall()
    result = []
    for query, listings_raw in all_rows:
        if listings_raw is None:
            continue
        # Double-encoded rows arrive as a JSON string — parse once more.
        if isinstance(listings_raw, str):
            try:
                listings = json.loads(listings_raw)
            except Exception:
                continue
        else:
            listings = listings_raw
        # Skip anything that isn't a non-empty list of listings.
        if not isinstance(listings, list) or not listings:
            continue
        result.append((query, listings))
    print(f"  {len(all_rows)} total rows loaded from DB")
    print(f"  {len(result)} rows have usable listings")
    return result


def upsert_row(cursor, query, listings):
    """Write the updated listings array back to the row, keyed on `query`."""
    cursor.execute(
        "UPDATE depop_cache SET listings = %s::jsonb WHERE query = %s",
        (json.dumps(listings), query),
    )


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    mode = "DRY RUN" if DRY_RUN else "APPLY MODE"
    print(f"\nStitch — Tag Sources — {mode}\n")
    if DRY_RUN:
        print("  Pass --apply to actually write changes.\n")

    conn = get_connection()
    cur = conn.cursor()

    print("Loading cache rows...")
    rows = get_all_rows(cur)
    print()

    tagged = skipped = unknown = 0

    for query, listings in rows:
        row_changed = False

        for listing in listings:
            # Never crash on a malformed listing — just skip non-dicts.
            if not isinstance(listing, dict):
                continue

            url = listing.get("url", "") or ""
            detected = detect_source(url)

            # A listing with no URL can't be sourced — tag it unknown and log.
            if not url:
                title = listing.get("title", "") or "(no title)"
                if listing.get("_source") != "unknown":
                    print(f"  [tag] \"{title}\" | (no url) → unknown")
                    listing["_source"] = "unknown"
                    row_changed = True
                    tagged += 1
                else:
                    skipped += 1
                unknown += 1
                continue

            current = listing.get("_source")
            title = listing.get("title", "") or "(no title)"
            short_url = url.replace("https://", "").replace("http://", "")

            if detected == "unknown":
                unknown += 1

            if not current or current == "unknown":
                # Missing or unknown → set to detected value.
                if current == detected:
                    skipped += 1
                    continue
                print(f"  [tag] \"{title}\" | {short_url} → {detected}")
                listing["_source"] = detected
                row_changed = True
                tagged += 1
            elif current == detected:
                # Already correct — leave it alone.
                skipped += 1
            else:
                # Present but wrong — warn and overwrite.
                print(f"  [warn] \"{title}\" | {short_url} | _source \"{current}\" "
                      f"!= detected \"{detected}\" → updating")
                listing["_source"] = detected
                row_changed = True
                tagged += 1

        # Persist the row once, after all its listings are processed.
        if row_changed and not DRY_RUN:
            upsert_row(cur, query, listings)
            conn.commit()

    cur.close()
    conn.close()

    print(f"\n{'='*50}")
    print(f"Tagged {tagged} listings, skipped {skipped} (already correct), unknown {unknown}")
    if DRY_RUN:
        print("Dry run — re-run with --apply to write these changes.")
    print()


if __name__ == "__main__":
    main()
