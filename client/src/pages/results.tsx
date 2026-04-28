import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { X, ShoppingBag, ExternalLink } from "lucide-react";
import { depopUrl, isDepopAesthetic } from "@/lib/depop";
import { useState, useEffect, useRef } from "react";
import type { Scan } from "@shared/schema";
import { onResultViewed, onResultSaved } from "@/lib/styleVector";

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
  const [activeRetailer, setActiveRetailer] = useState("All");
  const [activeBudget, setActiveBudget] = useState("All");
  const [depopMode, setDepopMode] = useState(false);

  const { data: scan, isLoading, isError } = useQuery<Scan>({
    queryKey: ["/api/scans", Number(id)],
    queryFn: async () => {
      const res = await fetch(`/api/scans/${id}`);
      if (!res.ok) throw new Error("Scan not found");
      return res.json();
    },
  });

  // Passive signal: viewed for > 2s → mild boost to this outfit's aesthetic
  const vectorFiredRef = useRef(false);
  useEffect(() => {
    if (!scan || vectorFiredRef.current) return;
    const timer = setTimeout(() => {
      vectorFiredRef.current = true;
      const styleBreakdown: { label: string }[] = JSON.parse(scan.styleBreakdown || "[]");
      const aesthetics = [
        scan.aesthetic,
        ...styleBreakdown.map((s) => s.label),
      ].filter(Boolean) as string[];
      onResultViewed(aesthetics);
    }, 2000);
    return () => clearTimeout(timer);
  }, [scan]);

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

  const styleBreakdown: StyleBreakdown[] = JSON.parse(scan.styleBreakdown);
  const occasions: string[] = JSON.parse(scan.occasions);
  const keyPieces: string[] = JSON.parse(scan.keyPieces);
  const colorPalette: string[] = JSON.parse(scan.colorPalette);
  const results: Product[] = JSON.parse(scan.results);

  // Budget filter
  const budgetFiltered = activeBudget === "Budget"
    ? results.filter(r => r.price < 80)
    : activeBudget === "Mid"
      ? results.filter(r => r.price >= 80 && r.price < 200)
      : activeBudget === "Premium"
        ? results.filter(r => r.price >= 200)
        : results;

  const retailers = ["All", ...Array.from(new Set(results.map(r => r.retailer)))];
  const budgetAndRetailerFiltered = depopMode
    ? budgetFiltered
    : activeRetailer === "All"
      ? budgetFiltered
      : budgetFiltered.filter(r => r.retailer === activeRetailer);

  const outfitProducts = budgetAndRetailerFiltered.filter((p: any) => p.type === "outfit" || !p.type);
  const similarProducts = budgetAndRetailerFiltered.filter((p: any) => p.type === "similar");
  // If no split (legacy data), show all under outfit section
  const hasSplit = outfitProducts.length > 0 && similarProducts.length > 0;
  const filteredProducts = budgetAndRetailerFiltered;

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
            <p className="text-sm font-semibold text-foreground">{results.length} matches found</p>
          </div>
          <button
            onClick={() => setLocation("/")}
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
          <div className="flex gap-2 flex-wrap">
            {colorPalette.map((hex, i) => (
              <div key={i} className="flex flex-col items-center gap-1 group">
                <div
                  className="w-7 h-7 rounded-full border border-border/60 shadow-sm"
                  style={{ backgroundColor: hex }}
                  data-testid={`color-swatch-${i}`}
                />
                <span className="text-[7px] font-mono text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200">{hex}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

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

      {/* Budget toggle */}
      <div className="px-5 sm:px-8 mb-3">
        <div className="flex rounded-lg border border-border overflow-hidden bg-card">
          {["All", "Budget", "Mid", "Premium"].map((b) => (
            <button
              key={b}
              onClick={() => setActiveBudget(b)}
              className={`flex-1 py-2 text-xs font-medium transition-all ${
                activeBudget === b
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Retailer tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-5 sm:px-8 pb-3">
        {/* Depop tab — shown for thrift-friendly aesthetics */}
        <button
            key="depop"
            onClick={() => { setDepopMode(true); setActiveRetailer("All"); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all ${
              depopMode
                ? "text-white border border-transparent"
                : "bg-muted text-muted-foreground border border-border hover:text-foreground"
            }`}
            style={depopMode ? { backgroundColor: "#FF2300" } : {}}
          >
            <span className={depopMode ? "font-bold" : ""}>d</span>
            Depop
          </button>
        {retailers.map((r) => (
          <button
            key={r}
            onClick={() => { setActiveRetailer(r); setDepopMode(false); }}
            data-testid={`filter-${r.toLowerCase()}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all ${
              !depopMode && activeRetailer === r
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground border border-border hover:text-foreground"
            }`}
          >
            {r}{r === "All" ? ` (${results.length})` : ` (${results.filter(p => p.retailer === r).length})`}
          </button>
        ))}
      </div>

      {/* Product sections */}
      {depopMode ? (
        // Depop mode — illustration + name list
        <div className="px-5 sm:px-8 flex flex-col gap-2 pb-4">
          {filteredProducts.map((product) => (
            <a
              key={product.id}
              href={depopUrl(scan.aesthetic, [product.name])}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors group"
            >
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 text-foreground/40 group-hover:text-primary transition-colors">
                {ClothingIcons[iconForProduct(product.name)]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground leading-tight">{product.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{product.retailer} · Search on Depop</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          ))}
        </div>
      ) : hasSplit ? (
        // Split mode — Get the Look + Complete the Look
        <div className="pb-4">
          {/* Get the Look */}
          <div className="px-5 sm:px-8 mb-4">
            <p className="text-xs font-semibold text-foreground uppercase tracking-[0.08em] mb-2.5">Get the Look</p>
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
              {outfitProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
          {/* Complete the Look */}
          <div className="px-5 sm:px-8">
            <p className="text-xs font-semibold text-foreground uppercase tracking-[0.08em] mb-2.5">Complete the Look</p>
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
              {similarProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        // Legacy / fallback — single flat grid
        <div className="px-5 sm:px-8 grid grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 pb-4">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
