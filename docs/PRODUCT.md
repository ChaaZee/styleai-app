# Product Requirements — Core Experience

> The intended behavior of the app, from the user's perspective.  
> This document is the single source of truth for what "good" looks like on every screen and flow.

---

## 1. Whole-Outfit Style Understanding

- The app reads the **entire outfit as one coherent look**, not a pile of disconnected items.
- The model narrates: **silhouette, fabric, layering, color palette, and overall vibe**.
- Output is a **primary style** and a **secondary style** — never a single brittle label or fake confidence bars.
- That style result becomes the anchor for the rest of the experience.

---

## 2. Match Quality

- Judged by how well a product fits the outfit's **actual aesthetic**, not just visual resemblance.
- Comparison dimensions: **silhouette, texture, occasion, era, and styling logic**.
- Items are ranked by how strongly they **support the detected look**.
- If the outfit is blended, the matcher respects **both primary and secondary style signals** instead of forcing a bad single answer.

---

## 3. Visual Search

- Visual search is the **fastest entry point**.
- User uploads a photo, snaps a picture, or saves an inspiration image.
- App returns a **style read plus shoppable matches**.
- Intended behavior: **"Shazam for clothes"** — the image immediately becomes a shopping and styling query.
- Goal: **minimal friction** between seeing something and finding it.

---

## 4. Wardrobe Tracking

- The wardrobe is a **living closet model** that updates automatically.
- Every item bought through the app is added **with no manual effort**.
- The app accounts for **what the user already owns** when suggesting new pieces.
- The wardrobe model powers:
  - Outfit completion
  - Gap detection
  - Better recommendations over time

---

## 5. Style Memory

- Learns **passively** from saved looks, scanned outfits, clicks, and purchases.
- Not a static profile — it builds an **evolving taste model** that gets more accurate the more the app is used.
- This memory is what turns the app into a **personal stylist** rather than a generic fashion search tool.

---

## 6. Color Palette

- Surfaced as a **prominent visual component**, not a tiny afterthought.
- Combine style breakdown and palette into **one panel**.
- Palette presented as **visible dots or strong swatch treatment** that users can inspect easily.
- **Hoverable hex codes** so the palette feels useful, not decorative.

---

## 7. Outfit Completion

- Proactively suggests what's **missing from a look** using the user's own wardrobe as context.
- If the app sees that a user has several compatible items but lacks a key piece, it surfaces that **gap directly**.
- One of the main ways the wardrobe and style engine work together.

---

## 8. Discovery Feed

- Feels like a **fashion-native inspiration layer**, closer to Pinterest than a standard shopping grid.
- Users browse by **aesthetic chips**, save inspiration, and move naturally from discovering a look to shopping for it.
- The feed is styled around the **user's taste**, not just around inventory.

---

## 9. Product Coverage

- Pulls from **affiliate networks and product sources** that cover multiple retailers.
- Web collection as a **fallback**.
- Point is to give **broad availability** while keeping results shoppable and monetizable.
- Filter and organize items at ingestion so only **relevant matches** reach the user.

---

## 10. Navigation and Flow

- Fixed **bottom navigation** with five tabs:
  1. **Home**
  2. **Wardrobe**
  3. **FAB Camera** (center action)
  4. **History**
  5. **Profile**
- The camera action is the **fastest route into the scan flow**.
- History and Profile support saved activity and personalization controls.
- Structure is meant to make the app feel **easy and repeatable** to use.

---

## 11. AI Pipeline

- Multi-pass vision pipeline:
  1. **Identify garments and visual facts** (Pass 1)
  2. **Classify the aesthetic** from that grounded interpretation (Pass 2)
- **Gemini 2.5 Flash** was the chosen model for the vision layer (cost/speed fit for the MVP).
- The model's job is **not just to label**, but to **reason through the outfit in a structured way** before deciding on style.

---

## 12. Style Result as Anchor

- The style result (primary + secondary style) is the **anchor for the rest of the experience**.
- Every downstream feature — match quality, outfit completion, discovery feed, color palette — derives from this central style understanding.
- The system should feel like it **understands fashion**, not just classifies images.
