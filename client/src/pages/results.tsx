import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, ExternalLink, Loader2, Plus } from "lucide-react";
import { depopUrl, isDepopAesthetic } from "@/lib/depop";
import { useState, useEffect, useRef } from "react";
import type { Scan } from "@shared/schema";
import { onResultViewed, onResultSaved, onUnlike } from "@/lib/styleVector";
import { getOrCreateUserId, getDeviceId } from "@/lib/deviceId";

// ── Clothing SVG illustrations ────────────────────────────────────────────────
const ClothingIcons: Record<string, JSX.Element> = {
  shirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
      <path d="M14 4 L8 10 L4 8 L2 18 L8 17 L8 36 L32 36 L32 17 L38 18 L36 8 L32 10 L26 4 Q23 8 20 8 Q17 8 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  pants: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
      <path d="M6 4 L34 4 L34 10 L26 10 L26 36 L20 36 L20 18 L20 36 L14 36 L14 10 L6 10 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  dress: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
      <path d="M15 4 Q20 8 25 4 L30 12 L26 14 L30 36 L10 36 L14 14 L10 12 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  shoes: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
      <path d="M4 28 L4 20 Q4 14 10 14 L18 14 L18 20 L28 20 Q36 20 36 26 L36 28 L16 28 Q12 28 12 32 L4 32 Q4 30 4 28Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  bag: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
      <rect x="6" y="14" width="28" height="22" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <path d="M14 14 Q14 6 20 6 Q26 6 26 14" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <line x1="6" y1="22" x2="34" y2="22" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  jacket: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
      <path d="M14 4 L8 10 L4 8 L2 20 L8 19 L8 36 L32 36 L32 19 L38 20 L36 8 L32 10 L26 4 Q23 9 20 9 Q17 9 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="20" y1="9" x2="20" y2="36" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  skirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
      <path d="M10 8 L30 8 L36 36 L4 36 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="8" y1="14" x2="32" y2="14" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  accessory: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
      <circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <circle cx="20" cy="20" r="4" stroke="currentColor" strokeWidth="1.4" fill="none"/>
      <line x1="10" y1="10" x2="16" y2="16" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="30" y1="10" x2="24" y2="16" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="10" y1="30" x2="16" y2="24" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="30" y1="30" x2="24" y2="24" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
};

/** Pick the best icon based on the product name */
function iconForProduct(name: string): keyof typeof ClothingIcons {
  const n = name.toLowerCase();
  if (/dress|gown|romper|jumpsuit|overall/.test(n)) return "dress";
  if (/skirt/.test(n)) return "skirt";
  if (/jacket|blazer|coat|hoodie|cardigan|sweater|knit|pullover|zip|anorak|parka|windbreaker/.test(n)) return "jacket";
  if (/shirt|tee|t-shirt|top|blouse|cami|tank|crop|polo|henley/.test(n)) return "shirt";
  if (/pant|trouser|jean|denim|cargo|chino|short|legging|jogger/.test(n)) return "pants";
  if (/shoe|sneaker|boot|heel|loafer|flat|sandal|mule|clog|oxford|trainer|pump/.test(n)) return "shoes";
  if (/bag|tote|purse|clutch|backpack|pouch|wallet|satchel/.test(n)) return "bag";
  return "accessory";
}

function wardrobeCategoryFromIcon(icon: keyof typeof ClothingIcons): string {
  const map: Record<string, string> = {
    shirt: "tops", pants: "bottoms", dress: "bottoms", skirt: "bottoms",
    jacket: "outerwear", shoes: "shoes", bag: "accessories", accessory: "accessories",
  };
  return map[icon] || "accessories";
}

// ── Outfit piece card with like button ──────────────────────────────────────
function PieceCard({
  piece,
  aesthetic,
  liked,
  onToggle,
}: {
  piece: string;
  aesthetic: string;
  liked: boolean;
  onToggle: () => void;
}) {
  const icon = iconForProduct(piece);
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
        liked ? "border-primary/40 bg-primary/5" : "border-border bg-card"
      }`}
    >
      {/* Icon */}
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
          liked ? "bg-primary/10 text-primary" : "bg-muted text-foreground/40"
        }`}
      >
        {ClothingIcons[icon]}
      </div>

      {/* Label */}
      <p className="flex-1 text-sm font-medium text-foreground leading-tight">{piece}</p>

      {/* Like button */}
      <button
        onClick={onToggle}
        aria-label={liked ? "Unlike" : "Like"}
        className={`w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 transition-all active:scale-90 ${
          liked
            ? "bg-primary border-primary text-white"
            : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
        }`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill={liked ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>
    </div>
  );
}

