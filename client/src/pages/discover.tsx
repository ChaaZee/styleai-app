import { useState, useCallback, useEffect, useRef } from "react";
import { depopUrl, isDepopAesthetic } from "@/lib/depop";
import { onLike, onUnlike, rankByVector } from "@/lib/styleVector";

// ── Clothing SVG illustrations ────────────────────────────────────────────────
const ClothingIcons: Record<string, JSX.Element> = {
  shirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <path d="M14 4 L8 10 L4 8 L2 18 L8 17 L8 36 L32 36 L32 17 L38 18 L36 8 L32 10 L26 4 Q23 8 20 8 Q17 8 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  pants: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <path d="M6 4 L34 4 L34 10 L26 10 L26 36 L20 36 L20 18 L20 36 L14 36 L14 10 L6 10 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  dress: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <path d="M15 4 Q20 8 25 4 L30 12 L26 14 L30 36 L10 36 L14 14 L10 12 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  shoes: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <path d="M4 28 L4 20 Q4 14 10 14 L18 14 L18 20 L28 20 Q36 20 36 26 L36 28 L16 28 Q12 28 12 32 L4 32 Q4 30 4 28Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  bag: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <rect x="6" y="14" width="28" height="22" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <path d="M14 14 Q14 6 20 6 Q26 6 26 14" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <line x1="6" y1="22" x2="34" y2="22" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  jacket: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <path d="M14 4 L8 10 L4 8 L2 20 L8 19 L8 36 L32 36 L32 19 L38 20 L36 8 L32 10 L26 4 Q23 9 20 9 Q17 9 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="20" y1="9" x2="20" y2="36" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  skirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <path d="M10 8 L30 8 L36 36 L4 36 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="8" y1="14" x2="32" y2="14" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  accessory: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <circle cx="20" cy="20" r="4" stroke="currentColor" strokeWidth="1.4" fill="none"/>
    </svg>
  ),
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface OutfitCard {
  id: string;
  imageUrl: string;
  aesthetic: string;
  secondaryAesthetic?: string;
  confidence?: number;
  styleBreakdown?: { label: string; pct: number }[];
  palette: string[];
  tags: string[];
  keyPieces?: string[];
  postUrl?: string;
  subreddit?: string;
  likesCount?: number;
}

interface LikedItem {
  id: string;
  aesthetic: string;
  likedAt: number;
}

const OUTFITS: OutfitCard[] = [];

function shuffled(arr: OutfitCard[]): OutfitCard[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Double-tap heart burst ────────────────────────────────────────────────────
function HeartBurst({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-20">
      <svg
        width="90" height="90" viewBox="0 0 24 24"
        fill="#E8405A" stroke="#E8405A" strokeWidth="1"
        style={{ animation: "heartPop 0.55s ease forwards" }}
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </div>
  );
}

// ── Heart button (tap-to-like in bottom bar) ──────────────────────────────────
function HeartButton({ liked, onToggle }: { liked: boolean; onToggle: () => void }) {
  const [burst, setBurst] = useState(false);
  const handle = () => {
    if (!liked) { setBurst(true); setTimeout(() => setBurst(false), 600); }
    onToggle();
  };
  return (
    <button
      onClick={handle}
      aria-label={liked ? "Unlike" : "Like"}
      className="relative flex items-center justify-center w-10 h-10 rounded-full transition-transform active:scale-90"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {burst && (
        <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: "rgba(232,64,90,0.3)", animationDuration: "0.5s" }} />
      )}
      <svg width="24" height="24" viewBox="0 0 24 24"
        fill={liked ? "#E8405A" : "none"}
        stroke="white"
        strokeWidth="1.75" strokeLinecap="round"
        style={{ transition: "fill 0.2s ease, transform 0.15s ease", transform: burst ? "scale(1.3)" : "scale(1)", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }}
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}

