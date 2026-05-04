import { useLocation } from "wouter";
import { useState, useEffect, useCallback, useMemo } from "react";
import { rankByVector, getTopAesthetics } from "@/lib/styleVector";

// ── Clothing SVG illustrations (same set as discover) ───────────────────────
const Icons: Record<string, JSX.Element> = {
  shirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M14 4 L8 10 L4 8 L2 18 L8 17 L8 36 L32 36 L32 17 L38 18 L36 8 L32 10 L26 4 Q23 8 20 8 Q17 8 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  pants: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M6 4 L34 4 L34 10 L26 10 L26 36 L20 36 L20 18 L20 36 L14 36 L14 10 L6 10 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  dress: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M15 4 Q20 8 25 4 L30 12 L26 14 L30 36 L10 36 L14 14 L10 12 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  shoes: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M4 28 L4 20 Q4 14 10 14 L18 14 L18 20 L28 20 Q36 20 36 26 L36 28 L16 28 Q12 28 12 32 L4 32 Q4 30 4 28Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  bag: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <rect x="6" y="14" width="28" height="22" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <path d="M14 14 Q14 6 20 6 Q26 6 26 14" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <line x1="6" y1="22" x2="34" y2="22" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  jacket: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M14 4 L8 10 L4 8 L2 20 L8 19 L8 36 L32 36 L32 19 L38 20 L36 8 L32 10 L26 4 Q23 9 20 9 Q17 9 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="20" y1="9" x2="20" y2="36" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  skirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M10 8 L30 8 L36 36 L4 36 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="8" y1="14" x2="32" y2="14" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  accessory: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <circle cx="20" cy="20" r="4" stroke="currentColor" strokeWidth="1.4" fill="none"/>
      <line x1="10" y1="10" x2="16" y2="16" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="30" y1="10" x2="24" y2="16" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="10" y1="30" x2="16" y2="24" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="30" y1="30" x2="24" y2="24" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
};

// ── Depop badge ──────────────────────────────────────────────────────────────
function DepopBadge() {
  return (
    <div className="flex items-center gap-1">
      <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FF2300" }}>
        <span className="text-white font-bold" style={{ fontSize: "9px", lineHeight: 1 }}>d</span>
      </div>
      <span className="text-[10px] text-muted-foreground">Depop</span>
    </div>
  );
}

// ── Data ─────────────────────────────────────────────────────────────────────
type IconKey = keyof typeof Icons;

interface FeedItem {
  id: number;
  label: string;
  icon: IconKey;
  query: string;
  aesthetic: string;
  gender: "male" | "female" | "both"; // used to filter by profile preference
  tag?: string; // "Match" | sale string
}

// Helper to get current gender preference
function getGenderPref(): "male" | "female" | "both" {
  try {
    const p = JSON.parse(localStorage.getItem("stitch_profile") || "{}");
    return (p.gender as "male" | "female" | "both") || "both";
  } catch { return "both"; }
}

