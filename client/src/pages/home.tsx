import { useLocation } from "wouter";
import { useState, useEffect, useCallback } from "react";
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
  tag?: string; // "Match" | sale string
}

const FEED_ITEMS: FeedItem[] = [
  // Minimalist
  { id: 1,  label: "Linen Blazer Dress",        icon: "dress",     query: "linen blazer dress minimalist",           aesthetic: "Minimalist",       tag: "Match" },
  { id: 2,  label: "Wide Leg Trousers",          icon: "pants",     query: "wide leg trousers minimal beige",         aesthetic: "Minimalist" },
  { id: 3,  label: "Oversized White Tee",        icon: "shirt",     query: "oversized white t-shirt minimalist",      aesthetic: "Minimalist" },
  // Streetwear
  { id: 4,  label: "990v6 Sneaker",              icon: "shoes",     query: "new balance 990 sneakers",                aesthetic: "Streetwear",       tag: "Match" },
  { id: 5,  label: "Graphic Hoodie",             icon: "shirt",     query: "graphic hoodie streetwear oversized",     aesthetic: "Streetwear" },
  { id: 6,  label: "Cargo Pants",                icon: "pants",     query: "cargo pants streetwear baggy",            aesthetic: "Streetwear" },
  { id: 7,  label: "Puffer Jacket",              icon: "jacket",    query: "puffer jacket streetwear",                aesthetic: "Streetwear" },
  // Old Money
  { id: 8,  label: "Cashmere Crew Neck",         icon: "shirt",     query: "cashmere crew neck sweater neutral",      aesthetic: "Old Money",        tag: "-30%" },
  { id: 9,  label: "Pleated Wool Trousers",      icon: "pants",     query: "pleated wool trousers old money",         aesthetic: "Old Money" },
  { id: 10, label: "Leather Loafers",            icon: "shoes",     query: "leather loafers penny old money",         aesthetic: "Old Money" },
  { id: 11, label: "Trench Coat",                icon: "jacket",    query: "trench coat classic camel",               aesthetic: "Old Money" },
  // Clean Girl
  { id: 12, label: "Structured Tote",            icon: "bag",       query: "structured tote bag neutral",             aesthetic: "Clean Girl" },
  { id: 13, label: "Ribbed Tank Top",            icon: "shirt",     query: "ribbed tank top clean girl neutral",      aesthetic: "Clean Girl" },
  { id: 14, label: "High Waist Leggings",        icon: "pants",     query: "high waist leggings clean girl",          aesthetic: "Clean Girl" },
  // Dark Academia
  { id: 15, label: "Plaid Blazer",               icon: "jacket",    query: "plaid blazer dark academia",              aesthetic: "Dark Academia" },
  { id: 16, label: "Oxford Brogues",             icon: "shoes",     query: "oxford brogues dark academia leather",    aesthetic: "Dark Academia" },
  { id: 17, label: "Turtleneck Knit",            icon: "shirt",     query: "turtleneck knit dark academia brown",     aesthetic: "Dark Academia" },
  { id: 18, label: "Plaid Mini Skirt",           icon: "skirt",     query: "plaid mini skirt dark academia",          aesthetic: "Dark Academia" },
  // Cottagecore
  { id: 19, label: "Floral Midi Dress",          icon: "dress",     query: "floral midi dress cottagecore",           aesthetic: "Cottagecore" },
  { id: 20, label: "Puff Sleeve Blouse",         icon: "shirt",     query: "puff sleeve blouse cottagecore",          aesthetic: "Cottagecore" },
  { id: 21, label: "Lace-Trim Skirt",            icon: "skirt",     query: "lace trim skirt cottagecore",             aesthetic: "Cottagecore" },
  // Y2K
  { id: 22, label: "Low Rise Jeans",             icon: "pants",     query: "low rise jeans y2k 2000s",                aesthetic: "Y2K" },
  { id: 23, label: "Butterfly Top",             icon: "shirt",     query: "butterfly print top y2k crop",            aesthetic: "Y2K" },
  { id: 24, label: "Platform Sandals",           icon: "shoes",     query: "platform sandals y2k 2000s",              aesthetic: "Y2K" },
  { id: 25, label: "Mini Skirt & Tube Top",      icon: "skirt",     query: "tube top mini skirt y2k",                 aesthetic: "Y2K",              tag: "Match" },
  // Boho
  { id: 26, label: "Crochet Vest",               icon: "shirt",     query: "crochet vest boho festival",              aesthetic: "Boho" },
  { id: 27, label: "Maxi Wrap Skirt",            icon: "skirt",     query: "maxi wrap skirt boho print",              aesthetic: "Boho" },
  { id: 28, label: "Fringe Bag",                 icon: "bag",       query: "fringe crossbody bag boho",               aesthetic: "Boho" },
  // Romantic
  { id: 29, label: "Silk Wrap Dress",            icon: "dress",     query: "silk wrap dress elegant",                 aesthetic: "Romantic" },
  { id: 30, label: "Pearl Drop Earrings",        icon: "accessory", query: "pearl drop earrings romantic",            aesthetic: "Romantic" },
  { id: 31, label: "Ruffle Midi Dress",          icon: "dress",     query: "ruffle midi dress romantic feminine",     aesthetic: "Romantic" },
  // Grunge
  { id: 32, label: "Band Tee",                   icon: "shirt",     query: "vintage band tee grunge oversized",       aesthetic: "Grunge" },
  { id: 33, label: "Distressed Jeans",           icon: "pants",     query: "distressed ripped jeans grunge",          aesthetic: "Grunge" },
  { id: 34, label: "Combat Boots",               icon: "shoes",     query: "combat boots black lace up grunge",       aesthetic: "Grunge" },
  { id: 35, label: "Leather Moto Jacket",        icon: "jacket",    query: "leather moto jacket grunge black",        aesthetic: "Grunge",           tag: "Match" },
  // Business Casual
  { id: 36, label: "Tailored Blazer",            icon: "jacket",    query: "tailored blazer business casual neutral", aesthetic: "Business Casual" },
  { id: 37, label: "Straight Leg Trousers",      icon: "pants",     query: "straight leg trousers business casual",   aesthetic: "Business Casual" },
  { id: 38, label: "Block Heel Mules",           icon: "shoes",     query: "block heel mules business casual",        aesthetic: "Business Casual" },
  // Athleisure
  { id: 39, label: "Seamless Sports Set",        icon: "shirt",     query: "seamless sports set matching athleisure", aesthetic: "Athleisure" },
  { id: 40, label: "Oversized Track Jacket",     icon: "jacket",    query: "track jacket oversized athleisure",       aesthetic: "Athleisure" },
  { id: 41, label: "Sporty Sneakers",            icon: "shoes",     query: "sporty sneakers white athleisure",        aesthetic: "Athleisure" },
  // Hypebeast
  { id: 42, label: "Jordan 1 High",              icon: "shoes",     query: "jordan 1 high sneakers hypebeast",        aesthetic: "Hypebeast" },
  { id: 43, label: "Logo Hoodie",                icon: "shirt",     query: "supreme off-white logo hoodie hype",      aesthetic: "Hypebeast" },
  { id: 44, label: "Techwear Pants",             icon: "pants",     query: "techwear cargo pants hypebeast",          aesthetic: "Hypebeast" },
  // Coastal
  { id: 45, label: "Linen Shirt Dress",          icon: "dress",     query: "linen shirt dress coastal summer",        aesthetic: "Coastal" },
  { id: 46, label: "Wicker Tote",                icon: "bag",       query: "wicker basket tote coastal summer",       aesthetic: "Coastal" },
  { id: 47, label: "Espadrille Sandals",         icon: "shoes",     query: "espadrille sandals coastal",              aesthetic: "Coastal" },
  // Indie / Preppy
  { id: 48, label: "Corduroy Jacket",            icon: "jacket",    query: "corduroy jacket indie vintage",           aesthetic: "Indie" },
];

