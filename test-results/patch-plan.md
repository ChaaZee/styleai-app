============================================================
PATCH PLAN — Fashion AI Test Loop Iteration 1
============================================================

## CRITICAL (Security + Data Integrity)

## HIGH (Algorithmic Taste Failure)

## MEDIUM/WARNINGS (UX + Coverage)

1. [UI/UX Gap] No 'Add to Wardrobe' action on scan results
   File: client/src/pages/results.tsx
   Fix: Add 'Add to Wardrobe' button on product cards; create /api/wardrobe/auto-add endpoint that copies scan results to wardrobe_items.

2. [Algorithmic Taste Failure] Home feed is 135 hardcoded items, not dynamic inventory
   File: client/src/pages/home.tsx
   Fix: Replace static FEED_ITEMS with dynamic fetch from /api/depop-feed or affiliate API; use FEED_ITEMS only as fallback skeleton.