const FEED_ITEMS: FeedItem[] = [
  // Minimalist — female-leaning but some both
  { id: 1,  label: "Linen Blazer Dress",        icon: "dress",     query: "linen blazer dress minimalist",            aesthetic: "Minimalist",       gender: "female", tag: "Match" },
  { id: 2,  label: "Wide Leg Trousers",          icon: "pants",     query: "wide leg trousers minimal beige women",    aesthetic: "Minimalist",       gender: "female" },
  { id: 3,  label: "Oversized White Tee",        icon: "shirt",     query: "oversized white t-shirt minimalist",       aesthetic: "Minimalist",       gender: "both" },
  { id: 49, label: "Slim Chino",                 icon: "pants",     query: "slim chino minimalist neutral men",        aesthetic: "Minimalist",       gender: "male" },
  { id: 50, label: "Linen Button-Down",          icon: "shirt",     query: "linen button down shirt men minimalist",   aesthetic: "Minimalist",       gender: "male" },
  // Streetwear
  { id: 4,  label: "990v6 Sneaker",              icon: "shoes",     query: "new balance 990 sneakers",                 aesthetic: "Streetwear",       gender: "both",  tag: "Match" },
  { id: 5,  label: "Graphic Hoodie",             icon: "shirt",     query: "graphic hoodie streetwear oversized men",  aesthetic: "Streetwear",       gender: "male" },
  { id: 6,  label: "Cargo Pants",                icon: "pants",     query: "cargo pants streetwear baggy men",         aesthetic: "Streetwear",       gender: "male" },
  { id: 7,  label: "Puffer Jacket",              icon: "jacket",    query: "puffer jacket streetwear",                 aesthetic: "Streetwear",       gender: "both" },
  { id: 51, label: "Cropped Hoodie",             icon: "shirt",     query: "cropped hoodie streetwear women",          aesthetic: "Streetwear",       gender: "female" },
  // Old Money
  { id: 8,  label: "Cashmere Crew Neck",         icon: "shirt",     query: "cashmere crew neck sweater men neutral",   aesthetic: "Old Money",        gender: "male",  tag: "-30%" },
  { id: 9,  label: "Pleated Wool Trousers",      icon: "pants",     query: "pleated wool trousers men old money",      aesthetic: "Old Money",        gender: "male" },
  { id: 10, label: "Leather Loafers",            icon: "shoes",     query: "leather loafers penny old money",          aesthetic: "Old Money",        gender: "both" },
  { id: 11, label: "Trench Coat",                icon: "jacket",    query: "trench coat classic camel men",            aesthetic: "Old Money",        gender: "male" },
  { id: 52, label: "Silk Blouse",                icon: "shirt",     query: "silk blouse old money women elegant",      aesthetic: "Old Money",        gender: "female" },
  // Clean Girl
  { id: 12, label: "Structured Tote",            icon: "bag",       query: "structured tote bag neutral",              aesthetic: "Clean Girl",       gender: "female" },
  { id: 13, label: "Ribbed Tank Top",            icon: "shirt",     query: "ribbed tank top clean girl neutral women", aesthetic: "Clean Girl",       gender: "female" },
  { id: 14, label: "High Waist Leggings",        icon: "pants",     query: "high waist leggings clean girl women",     aesthetic: "Clean Girl",       gender: "female" },
  // Dark Academia
  { id: 15, label: "Plaid Blazer",               icon: "jacket",    query: "plaid blazer dark academia",               aesthetic: "Dark Academia",    gender: "both" },
  { id: 16, label: "Oxford Brogues",             icon: "shoes",     query: "oxford brogues dark academia leather",     aesthetic: "Dark Academia",    gender: "both" },
  { id: 17, label: "Turtleneck Knit",            icon: "shirt",     query: "turtleneck knit dark academia brown men",  aesthetic: "Dark Academia",    gender: "male" },
  { id: 18, label: "Plaid Mini Skirt",           icon: "skirt",     query: "plaid mini skirt dark academia women",     aesthetic: "Dark Academia",    gender: "female" },
  { id: 53, label: "Wool Flat Cap",              icon: "accessory", query: "wool flat cap dark academia men",          aesthetic: "Dark Academia",    gender: "male" },
  // Cottagecore
  { id: 19, label: "Floral Midi Dress",          icon: "dress",     query: "floral midi dress cottagecore women",      aesthetic: "Cottagecore",      gender: "female" },
  { id: 20, label: "Puff Sleeve Blouse",         icon: "shirt",     query: "puff sleeve blouse cottagecore women",     aesthetic: "Cottagecore",      gender: "female" },
  { id: 21, label: "Lace-Trim Skirt",            icon: "skirt",     query: "lace trim skirt cottagecore women",        aesthetic: "Cottagecore",      gender: "female" },
  { id: 54, label: "Linen Overshirt",            icon: "shirt",     query: "linen overshirt cottagecore men natural",  aesthetic: "Cottagecore",      gender: "male" },
  // Y2K
  { id: 22, label: "Low Rise Jeans",             icon: "pants",     query: "low rise jeans y2k 2000s women",           aesthetic: "Y2K",              gender: "female" },
  { id: 23, label: "Butterfly Crop Top",         icon: "shirt",     query: "butterfly print crop top y2k women",       aesthetic: "Y2K",              gender: "female" },
  { id: 24, label: "Platform Sandals",           icon: "shoes",     query: "platform sandals y2k 2000s women",         aesthetic: "Y2K",              gender: "female" },
  { id: 25, label: "Mini Skirt & Tube Top",      icon: "skirt",     query: "tube top mini skirt y2k women",            aesthetic: "Y2K",              gender: "female", tag: "Match" },
  { id: 55, label: "Baggy Y2K Jeans",            icon: "pants",     query: "baggy jeans y2k 2000s men",                aesthetic: "Y2K",              gender: "male" },
  // Boho
  { id: 26, label: "Crochet Vest",               icon: "shirt",     query: "crochet vest boho festival women",         aesthetic: "Boho",             gender: "female" },
  { id: 27, label: "Maxi Wrap Skirt",            icon: "skirt",     query: "maxi wrap skirt boho print women",         aesthetic: "Boho",             gender: "female" },
  { id: 28, label: "Fringe Bag",                 icon: "bag",       query: "fringe crossbody bag boho",                aesthetic: "Boho",             gender: "both" },
  { id: 56, label: "Linen Drawstring Pants",     icon: "pants",     query: "linen drawstring pants boho men",          aesthetic: "Boho",             gender: "male" },
  // Romantic
  { id: 29, label: "Silk Wrap Dress",            icon: "dress",     query: "silk wrap dress elegant women",            aesthetic: "Romantic",         gender: "female" },
  { id: 30, label: "Pearl Drop Earrings",        icon: "accessory", query: "pearl drop earrings romantic women",       aesthetic: "Romantic",         gender: "female" },
  { id: 31, label: "Ruffle Midi Dress",          icon: "dress",     query: "ruffle midi dress romantic women",         aesthetic: "Romantic",         gender: "female" },
  // Grunge
  { id: 32, label: "Band Tee",                   icon: "shirt",     query: "vintage band tee grunge oversized",        aesthetic: "Grunge",           gender: "both" },
  { id: 33, label: "Distressed Jeans",           icon: "pants",     query: "distressed ripped jeans grunge",           aesthetic: "Grunge",           gender: "both" },
  { id: 34, label: "Combat Boots",               icon: "shoes",     query: "combat boots black lace up grunge",        aesthetic: "Grunge",           gender: "both" },
  { id: 35, label: "Leather Moto Jacket",        icon: "jacket",    query: "leather moto jacket grunge black",         aesthetic: "Grunge",           gender: "both",  tag: "Match" },
  // Business Casual
  { id: 36, label: "Tailored Blazer",            icon: "jacket",    query: "tailored blazer business casual men",      aesthetic: "Business Casual",  gender: "male" },
  { id: 37, label: "Straight Leg Trousers",      icon: "pants",     query: "straight leg trousers business casual men",aesthetic: "Business Casual",  gender: "male" },
  { id: 38, label: "Block Heel Mules",           icon: "shoes",     query: "block heel mules business casual women",   aesthetic: "Business Casual",  gender: "female" },
  { id: 57, label: "Oxford Button-Down",         icon: "shirt",     query: "oxford button down shirt men business",    aesthetic: "Business Casual",  gender: "male" },
  { id: 58, label: "Tailored Blazer Women",      icon: "jacket",    query: "tailored blazer women business casual",    aesthetic: "Business Casual",  gender: "female" },
  // Athleisure
  { id: 39, label: "Seamless Sports Set",        icon: "shirt",     query: "seamless sports set women athleisure",     aesthetic: "Athleisure",       gender: "female" },
  { id: 40, label: "Oversized Track Jacket",     icon: "jacket",    query: "track jacket oversized athleisure men",    aesthetic: "Athleisure",       gender: "male" },
  { id: 41, label: "Sporty Sneakers",            icon: "shoes",     query: "sporty sneakers white athleisure",         aesthetic: "Athleisure",       gender: "both" },
  { id: 59, label: "Athletic Shorts",            icon: "pants",     query: "athletic shorts men gym athleisure",       aesthetic: "Athleisure",       gender: "male" },
  // Hypebeast
  { id: 42, label: "Jordan 1 High",              icon: "shoes",     query: "jordan 1 high sneakers hypebeast",         aesthetic: "Hypebeast",        gender: "both" },
  { id: 43, label: "Logo Hoodie",                icon: "shirt",     query: "supreme off-white logo hoodie hype men",   aesthetic: "Hypebeast",        gender: "male" },
  { id: 44, label: "Techwear Pants",             icon: "pants",     query: "techwear cargo pants hypebeast men",       aesthetic: "Hypebeast",        gender: "male" },
  { id: 60, label: "Oversized Graphic Tee",      icon: "shirt",     query: "oversized graphic tee hype women",         aesthetic: "Hypebeast",        gender: "female" },
  // Coastal
  { id: 45, label: "Linen Shirt Dress",          icon: "dress",     query: "linen shirt dress coastal summer women",   aesthetic: "Coastal",          gender: "female" },
  { id: 46, label: "Wicker Tote",                icon: "bag",       query: "wicker basket tote coastal summer",        aesthetic: "Coastal",          gender: "both" },
  { id: 47, label: "Espadrille Sandals",         icon: "shoes",     query: "espadrille sandals coastal",               aesthetic: "Coastal",          gender: "both" },
  { id: 61, label: "Linen Shorts",               icon: "pants",     query: "linen shorts men coastal summer",          aesthetic: "Coastal",          gender: "male" },
  { id: 62, label: "Striped Nautical Tee",       icon: "shirt",     query: "striped nautical tee men coastal",         aesthetic: "Coastal",          gender: "male" },
  // Indie / Preppy
  { id: 48, label: "Corduroy Jacket",            icon: "jacket",    query: "corduroy jacket indie vintage men",        aesthetic: "Indie",            gender: "male" },
  { id: 63, label: "Corduroy Skirt",             icon: "skirt",     query: "corduroy mini skirt indie women",          aesthetic: "Indie",            gender: "female" },
  { id: 64, label: "Varsity Jacket",             icon: "jacket",    query: "varsity jacket preppy",                    aesthetic: "Preppy",           gender: "both" },
  { id: 65, label: "Polo Shirt",                 icon: "shirt",     query: "polo shirt preppy men",                    aesthetic: "Preppy",           gender: "male" },
];