// ── Nexbie affiliate shoe cards ──────────────────────────────────────────────
const NEXBIE_CARDS = [
  {
    title: "Leisure Path 3D Printed Casual Sneakers",
    price: "$129.00",
    image: "https://cdn.shopify.com/s/files/1/0770/2197/0651/files/leisure-path-3d-printed-casual-sneakers.jpg?v=1777443961",
    link: "https://www.awin1.com/cread.php?awinmid=125854&awinaffid=2861005&ued=https%3A%2F%2Fshoes.nexbie.com%2Fproducts%2Fleisure-path-3d-printed-casual-sneakers%3Fvariant%3D47944730345691",
  },
  {
    title: "Cloud Spark 3D Printed Sneakers",
    price: "$139.00",
    image: "https://cdn.shopify.com/s/files/1/0770/2197/0651/files/19_e855f1bb-e113-4eae-a5ad-e4de33d27fd0.jpg?v=1767581929",
    link: "https://www.awin1.com/cread.php?awinmid=125854&awinaffid=2861005&ued=https%3A%2F%2Fshoes.nexbie.com%2Fproducts%2Fcloud-spark-3d-printed-sneakers%3Fvariant%3D48012419334363",
  },
  {
    title: "Aeroraise 3D Printed Sneakers",
    price: "$159.00",
    image: "https://cdn.shopify.com/s/files/1/0770/2197/0651/files/orange-3d-printed-sneakers.webp?v=1777431698",
    link: "https://www.awin1.com/cread.php?awinmid=125854&awinaffid=2861005&ued=https%3A%2F%2Fshoes.nexbie.com%2Fproducts%2Faeroraise-3d-printed-sneakers%3Fvariant%3D48057165381851",
  },
];

const FOOTWEAR_RE = /\b(shoes?|sneakers?|boots?|sandals?|footwear|loafers?|heels?|trainers?|kicks)\b/i;

function hasFootwear(items: unknown): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((s) => typeof s === "string" && FOOTWEAR_RE.test(s));
}

function ProductCard({ product }: { product: any }) {
  const [imgError, setImgError] = useState(false);
  const hasImage = product.image && product.image.length > 0 && !imgError;
  const icon = iconForProduct(product.name);

  return (
    <div
      className="rounded-xl border border-border bg-card overflow-hidden relative hover:border-primary/40 transition-colors group cursor-pointer"
      onClick={() => window.open(product.url, '_blank', 'noopener,noreferrer')}
    >
      <div className="absolute top-2 left-2 z-10">
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-background/90 border border-border text-foreground font-semibold">
          {product.match}%
        </span>
      </div>
      {hasImage ? (
        <div
          className="aspect-[3/4] bg-cover bg-top bg-muted group-hover:scale-[1.02] transition-transform duration-500"
          style={{ backgroundImage: `url('${product.image}')` }}
        >
          {/* hidden img to detect load errors */}
          <img src={product.image} onError={() => setImgError(true)} className="hidden" alt="" />
        </div>
      ) : (
        <div className="aspect-[3/4] bg-muted flex items-center justify-center text-foreground/30 group-hover:text-primary/50 transition-colors">
          {ClothingIcons[icon]}
        </div>
      )}
      <div className="p-2">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">{product.retailer}</p>
        <p className="text-xs font-semibold text-foreground leading-tight mb-0.5">{product.name}</p>
        <p className="text-xs text-primary font-semibold">${product.price}</p>
      </div>
    </div>
  );
}

interface StyleBreakdown { label: string; score: number; } // score kept for backend compat
interface Product { id: number; name: string; brand: string; price: number; image: string; match: number; retailer: string; url: string; }