const CHIPS = ["For You", "Minimal", "Coastal", "Dark Acad.", "Streetwear", "Trending"];

export default function HomePage() {
  const [, setLocation] = useLocation();

  // Rank feed items by style vector — re-ranks whenever the vector changes
  const rerank = useCallback(() => rankByVector(FEED_ITEMS), []);
  const [feedItems, setFeedItems] = useState<FeedItem[]>(rerank);

  useEffect(() => {
    const handler = () => setFeedItems(rerank());
    window.addEventListener("stitch_vector_updated", handler);
    return () => window.removeEventListener("stitch_vector_updated", handler);
  }, [rerank]);

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

  return (
    <div className="fade-up">
      {/* Greeting + chips — contained */}
      <div className="max-w-4xl mx-auto">
        <div className="px-5 sm:px-8 pt-5 sm:pt-7 pb-3">
          <h1 className="font-display text-2xl sm:text-3xl text-foreground leading-tight">
            {greetingLine}
          </h1>
        </div>

        {/* Aesthetic chips */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-5 sm:px-8 pb-3">
          {chips.map((c, i) => (
            <button
              key={c}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all ${
                i === 0
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground border border-border hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* For You header */}
        <div className="px-5 sm:px-8 flex items-center justify-between mb-0 pb-3">
          <span className="text-sm font-semibold text-foreground">For You</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">↑ 24 new</span>
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
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">{item.aesthetic}</p>
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
