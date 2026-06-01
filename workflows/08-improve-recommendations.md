# 8. Improving the Recommendation Algorithm

Use when I say "recommendations feel off" or "I keep seeing the same stuff".

### Current algorithm (for context)
1. Get user's taste clusters (k=3 centroids of liked item embeddings)
2. Query depop_cache by cosine distance per cluster
3. Merge, bucket by `_source`, round-robin interleave
4. Filter by gender, return top `limit` items
5. On every like/skip: update taste_vector with temporal decay (0.95), recompute clusters every 5 interactions

### Things worth trying
- **Increase k** — try k=5 clusters for users with many likes (> 20 interactions)
- **Source weighting** — let users implicitly signal source preference (if they always like ASOS, weight ASOS higher)
- **Recency of listings** — prefer newer scrapes over older ones (would need `scraped_at` timestamp)
- **Exploration vs exploitation** — occasionally surface items from outside the user's clusters (epsilon-greedy)
- **Negative signal** — skipped items should push the taste vector away, not just fail to move it toward

### When researching algorithm improvements
Look at:
- How Spotify's Discover Weekly works (collaborative filtering + content-based)
- How Pinterest's homefeed works (interest graphs + visual similarity)
- Papers on fashion recommendation systems (search: "fashion recommendation system cold start")
