"""
reembed.py — Regenerate OpenAI vector embeddings for all Depop cache rows.

HOW IT WORKS:
  Each row in depop_cache has an "embedding" column — a 1536-dimension vector
  that represents the meaning of that cache row (query + listing titles).

  These embeddings are used for semantic search — when a user's style DNA vector
  is compared against all cache rows to find the most relevant listings for them.

  This script regenerates all embeddings using OpenAI's text-embedding-3-small model.

WHEN TO RUN THIS:
  - After seeding lots of new listings (new rows won't have embeddings yet)
  - After running retag_gender.py (titles may have changed)
  - If you want to improve recommendation quality

COST:
  text-embedding-3-small is very cheap — about $0.02 per 1 million tokens.
  Embedding all ~4000 rows costs roughly $0.01 total.

USAGE:
  pip install psycopg2-binary openai
  python scripts/python/reembed.py

  Or with a custom API key:
  OPENAI_API_KEY=sk-... python scripts/python/reembed.py
"""

import json
import os
import time
import psycopg2
import psycopg2.extras
from openai import OpenAI

# ── CONFIG ────────────────────────────────────────────────────────────────────
DB_URL      = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
OPENAI_KEY  = os.environ.get("OPENAI_API_KEY", "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")
CONCURRENCY = 8     # how many embeddings to generate in parallel
BATCH_SIZE  = 50    # how many rows to process before printing progress
ONLY_MISSING = True # set to False to re-embed ALL rows (even ones that already have embeddings)

client = OpenAI(api_key=OPENAI_KEY)


# ── EMBEDDING ─────────────────────────────────────────────────────────────────
def embed_text(text):
    """
    Calls OpenAI to generate a 1536-dimension vector for the given text.
    Uses text-embedding-3-small (cheap and fast).
    Returns a list of floats.
    """
    resp = client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:800],  # truncate to stay within token limits
        dimensions=1536,
    )
    return resp.data[0].embedding


def build_embed_text(query, listings):
    """
    Builds the text to embed for a cache row.
    Combines the search query with the first 5 listing titles.
    E.g. "mens vintage jacket: Levi's Jacket, Vintage Denim Jacket, ..."
    """
    titles = [l.get("title", "") for l in (listings or [])[:5] if l.get("title")]
    if titles:
        return f"{query}: {', '.join(titles)}"
    return query


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    return psycopg2.connect(DB_URL, sslmode="require")


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    print("\n🪡  Stitch Reembedder\n")

    conn   = get_connection()
    cursor = conn.cursor()

    # Fetch rows that need embedding
    if ONLY_MISSING:
        # Only rows with no embedding yet (faster, cheaper for partial runs)
        cursor.execute("""
            SELECT query, listings FROM depop_cache
            WHERE listings IS NOT NULL
              AND listings::text NOT IN ('[]', 'null', '')
              AND embedding IS NULL
        """)
        print("   Mode: embedding only rows without embeddings (set ONLY_MISSING=False to redo all)\n")
    else:
        # Re-embed everything
        cursor.execute("""
            SELECT query, listings FROM depop_cache
            WHERE listings IS NOT NULL AND listings::text NOT IN ('[]', 'null', '')
        """)
        print("   Mode: re-embedding ALL rows\n")

    rows = cursor.fetchall()
    print(f"📦  {len(rows)} rows to embed\n")

    done    = 0
    failed  = 0
    skipped = 0

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]

        for query, listings_raw in batch:
            # Parse listings
            if isinstance(listings_raw, str):
                try:
                    listings = json.loads(listings_raw)
                except Exception:
                    skipped += 1
                    continue
            else:
                listings = listings_raw

            if not isinstance(listings, list):
                skipped += 1
                continue

            # Build text and embed
            text = build_embed_text(query, listings)
            try:
                vector = embed_text(text)
                # Format as Postgres vector literal: '[0.1, 0.2, ...]'
                vec_str = f"[{','.join(str(v) for v in vector)}]"
                cursor.execute(
                    "UPDATE depop_cache SET embedding = %s::vector WHERE query = %s",
                    (vec_str, query)
                )
                done += 1
            except Exception as e:
                error_msg = str(e)
                failed += 1
                if "429" in error_msg:
                    # Rate limited — wait and retry
                    print(f"  ⏳  Rate limited, waiting 10s...")
                    time.sleep(10)
                else:
                    print(f"  ❌  Failed for \"{query}\": {error_msg}")

        # Commit every batch
        conn.commit()
        pct = min(100, round((i + BATCH_SIZE) / len(rows) * 100))
        print(f"  Progress: {min(i + BATCH_SIZE, len(rows))}/{len(rows)} ({pct}%) — {done} embedded, {failed} failed")

    cursor.close()
    conn.close()
    print(f"\n✅  Done — embedded: {done}, failed: {failed}, skipped: {skipped}\n")


if __name__ == "__main__":
    main()
