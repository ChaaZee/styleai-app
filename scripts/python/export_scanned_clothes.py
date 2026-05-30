"""
export_scanned_clothes.py — Export all scanned clothing items to a text file
===========================================================================

HOW TO USE:
    1. pip install psycopg2-binary
    2. Run:  python scripts/python/export_scanned_clothes.py

WHAT IT DOES:
    Reads every scan in your database and extracts the key_pieces field —
    the list of clothing items Gemini detected in each outfit photo.

    Produces two output files:

    scripts/python/scanned_clothes.txt
        One clothing item per line, deduplicated and sorted.
        The other scraper scripts read this file to know what to search for.
        Example:
            baggy cargo pants
            brown leather jacket
            chunky sneakers
            graphic hoodie
            ...

    scripts/python/scanned_clothes_stats.txt
        Same items but with a count showing how many times each was scanned.
        Useful for knowing which items are most popular with your users.
        Example:
            23x  graphic hoodie
            18x  cargo pants
            15x  chunky sneakers
            ...

WHY THIS IS USEFUL:
    Instead of hardcoding search queries in the scraper scripts, you can
    use the actual clothing your users are scanning. This makes the cache
    much more relevant — if users keep scanning hoodies and cargos, the
    app will surface more of those items.

HOW TO USE THE OUTPUT IN OTHER SCRIPTS:
    At the top of any scraper script, add:

        # Load scanned clothes as search queries
        with open("scripts/python/scanned_clothes.txt") as f:
            queries = [line.strip() for line in f if line.strip()]

    Then loop over `queries` instead of a hardcoded list.
===========================================================================
"""

import psycopg2
import json
import re
from collections import Counter
from pathlib import Path


# ── DATABASE ──────────────────────────────────────────────────────────────────
DB_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# ── OUTPUT FILES ──────────────────────────────────────────────────────────────
# Both files are saved in the same directory as this script
SCRIPT_DIR = Path(__file__).parent
OUTPUT_FILE = SCRIPT_DIR / "scanned_clothes.txt"        # plain list (used by other scripts)
STATS_FILE  = SCRIPT_DIR / "scanned_clothes_stats.txt"  # list with counts (for your reference)


# ── CONFIG ────────────────────────────────────────────────────────────────────
MIN_COUNT = 1       # only include items that appear at least this many times
                    # increase to 2 or 3 to filter out one-off items


def clean_item(item):
    """
    Normalize a clothing item string for deduplication.

    Examples:
        "Blue Graphic Hoodie"  →  "graphic hoodie"
        "CARGO PANTS (brown)"  →  "cargo pants"
        "  chunky sneakers  "  →  "chunky sneakers"

    We lowercase, strip extra whitespace, and remove color words so that
    "blue hoodie" and "black hoodie" both count as "hoodie".
    """
    if not isinstance(item, str):
        return None

    # Lowercase and strip whitespace
    item = item.lower().strip()

    # Remove content in parentheses — often color descriptions like "(brown)"
    item = re.sub(r'\([^)]*\)', '', item).strip()

    # Remove common color words that add noise but don't describe the garment type
    color_words = [
        "black", "white", "grey", "gray", "brown", "blue", "red", "green",
        "yellow", "orange", "purple", "pink", "navy", "beige", "cream",
        "tan", "olive", "burgundy", "maroon", "khaki", "dark", "light",
        "bright", "pale", "deep", "rich", "faded", "washed", "distressed",
    ]
    for color in color_words:
        # Remove color word only if it's a separate word (not part of "colorblock")
        item = re.sub(rf'\b{color}\b', '', item).strip()

    # Collapse multiple spaces into one
    item = re.sub(r'\s+', ' ', item).strip()

    # Skip empty strings or single characters
    if len(item) < 3:
        return None

    return item


def extract_key_pieces(raw_value):
    """
    Parse the key_pieces column from the database.

    key_pieces is stored as a TEXT column containing a JSON array:
        '["graphic hoodie", "cargo pants", "chunky sneakers"]'

    We parse it and return a list of strings.
    If it's already a list (from psycopg2 auto-parsing), return it directly.
    """
    if not raw_value:
        return []

    # If psycopg2 already parsed it as a list, use it directly
    if isinstance(raw_value, list):
        return raw_value

    # If it's a JSON string, parse it
    if isinstance(raw_value, str):
        raw_value = raw_value.strip()
        # Handle both JSON arrays and comma-separated strings
        if raw_value.startswith('['):
            try:
                return json.loads(raw_value)
            except json.JSONDecodeError:
                pass
        # Fall back to comma splitting for plain text lists
        return [x.strip() for x in raw_value.split(',') if x.strip()]

    return []


def main():
    print("=" * 60)
    print("Stitch — Export Scanned Clothes")
    print("=" * 60)

    # Connect to database
    conn = psycopg2.connect(DB_URL, sslmode="require")
    cur = conn.cursor()
    print("✓ Connected to database\n")

    # Fetch all scans — we only need the key_pieces column
    # key_pieces contains the list of clothing items Gemini detected
    print("Fetching all scans...")
    cur.execute("SELECT key_pieces FROM scans WHERE key_pieces IS NOT NULL")
    rows = cur.fetchall()
    print(f"Found {len(rows)} scans\n")

    cur.close()
    conn.close()

    # Extract and count all clothing items across all scans
    item_counter = Counter()

    for (raw_key_pieces,) in rows:
        # Parse the key_pieces value into a list of strings
        items = extract_key_pieces(raw_key_pieces)

        for item in items:
            # Clean and normalize the item name
            cleaned = clean_item(item)
            if cleaned:
                item_counter[cleaned] += 1

    print(f"Total unique items found: {len(item_counter)}")
    print(f"Total item mentions: {sum(item_counter.values())}\n")

    # Filter to items that meet the minimum count threshold
    filtered = {item: count for item, count in item_counter.items() if count >= MIN_COUNT}
    print(f"Items after filtering (min {MIN_COUNT} appearances): {len(filtered)}\n")

    # ── Write scanned_clothes.txt ─────────────────────────────────────────────
    # Plain list, one item per line, sorted alphabetically
    # This is what the scraper scripts read from
    sorted_items = sorted(filtered.keys())

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for item in sorted_items:
            f.write(item + "\n")

    print(f"✓ Wrote {len(sorted_items)} items to: {OUTPUT_FILE}")

    # ── Write scanned_clothes_stats.txt ──────────────────────────────────────
    # Same items but sorted by frequency (most scanned first) with counts
    # This is just for your reference — not read by other scripts
    sorted_by_count = sorted(filtered.items(), key=lambda x: x[1], reverse=True)

    with open(STATS_FILE, "w", encoding="utf-8") as f:
        f.write("# Scanned clothing items — sorted by frequency\n")
        f.write(f"# Total scans analyzed: {len(rows)}\n")
        f.write(f"# Unique items: {len(filtered)}\n\n")
        for item, count in sorted_by_count:
            # Pad the count for alignment: "23x  graphic hoodie"
            f.write(f"{count:>4}x  {item}\n")

    print(f"✓ Wrote stats to: {STATS_FILE}")

    # Print top 20 most scanned items to the console
    print("\nTop 20 most scanned clothing items:")
    for item, count in sorted_by_count[:20]:
        print(f"  {count:>4}x  {item}")


if __name__ == "__main__":
    main()