// ── Single card — fits exactly one screen ─────────────────────────────────────
function DiscoverCard({
  card, liked, onToggleLike,
}: {
  card: OutfitCard; liked: boolean; onToggleLike: (card: OutfitCard) => void;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showBurst, setShowBurst] = useState(false);
  const lastTap = useRef<number>(0);

  // Double-tap to like
  const handleImageTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 350) {
      // Double tap — like if not already liked
      if (!liked) {
        onToggleLike(card);
        setShowBurst(true);
        setTimeout(() => setShowBurst(false), 600);
      } else {
        // Already liked — just show burst
        setShowBurst(true);
        setTimeout(() => setShowBurst(false), 600);
      }
    }
    lastTap.current = now;
  };

  const keyPieceIcon = (piece: string): keyof typeof ClothingIcons => {
    const p = piece.toLowerCase();
    if (p.includes("pant") || p.includes("jean") || p.includes("trouser") || p.includes("short")) return "pants";
    if (p.includes("shoe") || p.includes("sneaker") || p.includes("boot") || p.includes("heel") || p.includes("sandal")) return "shoes";
    if (p.includes("bag") || p.includes("tote") || p.includes("purse")) return "bag";
    if (p.includes("dress")) return "dress";
    if (p.includes("skirt")) return "skirt";
    if (p.includes("jacket") || p.includes("coat") || p.includes("blazer") || p.includes("hoodie")) return "jacket";
    return "shirt";
  };

  return (
    <div
      className="w-full flex-shrink-0 flex flex-col bg-background"
      style={{ scrollSnapAlign: "start", scrollSnapStop: "always", height: "calc(100svh - 48px - 64px)" }}
    >
      {/* Image — takes ~60% of screen height */}
      <div
        className="relative w-full flex-shrink-0 overflow-hidden bg-muted cursor-pointer"
        style={{ height: "60%" }}
        onClick={handleImageTap}
      >
        {!imgLoaded && !imgError && (
          <div className="absolute inset-0 bg-muted animate-pulse" />
        )}
        {!imgError ? (
          <img
            src={card.imageUrl}
            alt={card.aesthetic}
            className="w-full h-full object-cover"
            style={{ opacity: imgLoaded ? 1 : 0, transition: "opacity 0.3s ease" }}
            onLoad={() => setImgLoaded(true)}
            onError={() => { setImgError(true); setImgLoaded(true); }}
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-muted-foreground text-sm">Image unavailable</span>
          </div>
        )}

        {/* Double-tap heart burst */}
        <HeartBurst visible={showBurst} />

        {/* Aesthetic pill — bottom-left of image */}
        {imgLoaded && !imgError && (
          <div className="absolute bottom-3 left-3">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white backdrop-blur-sm" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
              {card.aesthetic}
            </span>
          </div>
        )}

        {/* Heart button — bottom-right of image */}
        <div className="absolute bottom-3 right-3 z-10">
          <HeartButton liked={liked} onToggle={() => onToggleLike(card)} />
        </div>

        {/* Double-tap hint — fades after 2s on first render */}
        <DoubleTapHint />
      </div>

      {/* Info panel — takes remaining ~40%, internally scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5" style={{ minHeight: 0 }}>

        {/* Palette row */}
        <div className="flex gap-1.5 items-center">
          {card.palette.slice(0, 5).map((hex, i) => (
            <div key={i} className="w-5 h-5 rounded-full border border-border/60 shadow-sm flex-shrink-0" style={{ backgroundColor: hex }} />
          ))}
        </div>

        {/* Key pieces — shop row */}
        {card.keyPieces && card.keyPieces.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Shop the Look</p>
              <div className="flex items-center gap-1">
                <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FF2300" }}>
                  <span className="text-white font-bold" style={{ fontSize: "8px", lineHeight: 1 }}>d</span>
                </div>
                <span className="text-[9px] text-muted-foreground">Depop</span>
              </div>
            </div>
            <div className="flex gap-1.5">
              {card.keyPieces.slice(0, 4).map((piece) => (
                <a
                  key={piece}
                  href={`https://www.depop.com/search/?q=${encodeURIComponent(`${piece} ${card.aesthetic}`)}&sort=relevance`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                >
                  <span className="text-foreground/60 group-hover:text-primary transition-colors">
                    {ClothingIcons[keyPieceIcon(piece)]}
                  </span>
                  <span className="text-[9px] font-medium text-muted-foreground group-hover:text-foreground text-center leading-tight transition-colors line-clamp-2">{piece}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Tags + Reddit source */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 flex-wrap">
            {card.tags.slice(0, 3).map((t) => (
              <span key={t} className="tag text-[10px] px-2 py-0.5">{t}</span>
            ))}
          </div>
          {card.postUrl && (
            <a
              href={card.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
            >
              <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 0C4.478 0 0 4.478 0 10s4.478 10 10 10 10-4.478 10-10S15.522 0 10 0zm4.898 7.01a1.333 1.333 0 1 1 0 2.667 1.333 1.333 0 0 1 0-2.667zm-9.796 0a1.333 1.333 0 1 1 0 2.667 1.333 1.333 0 0 1 0-2.667zM10 15.5c-2.56 0-4.7-1.46-5.5-3.5h11c-.8 2.04-2.94 3.5-5.5 3.5z"/>
              </svg>
              r/{card.subreddit || "reddit"}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── One-time double-tap hint that fades out ───────────────────────────────────
function DoubleTapHint() {
  const [visible, setVisible] = useState(() => !sessionStorage.getItem("stitch_dtap_hint"));
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      setVisible(false);
      sessionStorage.setItem("stitch_dtap_hint", "1");
    }, 2000);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ animation: "fadeOut 2s ease forwards" }}
    >
      <div className="flex flex-col items-center gap-2 bg-black/50 backdrop-blur-sm rounded-2xl px-5 py-3">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="0.5">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <span className="text-white text-xs font-medium">Double tap to like</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function getTopAesthetic(): string | null {
  try {
    const raw = localStorage.getItem("stitch_profile");
    if (raw) { const p = JSON.parse(raw); if (p.aesthetics?.length) return p.aesthetics[0]; }
  } catch {}
  return null;
}

export default function DiscoverPage() {
  const [topAesthetic] = useState<string | null>(getTopAesthetic);
  const [cards, setCards] = useState<OutfitCard[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);

  useEffect(() => {
    fetch("/api/discover")
      .then(r => r.json())
      .then((data: any[]) => {
        if (!Array.isArray(data) || data.length === 0) return;
        const apiCards: OutfitCard[] = data.map(row => ({
          id: String(row.id),
          imageUrl: row.image_url || row.imageUrl,
          aesthetic: row.aesthetic,
          confidence: row.confidence,
          styleBreakdown: (() => { try { return JSON.parse(row.style_breakdown || row.styleBreakdown || "[]"); } catch { return []; } })(),
          palette: (() => { try { return JSON.parse(row.color_palette || row.colorPalette || "[]"); } catch { return []; } })(),
          tags: (() => { try { return JSON.parse(row.tags || "[]"); } catch { return []; } })(),
          keyPieces: (() => { try { return JSON.parse(row.key_pieces || row.keyPieces || "[]"); } catch { return []; } })(),
          postUrl: row.post_url || row.postUrl || null,
          subreddit: row.subreddit || null,
          likesCount: row.likes_count ?? row.likesCount ?? 0,
        }));
        // Sort: vector-ranked first, but boost trending cards (likesCount > 0)
        // into the top half so new users still see popular content
        const ranked = rankByVector(apiCards);
        const trending = [...apiCards].sort((a, b) => (b.likesCount ?? 0) - (a.likesCount ?? 0)).slice(0, 6);
        const trendingIds = new Set(trending.map(c => c.id));
        const rest = ranked.filter(c => !trendingIds.has(c.id));
        // Interleave: 1 trending every 4 cards
        const interleaved: OutfitCard[] = [];
        let ti = 0, ri = 0;
        while (ri < rest.length || ti < trending.length) {
          if (ri < rest.length) interleaved.push(rest[ri++]);
          if (ri % 4 === 0 && ti < trending.length) interleaved.push(trending[ti++]);
        }
        setCards(interleaved);
      })
      .catch(() => {})
      .finally(() => setLoadingFeed(false));
  }, []);

  const [likes, setLikes] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("stitch_likes");
      if (!raw) return {};
      const arr: LikedItem[] = JSON.parse(raw);
      return Object.fromEntries(arr.map((l) => [l.id, true]));
    } catch { return {}; }
  });

  const toggleLike = useCallback((card: OutfitCard) => {
    setLikes((prev) => {
      const next = { ...prev, [card.id]: !prev[card.id] };
      if (next[card.id]) {
        onLike(card.aesthetic, card.tags);
        // Increment server-side likes_count (best-effort, non-blocking)
        fetch(`/api/discover/${card.id}/like`, { method: "POST" }).catch(() => {});
      } else {
        onUnlike(card.aesthetic, card.tags);
      }
      try {
        const raw = localStorage.getItem("stitch_likes");
        const arr: LikedItem[] = raw ? JSON.parse(raw) : [];
        if (next[card.id]) {
          if (!arr.find((l) => l.id === card.id)) arr.push({ id: card.id, aesthetic: card.aesthetic, likedAt: Date.now() });
        } else {
          const idx = arr.findIndex((l) => l.id === card.id);
          if (idx !== -1) arr.splice(idx, 1);
        }
        localStorage.setItem("stitch_likes", JSON.stringify(arr));
      } catch {}
      return next;
    });
  }, []);

  const likedCount = Object.values(likes).filter(Boolean).length;

  return (
    <>
      {/* Keyframe animations */}
      <style>{`
        @keyframes heartPop {
          0%   { transform: scale(0.4); opacity: 0; }
          50%  { transform: scale(1.25); opacity: 1; }
          80%  { transform: scale(0.95); opacity: 1; }
          100% { transform: scale(1.1); opacity: 0; }
        }
        @keyframes fadeOut {
          0%   { opacity: 1; }
          60%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>

      <div
        className="overflow-y-scroll"
        style={{
          scrollSnapType: "y mandatory",
          overscrollBehavior: "contain",
          height: "calc(100svh - 48px - 64px)",
          position: "relative",
          zIndex: 0,
        }}
      >
        {/* Style DNA intro card */}
        {topAesthetic && (
          <div
            className="w-full flex-shrink-0 flex items-center justify-center px-5 bg-background"
            style={{ scrollSnapAlign: "start", height: "calc(100svh - 48px - 64px)" }}
          >
            <div className="text-center max-w-xs">
              <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-3">Your Style</p>
              <h2 className="font-display text-4xl text-foreground mb-2">{topAesthetic}</h2>
              <p className="text-sm text-muted-foreground mb-6">Scroll to explore fits curated for your vibe</p>
              <div className="flex items-center justify-center gap-1 text-muted-foreground/60">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12l7 7 7-7"/>
                </svg>
                <span className="text-xs">Swipe</span>
              </div>
            </div>
          </div>
        )}

        {/* Loading state — inline so NavBar stays usable */}
        {loadingFeed && (
          <div
            className="w-full flex-shrink-0 flex flex-col items-center justify-center gap-4 bg-background"
            style={{ scrollSnapAlign: "start", height: "calc(100svh - 48px - 64px)" }}
          >
            <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-sm text-muted-foreground">Loading outfits…</p>
          </div>
        )}

        {/* Empty state */}
        {!loadingFeed && cards.length === 0 && (
          <div
            className="w-full flex-shrink-0 flex flex-col items-center justify-center gap-3 px-8 text-center bg-background"
            style={{ scrollSnapAlign: "start", height: "calc(100svh - 48px - 64px)" }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/40">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <path d="M3 9h18M9 21V9"/>
            </svg>
            <p className="text-sm font-medium text-foreground">No outfits yet</p>
            <p className="text-xs text-muted-foreground">The discover feed is being populated. Check back soon.</p>
          </div>
        )}

        {cards.map((card) => (
          <DiscoverCard key={card.id} card={card} liked={!!likes[card.id]} onToggleLike={toggleLike} />
        ))}

        {/* End card */}
        <div
          className="w-full flex-shrink-0 flex flex-col items-center justify-center gap-3 bg-background"
          style={{ scrollSnapAlign: "start", height: "calc(100svh - 48px - 64px)" }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="hsl(24 42% 60%)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <p className="font-display text-xl text-foreground">You're all caught up</p>
          <p className="text-sm text-muted-foreground">{likedCount} outfit{likedCount !== 1 ? "s" : ""} liked</p>
        </div>
      </div>
    </>
  );
}