const CHIPS = ["For You", "Minimal", "Coastal", "Dark Acad.", "Streetwear", "Trending"];

// Map chip label → aesthetic value(s) in FEED_ITEMS
const CHIP_AESTHETIC_MAP: Record<string, string[]> = {
  "Minimal":    ["Minimalist"],
  "Coastal":    ["Coastal"],
  "Dark Acad.": ["Dark Academia"],
  "Streetwear": ["Streetwear"],
  "Old Money":  ["Old Money"],
  "Y2K":        ["Y2K"],
  "Boho":       ["Boho"],
  "Grunge":     ["Grunge"],
  "Clean Girl": ["Clean Girl"],
  "Romantic":   ["Romantic"],
  "Hypebeast":  ["Hypebeast"],
  "Athleisure": ["Athleisure"],
  "Business Casual": ["Business Casual"],
  "Preppy":     ["Preppy"],
  "Indie":      ["Indie"],
  "Cottagecore":["Cottagecore"],
};

export default function HomePage() {
  const [, setLocation] = useLocation();
  const [activeChip, setActiveChip] = useState("For You");

  // Gender-filter + vector-rank
  const rerank = useCallback(() => {
    const genderPref = getGenderPref();
    const filtered = genderPref === "both"
      ? FEED_ITEMS
      : FEED_ITEMS.filter(item => item.gender === genderPref || item.gender === "both");
    return rankByVector(filtered);
  }, []);

  const [rankedItems, setRankedItems] = useState<FeedItem[]>(rerank);

  // Re-rank on mount
  useEffect(() => {
    setRankedItems(rerank());
  }, [rerank]);

  // Re-rank on vector updates
  useEffect(() => {
    const handler = () => setRankedItems(rerank());
    window.addEventListener("stitch_vector_updated", handler);
    return () => window.removeEventListener("stitch_vector_updated", handler);
  }, [rerank]);

  // Derive visible feed from active chip
  const feedItems = useMemo(() => {
    if (activeChip === "For You") return rankedItems;
    if (activeChip === "Trending") {
      // Match-tagged items first, then top-scored items, capped at 20
      const matches = rankedItems.filter(i => i.tag === "Match");
      const rest = rankedItems.filter(i => i.tag !== "Match");
      return [...matches, ...rest].slice(0, 20);
    }
    const aesthetics = CHIP_AESTHETIC_MAP[activeChip] ?? [activeChip];
    const filtered = rankedItems.filter(i => aesthetics.includes(i.aesthetic));
    // Fall back to full list if nothing matches
    return filtered.length > 0 ? filtered : rankedItems;
  }, [activeChip, rankedItems]);

  // Personalised greeting
  const [topAesthetic] = useState<string | null>(() => {
    const tops = getTopAesthetics(1);
    if (!localStorage.getItem("stitch_quiz_done")) return null;
    return tops[0] ?? null;
  });

  // User's name from profile
  const userName = (() => {
    try {
      const profile = JSON.parse(localStorage.getItem("stitch_profile") || "{}");
      return profile.name as string | undefined;
    } catch { return undefined; }
  })();

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const greetingLine = userName ? `${greeting}, ${userName}` : greeting;

  // Dynamic chips — put user's top aesthetic first if available
  const chips = topAesthetic
    ? ["For You", topAesthetic, ...CHIPS.filter(c => c !== "For You" && c !== topAesthetic).slice(0, 4)]
    : CHIPS;

  // Section label under chips
  const sectionLabel = activeChip === "For You" ? "For You"
    : activeChip === "Trending" ? "Trending Now"
    : activeChip;

  return (
    <div className="fade-up">
      {/* Greeting + chips — contained */}
      <div className="max-w-4xl mx-auto">
        <div className="px-5 sm:px-8 pt-5 sm:pt-7 pb-3">
          <h1 className="font-display text-3xl sm:text-4xl text-foreground leading-tight">
            {greetingLine}
          </h1>
        </div>

        {/* Aesthetic chips */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-5 sm:px-8 pb-3">
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => setActiveChip(c)}
              className={`px-3.5 py-1.5 rounded-full flex-shrink-0 transition-all font-ui text-[10px] tracking-widest uppercase ${
                activeChip === c
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground border border-border hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Section label */}
        <div className="px-5 sm:px-8 flex items-center justify-between mb-0 pb-3">
          <span className="font-label text-[10px] text-foreground">{sectionLabel}</span>
          {activeChip === "For You" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">↑ 24 new</span>
          )}
          {activeChip !== "For You" && feedItems.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{feedItems.length} item{feedItems.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>

      {/* Grid — full bleed, hairline dividers, seamless with page background */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px" style={{ background: "hsl(var(--border))" }}>
        {feedItems.map((item) => (
          <a
            key={item.id}
            href={`https://www.depop.com/search/?q=${encodeURIComponent(item.query)}&sort=relevance`}
            target="_blank"
            rel="noopener noreferrer"
            className="relative bg-background hover:bg-muted/40 transition-colors cursor-pointer block group"
          >
            {item.tag === "Match" && (
              <div className="absolute top-2.5 left-2.5 z-10 text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">Match</div>
            )}
            {item.tag && item.tag !== "Match" && (
              <div className="absolute top-2.5 left-2.5 z-10 text-[10px] px-2 py-0.5 rounded-full bg-foreground text-background font-medium">{item.tag}</div>
            )}
            {/* Illustration */}
            <div className="w-full flex items-center justify-center py-10 text-foreground/30 group-hover:text-primary transition-colors">
              {Icons[item.icon]}
            </div>
            {/* Info */}
            <div className="px-3 pb-4">
              <p className="font-label text-[9px] text-muted-foreground mb-0.5" style={{ letterSpacing: '0.14em' }}>{item.aesthetic}</p>
              <p className="text-xs text-foreground font-medium leading-snug mb-2">{item.label}</p>
              <div className="flex items-center justify-between">
                <DepopBadge />
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/50 group-hover:text-primary transition-colors flex-shrink-0">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
