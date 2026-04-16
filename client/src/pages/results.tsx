import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShoppingBag, ExternalLink, Tag } from "lucide-react";
import { useState } from "react";
import type { Scan } from "@shared/schema";

interface StyleBreakdown { label: string; score: number; }
interface Product { id: number; name: string; brand: string; price: number; image: string; match: number; retailer: string; url: string; }

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState("All");

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
        <button onClick={() => setLocation("/")} className="text-primary text-sm mt-3 underline underline-offset-2">Back to Scan</button>
      </div>
    );
  }

  const styleBreakdown: StyleBreakdown[] = JSON.parse(scan.styleBreakdown);
  const occasions: string[] = JSON.parse(scan.occasions);
  const keyPieces: string[] = JSON.parse(scan.keyPieces);
  const colorPalette: string[] = JSON.parse(scan.colorPalette);
  const results: Product[] = JSON.parse(scan.results);

  const retailers = ["All", ...Array.from(new Set(results.map(r => r.retailer)))];
  const filteredProducts = activeFilter === "All" ? results : results.filter(r => r.retailer === activeFilter);

  return (
    <div className="max-w-2xl mx-auto px-5 py-8 fade-up">

      {/* Back */}
      <button
        onClick={() => setLocation("/")}
        data-testid="button-back"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-8 transition-colors tracking-wide uppercase font-medium"
      >
        <ArrowLeft size={13} strokeWidth={2} />
        New scan
      </button>

      {/* Hero: image + aesthetic */}
      <div className="flex gap-5 mb-8 items-start">
        <div className="w-[88px] h-[88px] rounded-xl overflow-hidden border border-border flex-shrink-0 shadow-sm">
          <img src={scan.imageData} alt="Scanned outfit" className="w-full h-full object-cover" data-testid="img-scanned" />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <p className="text-xs font-medium tracking-[0.1em] uppercase text-primary mb-1.5">Aesthetic detected</p>
          <h1 className="font-display text-3xl text-foreground mb-2">{scan.aesthetic}</h1>
          {/* Confidence bar */}
          <div className="flex items-center gap-3">
            <div className="h-1 flex-1 max-w-[120px] bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full match-bar" style={{ width: `${scan.confidence}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">{scan.confidence}% confidence</span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border mb-6" />

      {/* Style breakdown */}
      <div className="mb-6">
        <h2 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-4">Style Breakdown</h2>
        <div className="space-y-3">
          {styleBreakdown.map((item, i) => (
            <div key={item.label} className="flex items-center gap-4">
              <span className="text-sm text-foreground w-32 flex-shrink-0 font-medium">{item.label}</span>
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full match-bar"
                  style={{
                    width: `${item.score}%`,
                    background: i === 0
                      ? "hsl(24 42% 60%)"
                      : i === 1
                        ? "hsl(24 42% 70%)"
                        : "hsl(24 42% 80%)"
                  }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right">{item.score}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Color palette + occasions row */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Palette */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-3">Palette</h2>
          <div className="flex gap-2 items-center">
            {colorPalette.map((hex, i) => (
              <div
                key={i}
                title={hex}
                className="w-8 h-8 rounded-lg border border-border/60 shadow-sm flex-shrink-0"
                style={{ backgroundColor: hex }}
                data-testid={`color-swatch-${i}`}
              />
            ))}
          </div>
        </div>
        {/* Occasions */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-3">Occasions</h2>
          <div className="flex flex-wrap gap-1.5">
            {occasions.map((o) => (
              <span key={o} className="tag">{o}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Key pieces */}
      <div className="flex items-start gap-2 mb-8 flex-wrap">
        <Tag size={12} className="text-muted-foreground mt-0.5 flex-shrink-0" strokeWidth={1.5} />
        <div className="flex flex-wrap gap-1.5">
          {keyPieces.map((p) => (
            <span key={p} className="tag">{p}</span>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border mb-6" />

      {/* Shop section */}
      <div>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-2xl text-foreground">Shop the look</h2>
          <span className="text-xs text-muted-foreground">{results.length} items</span>
        </div>

        {/* Retailer filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 mb-5 no-scrollbar">
          {retailers.map((r) => (
            <button
              key={r}
              onClick={() => setActiveFilter(r)}
              data-testid={`filter-${r.toLowerCase()}`}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all duration-150 ${
                activeFilter === r
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground border border-border"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <div className="grid grid-cols-2 gap-3">
          {filteredProducts.map((product) => (
            <div
              key={product.id}
              data-testid={`card-product-${product.id}`}
              className="rounded-xl border border-border bg-card overflow-hidden hover:border-primary/40 transition-colors duration-200 group"
            >
              <div className="relative aspect-[3/4] overflow-hidden bg-muted">
                <img src={product.image} alt={product.name} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
                {/* Match badge */}
                <div className="absolute top-2.5 left-2.5">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-background/90 border border-border text-foreground font-medium">
                    {product.match}% match
                  </span>
                </div>
              </div>
              <div className="p-3">
                <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide font-medium">{product.brand}</p>
                <p className="text-sm text-foreground leading-snug mb-2.5 line-clamp-2">{product.name}</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">${product.price}</span>
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                    data-testid={`button-buy-${product.id}`}
                  >
                    <ShoppingBag size={11} strokeWidth={1.5} />
                    Shop
                    <ExternalLink size={9} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
