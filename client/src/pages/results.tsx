import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShoppingBag, ExternalLink, Sparkles, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import type { Scan } from "@shared/schema";

interface StyleBreakdown { label: string; score: number; }
interface Product { id: number; name: string; brand: string; price: number; image: string; match: number; retailer: string; url: string; owned: boolean; }

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
      <div className="max-w-2xl mx-auto px-4 py-12 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (isError || !scan) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Scan not found.</p>
        <button onClick={() => setLocation("/")} className="text-primary text-sm mt-2">Back to Scan</button>
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
    <div className="max-w-2xl mx-auto px-4 py-6 fade-up">
      {/* Back */}
      <button
        onClick={() => setLocation("/")}
        data-testid="button-back"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft size={15} />
        New scan
      </button>

      {/* Scanned image + aesthetic */}
      <div className="flex gap-4 mb-6 items-start">
        <div className="w-24 h-24 rounded-xl overflow-hidden border border-border flex-shrink-0">
          <img src={scan.imageData} alt="Scanned outfit" className="w-full h-full object-cover" data-testid="img-scanned" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={14} className="text-primary" />
            <span className="text-xs text-muted-foreground">Aesthetic detected</span>
          </div>
          <h1 className="font-display text-2xl text-foreground mb-1">{scan.aesthetic}</h1>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 max-w-24 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${scan.confidence}%` }} />
            </div>
            <span className="text-xs text-primary font-medium">{scan.confidence}% match</span>
          </div>
        </div>
      </div>

      {/* Style breakdown */}
      <div className="rounded-xl bg-card border border-border p-4 mb-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Style Breakdown</h2>
        <div className="space-y-2.5">
          {styleBreakdown.map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-sm text-foreground w-28 flex-shrink-0">{item.label}</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary/70 rounded-full" style={{ width: `${item.score}%` }} />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right">{item.score}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Color palette + occasions */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-xl bg-card border border-border p-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Color Palette</h2>
          <div className="flex gap-2">
            {colorPalette.map((hex, i) => (
              <div key={i} title={hex} className="w-8 h-8 rounded-lg border border-border/50 flex-shrink-0" style={{ backgroundColor: hex }} data-testid={`color-swatch-${i}`} />
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-card border border-border p-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Occasions</h2>
          <div className="flex flex-wrap gap-1.5">
            {occasions.map((o) => (
              <Badge key={o} variant="secondary" className="text-xs">{o}</Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Key pieces */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Tag size={13} className="text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Key pieces:</span>
        {keyPieces.map((p) => (
          <span key={p} className="text-xs px-2.5 py-1 rounded-full bg-muted text-foreground border border-border">{p}</span>
        ))}
      </div>

      {/* Products */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl text-foreground">Shop the Look</h2>
          <span className="text-xs text-muted-foreground">{results.length} items found</span>
        </div>

        {/* Retailer filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
          {retailers.map((r) => (
            <button
              key={r}
              onClick={() => setActiveFilter(r)}
              data-testid={`filter-${r.toLowerCase()}`}
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all duration-150 ${
                activeFilter === r
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground border border-border"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {filteredProducts.map((product) => (
            <div
              key={product.id}
              data-testid={`card-product-${product.id}`}
              className="rounded-xl bg-card border border-border overflow-hidden hover:border-primary/30 transition-colors duration-200"
            >
              <div className="relative aspect-square overflow-hidden bg-muted">
                <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                <div className="absolute top-2 right-2">
                  <span className="text-xs px-1.5 py-0.5 rounded-md bg-background/90 text-primary font-medium border border-border">
                    {product.match}%
                  </span>
                </div>
              </div>
              <div className="p-3">
                <p className="text-xs text-muted-foreground mb-0.5">{product.brand}</p>
                <p className="text-sm font-medium text-foreground leading-tight mb-2 line-clamp-2">{product.name}</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-primary">${product.price}</span>
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid={`button-buy-${product.id}`}>
                    <ShoppingBag size={12} />
                    Shop
                    <ExternalLink size={10} />
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