// Returns true if a hex colour is light enough to need dark text
function isLight(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const backTo = new URLSearchParams(search).get("from") === "history" ? "/history" : "/";
  const [depopMode] = useState(true); // always show Depop recommendations
  const [likedPieces, setLikedPieces] = useState<Record<string, boolean>>({});
  // depopGroups: { piece: string, listings: any[] }[]
  const [depopGroups, setDepopGroups] = useState<{ piece: string; listings: any[] }[]>([]);
  const [depopPieces, setDepopPieces] = useState<string[]>([]);
  const [depopLoading, setDepopLoading] = useState(false);
  const [depopError, setDepopError] = useState<string | null>(null);
  const depopFetchedRef = useRef(false);

  const { data: scan, isLoading, isError } = useQuery<Scan>({
    queryKey: ["/api/scans", Number(id)],
    queryFn: async () => {
      const res = await fetch(`/api/scans/${id}`);
      if (!res.ok) throw new Error("Scan not found");
      return res.json();
    },
  });

  // Pre-populate likedPieces from server so hearts persist when revisiting via history
  useEffect(() => {
    if (!scan) return;
    const userId = getOrCreateUserId();
    fetch(`/api/liked-items/${userId}`)
      .then(r => r.ok ? r.json() : { items: [] })
      .then((data: { items?: { id?: string }[] } | null) => {
        const items = Array.isArray(data?.items) ? data!.items! : [];
        const prefix = `piece_${scan.id}_`;
        const restored: Record<string, boolean> = {};
        items.forEach(item => {
          if (item?.id && typeof item.id === "string" && item.id.startsWith(prefix)) {
            const pieceName = item.id.slice(prefix.length);
            restored[pieceName] = true;
          }
        });
        if (Object.keys(restored).length > 0) {
          setLikedPieces(restored);
        }
      })
      .catch(() => {});
  }, [scan?.id]);

  // Passive signal: viewed for > 2s → mild boost to this outfit's aesthetic
  const vectorFiredRef = useRef(false);
  useEffect(() => {
    if (!scan || vectorFiredRef.current) return;
    const timer = setTimeout(() => {
      vectorFiredRef.current = true;
      try {
        let parsed: unknown = [];
        try { parsed = JSON.parse(scan.styleBreakdown || "[]"); } catch { parsed = []; }
        const styleBreakdown = Array.isArray(parsed) ? parsed : [];
        const aesthetics = [
          scan.aesthetic,
          ...styleBreakdown.map((s: any) => s?.label),
        ].filter(Boolean) as string[];
        onResultViewed(aesthetics, scan.secondaryAesthetic || undefined);
      } catch (e) {
        console.error("[results] vector signal failed", e);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [scan?.id]);

  // Reset depop fetch guard whenever the scan changes (e.g. navigating history)
  useEffect(() => {
    depopFetchedRef.current = false;
    setDepopGroups([]);
    setDepopError(null);
  }, [scan?.id]);

  // Fetch Depop recommendations from permanent cache — single shot, no polling needed.
  useEffect(() => {
    if (!depopMode || !scan || depopFetchedRef.current) return;
    depopFetchedRef.current = true;

    let pieces: string[] = [];
    try {
      const parsed = JSON.parse(scan.keyPieces || "[]");
      if (Array.isArray(parsed)) pieces = parsed.filter((p): p is string => typeof p === "string");
    } catch { pieces = []; }
    setDepopLoading(true);
    setDepopError(null);
    setDepopGroups([]);
    setDepopPieces(pieces);

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/depop-ready/${scan.id}`);
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rawGroups = Array.isArray(data?.groups) ? data.groups : [];
        const groups: { piece: string; listings: any[] }[] = rawGroups
          .filter((g: any) => g && typeof g.piece === "string")
          .map((g: any) => ({ piece: g.piece, listings: Array.isArray(g.listings) ? g.listings : [] }));
        if (groups.length > 0) {
          setDepopGroups(groups);
        } else {
          setDepopError("No matching items found on Depop");
        }
      } catch (e: any) {
        if (!cancelled) setDepopError("Could not load Depop listings");
      } finally {
        if (!cancelled) setDepopLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [depopMode, scan?.id]);

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-16 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border border-primary border-t-transparent animate-spin opacity-60" />
      </div>
    );
  }

  if (isError || !scan) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-16 text-center">
        <p className="text-muted-foreground text-sm">Scan not found.</p>
        <button onClick={() => setLocation("/")} className="text-primary text-sm mt-3 underline underline-offset-2">Go home</button>
      </div>
    );
  }

  // Safe JSON parsing — malformed DB rows return empty arrays instead of crashing
  const styleBreakdown: StyleBreakdown[] = (() => { try { return JSON.parse(scan.styleBreakdown || "[]"); } catch { return []; } })();
  const occasions: string[] = (() => { try { return JSON.parse(scan.occasions || "[]"); } catch { return []; } })();
  const keyPieces: string[] = (() => { try { return JSON.parse(scan.keyPieces || "[]"); } catch { return []; } })();
  const colorPalette: string[] = (() => { try { return JSON.parse(scan.colorPalette || "[]"); } catch { return []; } })();
  const results: Product[] = (() => { try { return JSON.parse(scan.results || "[]"); } catch { return []; } })();



  return (
    <div className="max-w-4xl mx-auto fade-up">

      {/* Results header — scanned thumb + aesthetic + close */}
      <div className="px-5 sm:px-8 pt-5 sm:pt-7 pb-3">
        <div className="flex items-center gap-3 mb-3">
          {/* Scanned thumb */}
          <div
            className="w-14 h-14 rounded-xl bg-cover bg-center border border-border flex-shrink-0"
            style={{ backgroundImage: `url('${scan.imageData}')` }}
            data-testid="img-scanned"
          />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground">Scanned outfit · {scan.aesthetic}</p>
            <p className="text-sm font-semibold text-foreground">Shop on Depop</p>
          </div>
          <button
            onClick={() => setLocation(backTo)}
            data-testid="button-back"
            className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Key pieces chips */}
        <div className="flex gap-1.5 flex-wrap">
          {keyPieces.map((p) => (
            <span key={p} className="tag">{p}</span>
          ))}
          {occasions.map((o) => (
            <span key={o} className="tag">{o}</span>
          ))}
        </div>
      </div>

      {/* Style breakdown + Colour palette — combined panel */}
      <div className="mx-5 sm:mx-8 mb-3 rounded-xl border border-border bg-card p-4 sm:p-5 flex gap-4">
        {/* Left: style breakdown */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-3">Style</p>
          <div className="flex flex-col gap-2">
            {styleBreakdown[0] && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-primary">Primary</span>
                <span className="text-sm font-semibold text-foreground leading-tight">{styleBreakdown[0].label}</span>
              </div>
            )}
            {styleBreakdown[1] && (
              <div className="flex flex-col gap-0.5 mt-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Secondary</span>
                <span className="text-sm text-muted-foreground leading-tight">{styleBreakdown[1].label}</span>
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px bg-border flex-shrink-0" />

        {/* Right: colour palette */}
        <div className="flex-shrink-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-3">Palette</p>
          <div className="flex gap-3 flex-wrap">
            {colorPalette.map((hex, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div
                  className="w-10 h-10 rounded-full border border-border/60 shadow-sm ring-2 ring-background"
                  style={{ backgroundColor: hex }}
                  data-testid={`color-swatch-${i}`}
                  title={hex}
                />
                <span className="text-[8px] font-mono text-muted-foreground">{hex}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Outfit breakdown — key pieces with like buttons */}
      {keyPieces.length > 0 && (
        <div className="mx-5 sm:mx-8 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em]">Outfit Breakdown</p>
            {Object.values(likedPieces).some(Boolean) && (
              <span className="text-[10px] text-primary font-medium">
                {Object.values(likedPieces).filter(Boolean).length} liked · style updated
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {keyPieces.map((piece) => (
              <PieceCard
                key={piece}
                piece={piece}
                aesthetic={scan.aesthetic}
                liked={!!likedPieces[piece]}
                onToggle={() => {
                  const wasLiked = !!likedPieces[piece];
                  setLikedPieces(prev => ({ ...prev, [piece]: !wasLiked }));
                  if (!wasLiked) {
                    // Boost local taste vector
                    const secondaryAesthetics = styleBreakdown.slice(1).map(s => s.label);
                    onResultSaved([scan.aesthetic, ...secondaryAesthetics], scan.secondaryAesthetic || undefined);
                    // Persist to liked_items so it shows in History → Liked
                    const userId = getOrCreateUserId();
                    if (userId) {
                      fetch("/api/interact", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "x-device-id": getDeviceId() },
                        body: JSON.stringify({
                          userId,
                          itemId: `piece_${scan.id}_${piece}`,
                          action: "like",
                          query: piece,
                          item: {
                            id: `piece_${scan.id}_${piece}`,
                            title: piece,
                            image: "", // don't send base64 imageData — too large (>100kb limit)
                            url: "",
                            _aesthetic: scan.aesthetic,
                          },
                        }),
                      })
                        .then((r) => {
                          if (r.ok) {
                            queryClient.invalidateQueries({ queryKey: ["/api/liked-items", userId] });
                          } else {
                            console.error("[like] server error", r.status);
                          }
                        })
                        .catch((e) => console.error("[like] fetch failed", e));
                    }
                  } else {
                    onUnlike(scan.aesthetic);
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Depop CTA — only for thrift-friendly aesthetics */}
      {isDepopAesthetic(scan.aesthetic) && (
        <div className="mx-5 sm:mx-8 mb-3">
          <a
            href={depopUrl(scan.aesthetic, keyPieces)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between w-full px-4 py-3 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors group"
          >
            <div className="flex items-center gap-3">
              {/* Depop wordmark dot */}
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FF2300" }}>
                <span className="text-white font-bold text-xs">d</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">Shop this look on Depop</p>
                <p className="text-[10px] text-muted-foreground">Find secondhand &amp; vintage pieces</p>
              </div>
            </div>
            <ExternalLink size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
          </a>
        </div>
      )}

      {/* Sponsored Shoes — Nexbie affiliate (only when footwear is detected) */}
      {hasFootwear(keyPieces) && (
        <div className="px-5 sm:px-8 pb-4">
          <div className="flex items-center justify-between mb-2.5">
            <p className="font-label text-[10px] text-foreground tracking-widest">SPONSORED SHOES</p>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-foreground/80 text-background font-medium">Nexbie</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {NEXBIE_CARDS.map((card) => (
              <a
                key={card.link}
                href={card.link}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="rounded-xl border border-border bg-card overflow-hidden hover:border-primary/40 transition-colors group cursor-pointer relative"
              >
                <div className="absolute top-2 left-2 z-10 text-[9px] px-1.5 py-0.5 rounded-full bg-background/90 border border-border text-foreground font-semibold">
                  Sponsored
                </div>
                <div
                  className="aspect-[3/4] bg-cover bg-center bg-muted group-hover:scale-[1.02] transition-transform duration-500"
                  style={{ backgroundImage: `url('${card.image}')` }}
                />
                <div className="p-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Nexbie</p>
                  <p className="text-[10px] font-semibold text-foreground leading-tight line-clamp-2 mb-0.5">{card.title}</p>
                  <p className="text-[10px] text-primary font-semibold">{card.price}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Product recommendations from Gemini analysis with Add to Wardrobe
      {results.length > 0 && (
        <div className="px-5 sm:px-8 pb-4">
          <div className="flex items-center justify-between mb-2.5">
            <p className="font-label text-[10px] text-foreground tracking-widest">SHOP THE LOOK</p>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">AI Picks</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {results.map((product: any) => (
              <div key={product.id} className="rounded-xl border border-border bg-card overflow-hidden hover:border-primary/40 transition-colors group relative">
                <div
                  className="aspect-[3/4] bg-cover bg-center bg-muted group-hover:scale-[1.02] transition-transform duration-500 cursor-pointer"
                  style={{ backgroundImage: `url('${product.image || ""}')` }}
                  onClick={() => window.open(product.url, '_blank', 'noopener,noreferrer')}
                />
                <div className="p-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">{product.retailer}</p>
                  <p className="text-xs font-semibold text-foreground leading-tight mb-0.5 line-clamp-2">{product.name}</p>
                  <p className="text-xs text-primary font-semibold">${product.price}</p>
                  <button
                    onClick={() => {
                      const userId = getOrCreateUserId();
                      fetch("/api/wardrobe/auto-add", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          userId,
                          name: product.name,
                          category: wardrobeCategoryFromIcon(iconForProduct(product.name)),
                          brand: product.brand,
                          aesthetic: scan.aesthetic,
                          imageUrl: product.image,
                        }),
                      }).then(r => {
                        if (r.ok) {
                          queryClient.invalidateQueries({ queryKey: ["/api/wardrobe", userId] });
                        }
                      }).catch(() => {});
                    }}
                    className="mt-1.5 w-full h-7 rounded-lg bg-primary/10 text-primary text-[10px] font-medium flex items-center justify-center gap-1 hover:bg-primary/20 transition-colors"
                  >
                    <Plus size={10} />
                    Add to Wardrobe
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      */}

      {/* Depop recommendations */}
      <div className="px-5 sm:px-8 pb-4">
          {depopLoading && (
            <div className="flex flex-col gap-6">
              {depopPieces.map((piece) => (
                <div key={piece}>
                  {/* Tappable label — live immediately */}
                  <a
                    href={`https://www.depop.com/search/?q=${encodeURIComponent(piece)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mb-2.5 group/label"
                  >
                    <p className="font-label text-[10px] text-foreground tracking-widest group-hover/label:text-primary transition-colors">{piece}</p>
                    <ExternalLink size={9} className="text-muted-foreground group-hover/label:text-primary transition-colors mt-px" />
                  </a>
                  {/* Skeleton card row */}
                  <div className="grid grid-cols-4 gap-2">
                    {[0,1,2,3].map(i => (
                      <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="aspect-[3/4] bg-muted animate-pulse" />
                        <div className="p-1.5 flex flex-col gap-1">
                          <div className="h-2 w-2/3 bg-muted animate-pulse rounded" />
                          <div className="h-2.5 w-full bg-muted animate-pulse rounded" />
                          <div className="h-2 w-1/3 bg-muted animate-pulse rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {depopError && !depopLoading && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <p className="text-xs text-muted-foreground">{depopError}</p>
              <a
                href={depopUrl(scan.aesthetic, keyPieces)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline underline-offset-2"
              >
                Search Depop directly
              </a>
            </div>
          )}
          {!depopLoading && depopGroups.length > 0 && (
            <div className="flex flex-col gap-6">
              {depopGroups.map((group) => (
                <div key={group.piece}>
                  {/* Section label — tappable, links to Depop search for this piece */}
                  <a
                    href={`https://www.depop.com/search/?q=${encodeURIComponent(group.piece)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mb-2.5 group/label"
                  >
                    <p className="font-label text-[10px] text-foreground tracking-widest group-hover/label:text-primary transition-colors">{group.piece}</p>
                    <ExternalLink size={9} className="text-muted-foreground group-hover/label:text-primary transition-colors mt-px" />
                  </a>
                  <div className="grid grid-cols-4 gap-2">
                    {(Array.isArray(group.listings) ? group.listings : []).map((item: any, idx: number) => {
                      const priceNum = typeof item?.price === "number" ? item.price : parseFloat(item?.price);
                      const priceStr = Number.isFinite(priceNum) ? `$${priceNum.toFixed(0)}` : "";
                      return (
                        <a
                          key={item?.id ?? idx}
                          href={item?.url || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-xl border border-border bg-card overflow-hidden hover:border-primary/40 transition-colors group cursor-pointer"
                        >
                          <div
                            className="aspect-[3/4] bg-cover bg-center bg-muted group-hover:scale-[1.02] transition-transform duration-500"
                            style={{ backgroundImage: `url('${item?.image || ""}')` }}
                          />
                          <div className="p-1.5">
                            <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium truncate">
                              {item?.brand || "Depop"}{item?.size ? ` · ${item.size}` : ""}
                            </p>
                            <p className="text-[10px] font-semibold text-foreground leading-tight line-clamp-2 mb-0.5">{item?.title || ""}</p>
                            {priceStr && <p className="text-[10px] text-primary font-semibold">{priceStr}</p>}
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              ))}
              <a
                href={`https://www.depop.com/search/?q=${encodeURIComponent(scan.aesthetic)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 mt-2 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                See more on Depop <ExternalLink size={11} />
              </a>
            </div>
          )}
        </div>
    </div>
  );
}
