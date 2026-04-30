import { useState, useCallback, useEffect } from "react";
import { depopUrl, isDepopAesthetic } from "@/lib/depop";
import { onLike, onUnlike, rankByVector } from "@/lib/styleVector";

// ── Clothing SVG illustrations ────────────────────────────────────────────────
const ClothingIcons: Record<string, JSX.Element> = {
  shirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <path d="M14 4 L8 10 L4 8 L2 18 L8 17 L8 36 L32 36 L32 17 L38 18 L36 8 L32 10 L26 4 Q23 8 20 8 Q17 8 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  pants: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <path d="M6 4 L34 4 L34 10 L26 10 L26 36 L20 36 L20 18 L20 36 L14 36 L14 10 L6 10 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  dress: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <path d="M15 4 Q20 8 25 4 L30 12 L26 14 L30 36 L10 36 L14 14 L10 12 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  shoes: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <path d="M4 28 L4 20 Q4 14 10 14 L18 14 L18 20 L28 20 Q36 20 36 26 L36 28 L16 28 Q12 28 12 32 L4 32 Q4 30 4 28Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  bag: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <rect x="6" y="14" width="28" height="22" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <path d="M14 14 Q14 6 20 6 Q26 6 26 14" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <line x1="6" y1="22" x2="34" y2="22" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  jacket: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <path d="M14 4 L8 10 L4 8 L2 20 L8 19 L8 36 L32 36 L32 19 L38 20 L36 8 L32 10 L26 4 Q23 9 20 9 Q17 9 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="20" y1="9" x2="20" y2="36" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  skirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <path d="M10 8 L30 8 L36 36 L4 36 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="8" y1="14" x2="32" y2="14" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  accessory: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <circle cx="20" cy="20" r="4" stroke="currentColor" strokeWidth="1.4" fill="none"/>
      <line x1="10" y1="10" x2="16" y2="16" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="30" y1="10" x2="24" y2="16" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="10" y1="30" x2="16" y2="24" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="30" y1="30" x2="24" y2="24" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
};

// ── Shop items per card ───────────────────────────────────────────────────────
interface ShopItem {
  label: string;
  icon: keyof typeof ClothingIcons;
  query: string; // Depop search query
}

