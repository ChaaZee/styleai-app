import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { X, ShoppingBag, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { Scan } from "@shared/schema";

interface StyleBreakdown { label: string; score: number; } // score kept for backend compat
interface Product { id: number; name: string; brand: string; price: number; image: string; match: number; retailer: string; url: string; }

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [activeRetailer, setActiveRetailer] = useState("All");
  const [activeBudget, setActiveBudget] = useState("All");

  const { data: scan, isLoading, isError } = useQuery<Scan>({
    queryKey: ["/api/scans", Number(id)],
    queryFn: async () => {
      const res = await fetch(`/api/scans/${id}`);
      if (!res.ok) throw new Error("Scan not found");
      return res.json();
    },
  });

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
  const filteredProducts = activeRetailer === "All"
    ? budgetFiltered
    : budgetFiltered.filter(r => r.retailer === activeRetailer);

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
            {/* Colour palette dots */}
            <div className="flex gap-1 mt-1">
              {colorPalette.map((hex, i) => (
                <div key={i} className="w-3 h-3 rounded-full border border-border/60" style={{ backgroundColor: hex }} data-testid={`color-swatch-${i}`} />
              ))}
            </div>
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

      {/* Style breakdown */}
      <div className="mx-5 sm:mx-8 mb-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-3">Style Breakdown</p>
        <div className="flex flex-col gap-2">
          {styleBreakdown[0] && (
            <div className="flex items-center gap-2.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-primary w-20 flex-shrink-0">Primary</span>
              <span className="text-sm font-semibold text-foreground">{styleBreakdown[0].label}</span>
            </div>
          )}
          {styleBreakdown[1] && (
            <div className="flex items-center gap-2.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground w-20 flex-shrink-0">Secondary</span>
              <span className="text-sm text-muted-foreground">{styleBreakdown[1].label}</span>
            </div>
          )}
        </div>
      </div>

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
        {retailers.map((r) => (
          <button
            key={r}
            onClick={() => setActiveRetailer(r)}
            data-testid={`filter-${r.toLowerCase()}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all ${
              activeRetailer === r
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground border border-border hover:text-foreground"
            }`}
          >
            {r}{r === "All" ? ` (${results.length})` : ` (${results.filter(p => p.retailer === r).length})`}
          </button>
        ))}
      </div>

      {/* Product grid — 3 cols mobile, 4 cols on lg+ */}
      <div className="px-5 sm:px-8 grid grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 pb-4">
        {filteredProducts.map((product) => (
          <div
            key={product.id}
            data-testid={`card-product-${product.id}`}
            className="rounded-xl border border-border bg-card overflow-hidden relative hover:border-primary/40 transition-colors group cursor-pointer"
            onClick={() => window.open(product.url, '_blank', 'noopener,noreferrer')}
          >
            {/* Match score badge */}
            <div className="absolute top-2 left-2 z-10">
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-background/90 border border-border text-foreground font-semibold">
                {product.match}%
              </span>
            </div>
            {/* Product image */}
            <div
              className="aspect-[3/4] bg-cover bg-top bg-muted group-hover:scale-[1.02] transition-transform duration-500"
              style={{ backgroundImage: `url('${product.image}')` }}
            />
            {/* Info */}
            <div className="p-2">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">{product.retailer}</p>
              <p className="text-xs font-semibold text-foreground leading-tight mb-0.5">{product.name}</p>
              <p className="text-xs text-primary font-semibold">${product.price}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
