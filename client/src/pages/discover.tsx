import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
interface OutfitCard {
  id: string;
  imageUrl: string;
  aesthetic: string;
  description: string;
}

interface LikedItem {
  id: string;
  aesthetic: string;
  likedAt: number;
}

// ── Outfit inspiration data ──────────────────────────────────────────────────
// Unsplash photos organised by aesthetic — free, no API key needed
const OUTFITS: OutfitCard[] = [
  // Clean Girl / Minimal
  {
    id: "cg1",
    imageUrl: "https://images.unsplash.com/photo-1594938298603-c8148c4b4057?w=800&q=80",
    aesthetic: "Clean Girl",
    description: "Effortless minimalism — neutral tones, sleek lines",
  },
  {
    id: "cg2",
    imageUrl: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&q=80",
    aesthetic: "Clean Girl",
    description: "Tonal dressing — monochrome done right",
  },
  // Streetwear
  {
    id: "sw1",
    imageUrl: "https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&q=80",
    aesthetic: "Streetwear",
    description: "Urban edge — hoodies, cargos, kicks",
  },
  {
    id: "sw2",
    imageUrl: "https://images.unsplash.com/photo-1556906781-9a412961a28c?w=800&q=80",
    aesthetic: "Streetwear",
    description: "Street-ready layering with graphic energy",
  },
  // Dark Academia
  {
    id: "da1",
    imageUrl: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800&q=80",
    aesthetic: "Dark Academia",
    description: "Tweed, plaid, and brooding intellectual energy",
  },
  // Cottagecore
  {
    id: "cc1",
    imageUrl: "https://images.unsplash.com/photo-1600950207944-0d63e8edbc3f?w=800&q=80",
    aesthetic: "Cottagecore",
    description: "Floral prints, prairie silhouettes, golden hour",
  },
  // Athleisure
  {
    id: "at1",
    imageUrl: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=800&q=80",
    aesthetic: "Athleisure",
    description: "Performance meets polish — sleek and active",
  },
  {
    id: "at2",
    imageUrl: "https://images.unsplash.com/photo-1538805060514-97d9cc17730c?w=800&q=80",
    aesthetic: "Athleisure",
    description: "Matching sets that move with you",
  },
  // Boho
  {
    id: "bh1",
    imageUrl: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&q=80",
    aesthetic: "Boho",
    description: "Free-spirited layers, earthy textures, fringe details",
  },
  // Hypebeast
  {
    id: "hb1",
    imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80",
    aesthetic: "Hypebeast",
    description: "Limited drops, bold logos, sneaker culture",
  },
  // Old Money
  {
    id: "om1",
    imageUrl: "https://images.unsplash.com/photo-1487222477894-8943e31ef7b2?w=800&q=80",
    aesthetic: "Old Money",
    description: "Quiet luxury — cashmere, blazers, understated wealth",
  },
  {
    id: "om2",
    imageUrl: "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80",
    aesthetic: "Old Money",
    description: "Heritage tailoring, neutral palette, effortless class",
  },
  // Y2K
  {
    id: "y2k1",
    imageUrl: "https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=800&q=80",
    aesthetic: "Y2K",
    description: "Low-rise, metallics, and early-2000s nostalgia",
  },
  // Preppy
  {
    id: "pp1",
    imageUrl: "https://images.unsplash.com/photo-1617127365659-c47fa864d8bc?w=800&q=80",
    aesthetic: "Preppy",
    description: "Polo shirts, chinos, varsity energy",
  },
  // Minimalist
  {
    id: "mn1",
    imageUrl: "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=80",
    aesthetic: "Minimalist",
    description: "Less is more — clean silhouettes, zero noise",
  },
  {
    id: "mn2",
    imageUrl: "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800&q=80",
    aesthetic: "Minimalist",
    description: "Structural simplicity in warm neutral tones",
  },
  // Romantic
  {
    id: "ro1",
    imageUrl: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800&q=80",
    aesthetic: "Romantic",
    description: "Soft florals, lace, and feminine grace",
  },
  // Business Casual
  {
    id: "bc1",
    imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80",
    aesthetic: "Business Casual",
    description: "Smart-casual balance — polished but approachable",
  },
  // Indie / Alt
  {
    id: "in1",
    imageUrl: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=800&q=80",
    aesthetic: "Indie",
    description: "Thrifted layers, band tees, creative expression",
  },
  // Coastal / Resort
  {
    id: "cs1",
    imageUrl: "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=800&q=80",
    aesthetic: "Coastal",
    description: "Breezy linens, nautical accents, sun-kissed ease",
  },
];