const CARD_ITEMS: Record<string, ShopItem[]> = {
  cg1: [
    { label: "Linen shirt", icon: "shirt", query: "clean girl linen shirt neutral" },
    { label: "Straight trousers", icon: "pants", query: "minimalist straight leg trousers beige" },
    { label: "Simple flats", icon: "shoes", query: "ballet flats neutral minimalist" },
  ],
  cg2: [
    { label: "Midi skirt", icon: "skirt", query: "clean girl midi skirt monochrome" },
    { label: "Fitted top", icon: "shirt", query: "fitted ribbed top neutral tones" },
    { label: "Tote bag", icon: "bag", query: "minimalist tote bag neutral" },
  ],
  sw1: [
    { label: "Oversized hoodie", icon: "jacket", query: "oversized hoodie streetwear" },
    { label: "Cargo pants", icon: "pants", query: "cargo pants streetwear urban" },
    { label: "Sneakers", icon: "shoes", query: "streetwear sneakers kicks" },
  ],
  sw2: [
    { label: "Graphic tee", icon: "shirt", query: "graphic tee streetwear indie" },
    { label: "Wide-leg jeans", icon: "pants", query: "wide leg jeans streetwear" },
    { label: "Crossbody bag", icon: "bag", query: "crossbody bag streetwear" },
  ],
  da1: [
    { label: "Tweed blazer", icon: "jacket", query: "dark academia tweed blazer" },
    { label: "Plaid trousers", icon: "pants", query: "dark academia plaid trousers" },
    { label: "Loafers", icon: "shoes", query: "dark academia loafers vintage" },
  ],
  cc1: [
    { label: "Prairie dress", icon: "dress", query: "cottagecore prairie dress floral" },
    { label: "Mary Janes", icon: "shoes", query: "cottagecore mary jane shoes" },
    { label: "Wicker bag", icon: "bag", query: "cottagecore wicker basket bag" },
  ],
  at1: [
    { label: "Sports bra", icon: "shirt", query: "athleisure sports bra sleek" },
    { label: "Leggings", icon: "pants", query: "athleisure leggings high waist" },
    { label: "Trainers", icon: "shoes", query: "athleisure trainers running" },
  ],
  at2: [
    { label: "Matching set top", icon: "shirt", query: "athleisure matching set top" },
    { label: "Matching set bottoms", icon: "pants", query: "athleisure matching set shorts" },
    { label: "Gym bag", icon: "bag", query: "gym bag sporty minimalist" },
  ],
  bh1: [
    { label: "Boho dress", icon: "dress", query: "boho maxi dress earthy fringe" },
    { label: "Suede boots", icon: "shoes", query: "boho suede boots fringe" },
    { label: "Fringe bag", icon: "bag", query: "boho fringe bag earthy" },
  ],
  hb1: [
    { label: "Logo tee", icon: "shirt", query: "hypebeast logo tee bold" },
    { label: "Joggers", icon: "pants", query: "hypebeast joggers streetwear" },
    { label: "Hype sneakers", icon: "shoes", query: "hype sneakers limited drop" },
  ],
  om1: [
    { label: "Cashmere knit", icon: "shirt", query: "old money cashmere knit sweater" },
    { label: "Tailored trousers", icon: "pants", query: "old money tailored trousers" },
    { label: "Leather loafers", icon: "shoes", query: "old money leather loafers" },
  ],
  om2: [
    { label: "Wool blazer", icon: "jacket", query: "old money heritage wool blazer" },
    { label: "Slim trousers", icon: "pants", query: "old money slim neutral trousers" },
    { label: "Structured bag", icon: "bag", query: "old money structured leather bag" },
  ],
  y2k1: [
    { label: "Low-rise jeans", icon: "pants", query: "y2k low rise jeans 2000s" },
    { label: "Crop top", icon: "shirt", query: "y2k crop top metallic 2000s" },
    { label: "Platform shoes", icon: "shoes", query: "y2k platform shoes chunky" },
  ],
  pp1: [
    { label: "Polo shirt", icon: "shirt", query: "preppy polo shirt varsity" },
    { label: "Chinos", icon: "pants", query: "preppy chinos classic" },
    { label: "Boat shoes", icon: "shoes", query: "preppy boat shoes sperry" },
  ],
  mn1: [
    { label: "Clean white tee", icon: "shirt", query: "minimalist white tee structured" },
    { label: "Straight jeans", icon: "pants", query: "minimalist straight jeans white" },
    { label: "Simple sneakers", icon: "shoes", query: "minimalist clean sneakers white" },
  ],
  ro1: [
    { label: "Floral dress", icon: "dress", query: "romantic floral dress lace" },
    { label: "Kitten heels", icon: "shoes", query: "romantic kitten heels feminine" },
    { label: "Dainty bag", icon: "bag", query: "romantic small bag feminine" },
  ],
  bc1: [
    { label: "Tailored blazer", icon: "jacket", query: "business casual blazer polished" },
    { label: "Slim trousers", icon: "pants", query: "business casual trousers smart" },
    { label: "Oxford shoes", icon: "shoes", query: "business casual oxford shoes" },
  ],
  in1: [
    { label: "Vintage band tee", icon: "shirt", query: "indie vintage band tee thrifted" },
    { label: "Wide-leg cords", icon: "pants", query: "indie corduroy wide leg pants" },
    { label: "Doc Martens", icon: "shoes", query: "doc martens indie thrifted" },
  ],
  cs1: [
    { label: "Linen shirt", icon: "shirt", query: "coastal linen shirt breezy" },
    { label: "Linen trousers", icon: "pants", query: "coastal linen trousers wide leg" },
    { label: "Espadrilles", icon: "shoes", query: "espadrilles coastal summer" },
  ],
  mn2: [
    { label: "Neutral knit", icon: "shirt", query: "minimalist neutral knit warm" },
    { label: "Tailored trousers", icon: "pants", query: "minimalist tailored trousers warm" },
    { label: "Simple mules", icon: "shoes", query: "minimalist mules neutral" },
  ],
};

// ── Types ────────────────────────────────────────────────────────────────────
interface OutfitCard {
  id: string;
  imageUrl: string;
  aesthetic: string;
  secondaryAesthetic?: string;
  description?: string;
  confidence?: number;
  styleBreakdown?: { label: string; pct: number }[];
  palette: string[];
  tags: string[];
  keyPieces?: string[];
}

