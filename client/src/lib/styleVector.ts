// ── Style Preference Vector ────────────────────────────────────────────────
// Lightweight on-device aesthetic affinity tracker.
// Shape: Record<Aesthetic, number> — each value float in [0, 1].
// Stored in localStorage under VECTOR_KEY.

export const AESTHETICS = [
  "Minimalist",
  "Clean Girl",
  "Old Money",
  "Streetwear",
  "Hypebeast",
  "Y2K",
  "Romantic",
  "Cottagecore",
  "Boho",
  "Dark Academia",
  "Indie",
  "Grunge",
  "Coastal",
  "Preppy",
  "Business Casual",
  "Athleisure",
] as const;

export type Aesthetic = (typeof AESTHETICS)[number];
export type StyleVector = Record<Aesthetic, number> & { _v: number };

const VECTOR_KEY = "stitch_style_vector";
const FLOOR = 0.03;
const DECAY = 0.99;

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function emptyVector(): StyleVector {
  const v = { _v: 1 } as StyleVector;
  for (const a of AESTHETICS) v[a] = FLOOR;
  return v;
}

export function loadVector(): StyleVector {
  try {
    const raw = localStorage.getItem(VECTOR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StyleVector;
      // Ensure all keys exist (forward compat if new aesthetics added)
      for (const a of AESTHETICS) {
        if (typeof parsed[a] !== "number") parsed[a] = FLOOR;
      }
      return parsed;
    }
  } catch {}
  return emptyVector();
}

function saveVector(v: StyleVector): void {
  localStorage.setItem(VECTOR_KEY, JSON.stringify(v));
  // Notify any listeners (e.g. home feed) to re-rank
  window.dispatchEvent(new CustomEvent("stitch_vector_updated"));
}

// ── Initialisation from quiz ───────────────────────────────────────────────
// top-3 aesthetics from quiz → seed scores, rest get floor 0.05

const QUIZ_SEEDS = [0.9, 0.6, 0.35] as const;

export function initVectorFromQuiz(top3: string[]): StyleVector {
  const v = emptyVector();
  top3.slice(0, 3).forEach((aesthetic, i) => {
    if (isAesthetic(aesthetic)) {
      v[aesthetic] = QUIZ_SEEDS[i] ?? 0.05;
    }
  });
  saveVector(v);
  return v;
}

// ── Update signals ─────────────────────────────────────────────────────────

function isAesthetic(s: string): s is Aesthetic {
  return (AESTHETICS as readonly string[]).includes(s);
}

function applyBoost(
  v: StyleVector,
  targetAesthetic: string | undefined,
  targetTags: string[],
  primaryDelta: number,
  decayOthers: boolean
): StyleVector {
  const updated = { ...v };

  // Decay non-target aesthetics first
  if (decayOthers && targetAesthetic && isAesthetic(targetAesthetic)) {
    for (const a of AESTHETICS) {
      if (a !== targetAesthetic) {
        updated[a] = Math.max(FLOOR, updated[a] * DECAY);
      }
    }
  }

  // Boost primary aesthetic
  if (targetAesthetic && isAesthetic(targetAesthetic)) {
    updated[targetAesthetic] = clamp(updated[targetAesthetic] + primaryDelta);
  }

  // Boost tag-mapped aesthetics at half strength
  for (const tag of targetTags) {
    if (isAesthetic(tag)) {
      updated[tag] = clamp(updated[tag] + primaryDelta * 0.5);
    }
  }

  saveVector(updated);
  return updated;
}

/** User liked a discover card */
export function onLike(aesthetic: string, tags: string[] = []): StyleVector {
  return applyBoost(loadVector(), aesthetic, tags, +0.08, true);
}

/** User unliked a discover card */
export function onUnlike(aesthetic: string, tags: string[] = []): StyleVector {
  const v = { ...loadVector() };
  if (isAesthetic(aesthetic)) {
    v[aesthetic] = clamp(v[aesthetic] - 0.08);
  }
  for (const tag of tags) {
    if (isAesthetic(tag)) v[tag] = clamp(v[tag] - 0.04);
  }
  saveVector(v);
  return v;
}

/** Scan result was viewed for > 2s (passive signal) */
export function onResultViewed(aesthetics: string[]): StyleVector {
  const v = { ...loadVector() };
  for (const a of aesthetics) {
    if (isAesthetic(a)) v[a] = clamp(v[a] + 0.04);
  }
  saveVector(v);
  return v;
}

/** Scan result was explicitly liked/saved */
export function onResultSaved(aesthetics: string[], tags: string[] = []): StyleVector {
  // Use the first aesthetic as primary for decay purposes
  return applyBoost(loadVector(), aesthetics[0], [...aesthetics.slice(1), ...tags], +0.12, true);
}

/** Item scrolled past 3 times without interaction — mild negative signal */
export function onIgnored(aesthetic: string): StyleVector {
  const v = { ...loadVector() };
  if (isAesthetic(aesthetic) && v[aesthetic] > 0.15) {
    v[aesthetic] = clamp(v[aesthetic] - 0.03);
  }
  saveVector(v);
  return v;
}

// ── Scoring & ranking ──────────────────────────────────────────────────────

/**
 * Score an item against the current vector.
 * 0.7 × primary aesthetic score + 0.3 × mean tag score + small random nudge.
 */
export function scoreItem(
  v: StyleVector,
  aesthetic: string,
  tags: string[] = []
): number {
  const baseScore = isAesthetic(aesthetic) ? v[aesthetic] : 0;

  const tagScores = tags
    .filter(isAesthetic)
    .map((t) => v[t]);
  const tagScore = tagScores.length > 0
    ? tagScores.reduce((a, b) => a + b, 0) / tagScores.length
    : 0;

  const nudge = (Math.random() - 0.5) * 0.05; // ±0.025 to prevent convergence
  return 0.7 * baseScore + 0.3 * tagScore + nudge;
}

/**
 * Sort an array of items by vector affinity (highest first).
 * Items must have `aesthetic: string` and optionally `tags: string[]`.
 */
export function rankByVector<T extends { aesthetic: string; tags?: string[] }>(
  items: T[]
): T[] {
  const v = loadVector();
  return [...items].sort(
    (a, b) =>
      scoreItem(v, b.aesthetic, b.tags) - scoreItem(v, a.aesthetic, a.tags)
  );
}

// ── Debug helper (dev only) ────────────────────────────────────────────────
export function getTopAesthetics(n = 3): Aesthetic[] {
  const v = loadVector();
  return (Object.entries(v) as [Aesthetic, number][])
    .filter(([k]) => k !== ("_v" as Aesthetic))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}
