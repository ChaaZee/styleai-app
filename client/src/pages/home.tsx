import { useLocation } from "wouter";
import { useState } from "react";
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
  { id: 1, label: "Linen Blazer Dress",     icon: "dress",     query: "linen blazer dress minimalist",       aesthetic: "Minimalist", tag: "Match" },
  { id: 2, label: "Structured Tote",         icon: "bag",       query: "structured tote bag neutral",         aesthetic: "Clean Girl" },
  { id: 3, label: "Cashmere Crew Neck",      icon: "shirt",     query: "cashmere crew neck sweater neutral",  aesthetic: "Old Money", tag: "-30%" },
  { id: 4, label: "Wide Leg Trousers",       icon: "pants",     query: "wide leg trousers minimal beige",     aesthetic: "Minimalist" },
  { id: 5, label: "990v6 Sneaker",           icon: "shoes",     query: "new balance 990 sneakers",            aesthetic: "Streetwear", tag: "Match" },
  { id: 6, label: "Silk Wrap Dress",         icon: "dress",     query: "silk wrap dress elegant",             aesthetic: "Romantic" },
];

const CHIPS = ["For You", "Minimal", "Coastal", "Dark Acad.", "Streetwear", "Trending"];

export default function HomePage() {
  const [, setLocation] = useLocation();

  // Rank feed items by style vector affinity on mount
  const [feedItems] = useState<FeedItem[]>(() => rankByVector(FEED_ITEMS));

  // Personalised greeting
  const [topAesthetic] = useState<string | null>(() => {
    const tops = getTopAesthetics(1);
    // Only show if vector has been seeded (i.e. quiz done)
    if (!localStorage.getItem("stitch_quiz_done")) return null;
    return tops[0] ?? null;
  });

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Dynamic chips — put user's top aesthetic first if available
  const chips = topAesthetic
    ? ["For You", topAesthetic, ...CHIPS.filter(c => c !== "For You" && c !== topAesthetic).slice(0, 4)]
    : CHIPS;

  return (
    <div className="max-w-4xl mx-auto fade-up">
      {/* Greeting */}
      <div className="px-5 sm:px-8 pt-5 sm:pt-7 pb-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{greeting}</p>
          <h1 className="font-display text-2xl sm:text-3xl text-foreground leading-tight">
            {topAesthetic ? `Your ${topAesthetic} Feed` : "Your Feed"}
          </h1>
        </div>
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
      <div className="px-5 sm:px-8 flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-foreground">For You</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">↑ 24 new</span>
      </div>

      {/* Masonry grid — 2 cols mobile, 3 cols on md+ */}
      <div className="px-5 sm:px-8 columns-2 md:columns-3 gap-3 space-y-0 pb-6">
        {feedItems.map((item) => (
          <a
            key={item.id}
            href={`https://www.depop.com/search/?q=${encodeURIComponent(item.query)}&sort=relevance`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-inside-avoid mb-3 rounded-xl border border-border bg-card overflow-hidden relative hover:border-primary/30 transition-colors cursor-pointer block group"
          >
            {item.tag === "Match" && (
              <div className="absolute top-2 left-2 z-10 text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">Match</div>
            )}
            {item.tag && item.tag !== "Match" && (
              <div className="absolute top-2 left-2 z-10 text-[10px] px-2 py-0.5 rounded-full bg-foreground text-background font-medium">{item.tag}</div>
            )}
            {/* Illustration area */}
            <div className="w-full flex items-center justify-center py-8 text-foreground/40 group-hover:text-primary transition-colors">
              {Icons[item.icon]}
            </div>
            <div className="p-2.5 border-t border-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">{item.aesthetic}</p>
              <p className="text-xs text-foreground font-medium leading-snug mb-1.5">{item.label}</p>
              <div className="flex items-center justify-between">
                <DepopBadge />
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground group-hover:text-primary transition-colors">
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