interface LikedItem {
  id: string;
  aesthetic: string;
  likedAt: number;
}

// ── Outfit inspiration data ──────────────────────────────────────────────────
const OUTFITS: OutfitCard[] = [
  {
    id: "cg1",
    imageUrl: "https://images.unsplash.com/photo-1594938298603-c8148c4b4057?w=800&q=80",
    aesthetic: "Clean Girl",
    secondaryAesthetic: "Minimalist",
    description: "Effortless neutrals, sleek silhouettes",
    palette: ["#F5EFE6", "#D4C5B0", "#8C7B6B", "#4A3F35"],
    tags: ["Neutral tones", "Everyday", "Casual"],
  },
  {
    id: "cg2",
    imageUrl: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&q=80",
    aesthetic: "Clean Girl",
    secondaryAesthetic: "Old Money",
    description: "Tonal dressing — monochrome done right",
    palette: ["#E8E0D8", "#B8A898", "#786858", "#2C2420"],
    tags: ["Monochrome", "Polished", "Chic"],
  },
  {
    id: "sw1",
    imageUrl: "https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&q=80",
    aesthetic: "Streetwear",
    secondaryAesthetic: "Hypebeast",
    description: "Urban edge — hoodies, cargos, kicks",
    palette: ["#1A1A1A", "#3D3D3D", "#C8956A", "#F0F0F0"],
    tags: ["Urban", "Oversized", "Sneakers"],
  },
  {
    id: "sw2",
    imageUrl: "https://images.unsplash.com/photo-1556906781-9a412961a28c?w=800&q=80",
    aesthetic: "Streetwear",
    secondaryAesthetic: "Indie",
    description: "Street-ready layering with graphic energy",
    palette: ["#2B2B2B", "#5C4033", "#D4A574", "#E8E0D0"],
    tags: ["Graphic tee", "Layered", "Bold"],
  },
  {
    id: "da1",
    imageUrl: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800&q=80",
    aesthetic: "Dark Academia",
    secondaryAesthetic: "Preppy",
    description: "Tweed, plaid, and brooding intellectual energy",
    palette: ["#2C2416", "#5C4A2A", "#8B7355", "#C4A882"],
    tags: ["Tweed", "Vintage", "Academic"],
  },
  {
    id: "cc1",
    imageUrl: "https://images.unsplash.com/photo-1600950207944-0d63e8edbc3f?w=800&q=80",
    aesthetic: "Cottagecore",
    secondaryAesthetic: "Romantic",
    description: "Floral prints, prairie silhouettes, golden hour",
    palette: ["#F2E8D9", "#D4A96A", "#8B6E4E", "#4A7C59"],
    tags: ["Floral", "Prairie", "Feminine"],
  },
  {
    id: "at1",
    imageUrl: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=800&q=80",
    aesthetic: "Athleisure",
    secondaryAesthetic: "Minimalist",
    description: "Performance meets polish — sleek and active",
    palette: ["#1C1C1E", "#3A3A3C", "#8E8E93", "#F2F2F7"],
    tags: ["Active", "Sleek", "Functional"],
  },
  {
    id: "at2",
    imageUrl: "https://images.unsplash.com/photo-1538805060514-97d9cc17730c?w=800&q=80",
    aesthetic: "Athleisure",
    secondaryAesthetic: "Clean Girl",
    description: "Matching sets that move with you",
    palette: ["#E8F4F8", "#B0CDD8", "#6B9EAE", "#2C5F6F"],
    tags: ["Matching set", "Sporty", "Casual"],
  },
  {
    id: "bh1",
    imageUrl: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&q=80",
    aesthetic: "Boho",
    secondaryAesthetic: "Cottagecore",
    description: "Free-spirited layers, earthy textures, fringe",
    palette: ["#C4956A", "#8B6347", "#5C3D2E", "#E8D5C0"],
    tags: ["Earthy", "Layered", "Free-spirited"],
  },
  {
    id: "hb1",
    imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80",
    aesthetic: "Hypebeast",
    secondaryAesthetic: "Streetwear",
    description: "Limited drops, bold logos, sneaker culture",
    palette: ["#FF4500", "#1A1A1A", "#F5F5F5", "#FFD700"],
    tags: ["Logo", "Sneakers", "Bold"],
  },
  {
    id: "om1",
    imageUrl: "https://images.unsplash.com/photo-1487222477894-8943e31ef7b2?w=800&q=80",
    aesthetic: "Old Money",
    secondaryAesthetic: "Business Casual",
    description: "Quiet luxury — cashmere, blazers, understated",
    palette: ["#F5F0E8", "#C8B89A", "#8B7355", "#3C2F1E"],
    tags: ["Cashmere", "Tailored", "Luxury"],
  },
  {
    id: "om2",
    imageUrl: "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80",
    aesthetic: "Old Money",
    secondaryAesthetic: "Minimalist",
    description: "Heritage tailoring, neutral palette, effortless class",
    palette: ["#EAE4DC", "#B8A898", "#7A6A5A", "#2E2418"],
    tags: ["Heritage", "Neutral", "Refined"],
  },
  {
    id: "y2k1",
    imageUrl: "https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=800&q=80",
    aesthetic: "Y2K",
    secondaryAesthetic: "Indie Sleaze",
    description: "Low-rise, metallics, and early-2000s nostalgia",
    palette: ["#E8C8E8", "#C878C8", "#784878", "#F8F8E8"],
    tags: ["Nostalgic", "Metallic", "Bold"],
  },
  {
    id: "pp1",
    imageUrl: "https://images.unsplash.com/photo-1617127365659-c47fa864d8bc?w=800&q=80",
    aesthetic: "Preppy",
    secondaryAesthetic: "Old Money",
    description: "Polo shirts, chinos, varsity energy",
    palette: ["#1B4F72", "#2E86C1", "#D4E6F1", "#F8F9FA"],
    tags: ["Polo", "Varsity", "Classic"],
  },
  {
    id: "mn1",
    imageUrl: "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=80",
    aesthetic: "Minimalist",
    secondaryAesthetic: "Clean Girl",
    description: "Less is more — clean silhouettes, zero noise",
    palette: ["#FFFFFF", "#E8E8E8", "#B0B0B0", "#404040"],
    tags: ["Structural", "Clean", "Modern"],
  },
  {
    id: "ro1",
    imageUrl: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800&q=80",
    aesthetic: "Romantic",
    secondaryAesthetic: "Cottagecore",
    description: "Soft florals, lace, and feminine grace",
    palette: ["#F8E8E8", "#E8A8A8", "#C87878", "#8B4858"],
    tags: ["Floral", "Lace", "Soft"],
  },
  {
    id: "bc1",
    imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80",
    aesthetic: "Business Casual",
    secondaryAesthetic: "Old Money",
    description: "Smart-casual balance — polished but approachable",
    palette: ["#2C3E50", "#5D6D7E", "#AEB6BF", "#F0F3F4"],
    tags: ["Blazer", "Smart", "Professional"],
  },
  {
    id: "in1",
    imageUrl: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=800&q=80",
    aesthetic: "Indie",
    secondaryAesthetic: "Dark Academia",
    description: "Thrifted layers, band tees, creative expression",
    palette: ["#3D2B1F", "#7B5E45", "#B8956A", "#E8D5C0"],
    tags: ["Thrifted", "Layered", "Creative"],
  },
  {
    id: "cs1",
    imageUrl: "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=800&q=80",
    aesthetic: "Coastal",
    secondaryAesthetic: "Boho",
    description: "Breezy linens, nautical accents, sun-kissed ease",
    palette: ["#F0F8FF", "#87CEEB", "#4682B4", "#F5DEB3"],
    tags: ["Linen", "Nautical", "Breezy"],
  },
  {
    id: "mn2",
    imageUrl: "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800&q=80",
    aesthetic: "Minimalist",
    secondaryAesthetic: "Business Casual",
    description: "Structural simplicity in warm neutral tones",
    palette: ["#EDE8E3", "#C4B8A8", "#8C7D6D", "#3C332C"],
    tags: ["Structured", "Neutral", "Warm"],
  },
];

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
      className="relative flex items-center justify-center w-10 h-10 rounded-full transition-transform active:scale-90"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {burst && (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ backgroundColor: "rgba(200,149,106,0.3)", animationDuration: "0.5s" }}
        />
      )}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill={liked ? "#C8956A" : "none"}
        stroke={liked ? "#C8956A" : "currentColor"}
        strokeWidth="1.75"
        strokeLinecap="round"
        style={{
          transition: "fill 0.2s ease, transform 0.15s ease",
          transform: burst ? "scale(1.3)" : "scale(1)",
          color: "hsl(var(--muted-foreground))",
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
    <div className="w-full flex-shrink-0 bg-background" style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}>
      <div className="max-w-lg mx-auto px-4 pt-4 pb-6 flex flex-col gap-3">

        {/* Image — contained, rounded */}
        <div className="relative w-full rounded-2xl overflow-hidden bg-muted border border-border" style={{ aspectRatio: "3/4" }}>
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
        </div>

        {/* Style + Palette panel — mirrors results.tsx exactly */}
        <div className="rounded-xl border border-border bg-card p-4 flex gap-4">
          {/* Left: style breakdown */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-3">Style</p>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-primary">Primary</span>
                <span className="text-sm font-semibold text-foreground leading-tight">{card.aesthetic}</span>
              </div>
              {card.secondaryAesthetic && (
                <div className="flex flex-col gap-0.5 mt-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Secondary</span>
                  <span className="text-sm text-muted-foreground leading-tight">{card.secondaryAesthetic}</span>
                </div>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="w-px bg-border flex-shrink-0" />

          {/* Right: colour palette dots */}
          <div className="flex-shrink-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-3">Palette</p>
            <div className="flex gap-2 flex-wrap">
              {card.palette.map((hex, i) => (
                <div key={i} className="flex flex-col items-center gap-1 group">
                  <div
                    className="w-7 h-7 rounded-full border border-border/60 shadow-sm"
                    style={{ backgroundColor: hex }}
                  />
                  <span className="text-[7px] font-mono text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {hex}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Shop the Look — static items OR key pieces from AI analysis */}
        {(CARD_ITEMS[card.id]?.length > 0 || (card.keyPieces && card.keyPieces.length > 0)) && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em]">Shop the Look</p>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FF2300" }}>
                  <span className="text-white font-bold" style={{ fontSize: "9px", lineHeight: 1 }}>d</span>
                </div>
                <span className="text-[10px] text-muted-foreground">Depop</span>
              </div>
            </div>
            <div className="flex gap-2">
              {(CARD_ITEMS[card.id] || (card.keyPieces || []).map(piece => ({
                label: piece,
                icon: (piece.toLowerCase().includes("pant") || piece.toLowerCase().includes("jean") || piece.toLowerCase().includes("trouser")) ? "pants"
                  : (piece.toLowerCase().includes("shoe") || piece.toLowerCase().includes("sneaker") || piece.toLowerCase().includes("boot")) ? "shoes"
                  : (piece.toLowerCase().includes("bag") || piece.toLowerCase().includes("tote")) ? "bag"
                  : (piece.toLowerCase().includes("dress") || piece.toLowerCase().includes("skirt")) ? "dress"
                  : (piece.toLowerCase().includes("jacket") || piece.toLowerCase().includes("coat") || piece.toLowerCase().includes("blazer")) ? "jacket"
                  : "shirt",
                query: `${piece} ${card.aesthetic} fashion`,
              } as { label: string; icon: string; query: string }))).map((item) => (
                <a
                  key={item.label}
                  href={`https://www.depop.com/search/?q=${encodeURIComponent(item.query)}&sort=relevance`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                >
                  <span className="text-foreground/60 group-hover:text-primary transition-colors">
                    {ClothingIcons[item.icon]}
                  </span>
                  <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground text-center leading-tight transition-colors">{item.label}</span>
                </a>
              ))}
            </div>
          </div>
        )}



        {/* Reddit source attribution */}
        {(card as any).postUrl && (
          <a
            href={(card as any).postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-primary transition-colors w-fit"
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 0C4.478 0 0 4.478 0 10s4.478 10 10 10 10-4.478 10-10S15.522 0 10 0zm4.898 7.01a1.333 1.333 0 1 1 0 2.667 1.333 1.333 0 0 1 0-2.667zm-9.796 0a1.333 1.333 0 1 1 0 2.667 1.333 1.333 0 0 1 0-2.667zM10 15.5c-2.56 0-4.7-1.46-5.5-3.5h11c-.8 2.04-2.94 3.5-5.5 3.5z"/>
            </svg>
            r/{(card as any).subreddit || "reddit"} · View post
          </a>
        )}

        {/* Bottom row — tags + heart */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5 flex-wrap">
            {card.tags.map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {liked && (
              <span className="text-xs font-semibold text-primary">Liked</span>
            )}
            <HeartButton liked={liked} onToggle={() => onToggleLike(card)} />
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function getTopAesthetic(): string | null {
  try {
    const raw = localStorage.getItem("stitch_profile");
    if (raw) {
      const p = JSON.parse(raw);
      if (p.aesthetics?.length) return p.aesthetics[0];
    }
  } catch {}
  return null;
}

export default function DiscoverPage() {
  const [topAesthetic] = useState<string | null>(getTopAesthetic);
  const [cards, setCards] = useState<OutfitCard[]>(() => {
    // Start with ranked static fallback while API loads
    const ranked = rankByVector(OUTFITS);
    const mid = Math.ceil(ranked.length / 2);
    return [...shuffled(ranked.slice(0, mid)), ...shuffled(ranked.slice(mid))];
  });
  const [loadingFeed, setLoadingFeed] = useState(true);

  // Fetch real AI-analyzed cards from the server
  useEffect(() => {
    fetch("/api/discover")
      .then(r => r.json())
      .then((data: any[]) => {
        if (!Array.isArray(data) || data.length === 0) return;
        // Map DB rows to OutfitCard shape
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
        } as OutfitCard & { postUrl?: string; subreddit?: string }));
        const ranked = rankByVector(apiCards);
        const mid = Math.ceil(ranked.length / 2);
        setCards([...shuffled(ranked.slice(0, mid)), ...shuffled(ranked.slice(mid))]);
      })
      .catch(() => { /* keep fallback */ })
      .finally(() => setLoadingFeed(false));
  }, []);
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

  const toggleLike = useCallback((card: OutfitCard) => {
    setLikes((prev) => {
      const next = { ...prev, [card.id]: !prev[card.id] };
      // Update style vector
      if (next[card.id]) {
        onLike(card.aesthetic, card.tags);
      } else {
        onUnlike(card.aesthetic, card.tags);
      }
      try {
        const raw = localStorage.getItem("stitch_likes");
        const arr: LikedItem[] = raw ? JSON.parse(raw) : [];
        if (next[card.id]) {
          if (!arr.find((l) => l.id === card.id)) {
            arr.push({ id: card.id, aesthetic: card.aesthetic, likedAt: Date.now() });
          }
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
    <div
      className="overflow-y-scroll"
      style={{
        scrollSnapType: "y mandatory",
        WebkitOverflowScrolling: "touch",
        height: "calc(100svh - 48px - 64px)", // subtract TopBar + NavBar
      }}
    >
      {/* Style DNA banner — only shown if quiz completed */}
      {topAesthetic && (
        <div
          className="w-full flex-shrink-0 flex items-center justify-center px-5"
          style={{ scrollSnapAlign: "start", minHeight: "calc(100svh - 48px - 64px)" }}
        >
          <div className="text-center max-w-xs">
            <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-3">Your Style</p>
            <h2 className="font-display text-4xl text-foreground mb-2">{topAesthetic}</h2>
            <p className="text-sm text-muted-foreground mb-6">Scroll down to explore fits curated for your vibe</p>
            <div className="flex items-center justify-center gap-1 text-muted-foreground/60">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12l7 7 7-7"/>
              </svg>
              <span className="text-xs">Swipe</span>
            </div>
          </div>
        </div>
      )}

      {cards.map((card) => (
        <DiscoverCard
          key={card.id}
          card={card}
          liked={!!likes[card.id]}
          onToggleLike={toggleLike}
        />
      ))}

      {/* End card */}
      <div
        className="w-full flex-shrink-0 flex flex-col items-center justify-center gap-3 bg-background"
        style={{ scrollSnapAlign: "start", minHeight: "calc(100svh - 48px - 64px)" }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="hsl(24 42% 60%)" strokeWidth="1.5" strokeLinecap="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <p className="font-display text-xl text-foreground">You're all caught up</p>
        <p className="text-sm text-muted-foreground">
          {likedCount} outfit{likedCount !== 1 ? "s" : ""} liked
        </p>
      </div>
    </div>
  );
}