// Shuffle for variety on each session
function shuffled(arr: OutfitCard[]): OutfitCard[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Heart button ─────────────────────────────────────────────────────────────
function HeartButton({ liked, onToggle }: { liked: boolean; onToggle: () => void }) {
  const [burst, setBurst] = useState(false);

  const handleClick = () => {
    if (!liked) {
      setBurst(true);
      setTimeout(() => setBurst(false), 600);
    }
    onToggle();
  };

  return (
    <button
      onClick={handleClick}
      aria-label={liked ? "Unlike" : "Like"}
      className="relative flex items-center justify-center w-14 h-14 rounded-full transition-transform active:scale-90"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {/* Burst rings */}
      {burst && (
        <>
          <span className="absolute inset-0 rounded-full animate-ping"
            style={{ backgroundColor: "rgba(200,149,106,0.3)", animationDuration: "0.5s" }} />
          <span className="absolute inset-2 rounded-full animate-ping"
            style={{ backgroundColor: "rgba(200,149,106,0.2)", animationDuration: "0.4s", animationDelay: "0.05s" }} />
        </>
      )}
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill={liked ? "#C8956A" : "none"}
        stroke={liked ? "#C8956A" : "rgba(255,255,255,0.9)"}
        strokeWidth="2"
        strokeLinecap="round"
        style={{
          transition: "fill 0.2s ease, transform 0.2s ease",
          transform: burst ? "scale(1.3)" : "scale(1)",
          filter: liked ? "drop-shadow(0 0 6px rgba(200,149,106,0.6))" : "drop-shadow(0 1px 3px rgba(0,0,0,0.5))",
        }}
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}

// ── Single card ───────────────────────────────────────────────────────────────
function DiscoverCard({
  card,
  liked,
  onToggleLike,
}: {
  card: OutfitCard;
  liked: boolean;
  onToggleLike: (card: OutfitCard) => void;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className="relative w-full flex-shrink-0 overflow-hidden bg-black"
      style={{ height: "100svh" }}
    >
      {/* Skeleton */}
      {!imgLoaded && !imgError && (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      )}

      {/* Image */}
      {!imgError ? (
        <img
          src={card.imageUrl}
          alt={card.aesthetic}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: imgLoaded ? 1 : 0, transition: "opacity 0.3s ease" }}
          onLoad={() => setImgLoaded(true)}
          onError={() => { setImgError(true); setImgLoaded(true); }}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <span className="text-muted-foreground text-sm">Image unavailable</span>
        </div>
      )}

      {/* Gradient overlay — bottom */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: "55%",
          background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)",
        }}
      />

      {/* Gradient overlay — top (for safe-area) */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          height: "80px",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, transparent 100%)",
        }}
      />

      {/* Content — bottom left */}
      <div className="absolute bottom-0 left-0 right-16 p-5 pb-8" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}>
        {/* Aesthetic tag */}
        <span
          className="inline-block text-xs font-semibold tracking-wider uppercase px-2.5 py-1 rounded-full mb-2"
          style={{ backgroundColor: "rgba(200,149,106,0.85)", color: "#fff" }}
        >
          {card.aesthetic}
        </span>
        {/* Description */}
        <p className="text-white text-sm font-medium leading-snug" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
          {card.description}
        </p>
      </div>

      {/* Heart — bottom right */}
      <div
        className="absolute bottom-0 right-2 flex flex-col items-center gap-1 pb-6"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <HeartButton liked={liked} onToggle={() => onToggleLike(card)} />
        {liked && (
          <span className="text-xs font-semibold" style={{ color: "#C8956A", textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
            Liked
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DiscoverPage() {
  const [cards] = useState<OutfitCard[]>(() => shuffled(OUTFITS));
  const [likes, setLikes] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("stitch_likes");
      if (!raw) return {};
      const arr: LikedItem[] = JSON.parse(raw);
      return Object.fromEntries(arr.map((l) => [l.id, true]));
    } catch {
      return {};
    }
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Persist likes
  const toggleLike = useCallback((card: OutfitCard) => {
    setLikes((prev) => {
      const next = { ...prev, [card.id]: !prev[card.id] };

      try {
        const raw = localStorage.getItem("stitch_likes");
        const arr: LikedItem[] = raw ? JSON.parse(raw) : [];
        if (next[card.id]) {
          // Add
          if (!arr.find((l) => l.id === card.id)) {
            arr.push({ id: card.id, aesthetic: card.aesthetic, likedAt: Date.now() });
          }
        } else {
          // Remove
          const idx = arr.findIndex((l) => l.id === card.id);
          if (idx !== -1) arr.splice(idx, 1);
        }
        localStorage.setItem("stitch_likes", JSON.stringify(arr));
      } catch {}

      return next;
    });
  }, []);

  // Snap scroll via CSS — smooth feel
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-y-scroll"
      style={{
        scrollSnapType: "y mandatory",
        WebkitOverflowScrolling: "touch",
        // Account for top bar (48px) + bottom nav (64px)
        top: 0,
        bottom: 0,
      }}
    >
      {/* Header overlay — "Discover" title on top of first card */}
      <div
        className="fixed top-0 left-0 right-0 z-30 flex items-center px-5 pointer-events-none"
        style={{ height: 48 }}
      >
        <span
          className="font-display text-base text-white"
          style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}
        >
          Discover
        </span>
      </div>

      {cards.map((card) => (
        <div
          key={card.id}
          style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}
        >
          <DiscoverCard
            card={card}
            liked={!!likes[card.id]}
            onToggleLike={toggleLike}
          />
        </div>
      ))}

      {/* End card */}
      <div
        className="relative w-full flex-shrink-0 flex flex-col items-center justify-center gap-4 bg-background"
        style={{ height: "100svh", scrollSnapAlign: "start" }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="hsl(24 42% 60%)" strokeWidth="1.5" strokeLinecap="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <p className="font-display text-xl text-foreground">You're all caught up</p>
        <p className="text-sm text-muted-foreground">
          {Object.values(likes).filter(Boolean).length} outfit{Object.values(likes).filter(Boolean).length !== 1 ? "s" : ""} liked
        </p>
      </div>
    </div>
  );
}
