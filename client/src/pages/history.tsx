import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Clock, ChevronRight } from "lucide-react";
import type { Scan } from "@shared/schema";

export default function HistoryPage() {
  const [, setLocation] = useLocation();
  const { data: scans = [], isLoading } = useQuery<Scan[]>({
    queryKey: ["/api/scans"],
    staleTime: 0,
    refetchOnMount: true,
  });

  const formatDate = (ts: any) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-8 fade-up">

      {/* Header */}
      <div className="mb-8">
        <p className="text-xs font-medium tracking-[0.12em] uppercase text-primary mb-2">Archive</p>
        <h1 className="font-display text-4xl text-foreground">Scan History</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          {scans.length} outfit{scans.length !== 1 ? "s" : ""} analysed
        </p>
      </div>

      {/* Loading skeletons */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 flex gap-4 items-center">
              <div className="w-14 h-14 rounded-lg shimmer flex-shrink-0" />
              <div className="flex-1">
                <div className="h-3.5 shimmer rounded-full w-1/3 mb-2.5" />
                <div className="h-2.5 shimmer rounded-full w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && scans.length === 0 && (
        <div className="text-center py-24">
          <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center mx-auto mb-4">
            <Clock size={20} className="text-muted-foreground" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-muted-foreground">No scans yet.</p>
          <button
            onClick={() => setLocation("/")}
            className="text-sm text-primary mt-2 underline underline-offset-2"
          >
            Scan your first outfit
          </button>
        </div>
      )}

      {/* Scan list */}
      <div className="space-y-2">
        {scans.map((scan, i) => {
          const palette: string[] = (() => {
            try { return JSON.parse(scan.colorPalette); } catch { return []; }
          })();

          return (
            <button
              key={scan.id}
              onClick={() => setLocation(`/results/${scan.id}`)}
              data-testid={`card-scan-${scan.id}`}
              style={{ animationDelay: `${i * 40}ms` }}
              className="w-full rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:border-primary/30 hover:bg-muted/30 transition-all duration-150 text-left fade-up"
            >
              {/* Thumbnail */}
              <div className="w-14 h-14 rounded-lg overflow-hidden border border-border flex-shrink-0 bg-muted">
                <img src={scan.imageData} alt={scan.aesthetic} className="w-full h-full object-cover" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm truncate mb-1">{scan.aesthetic}</p>
                <div className="flex items-center gap-3">
                  {/* Colour dots */}
                  {palette.slice(0, 4).length > 0 && (
                    <div className="flex gap-1">
                      {palette.slice(0, 4).map((hex, j) => (
                        <div key={j} className="w-3 h-3 rounded-full border border-border/60" style={{ backgroundColor: hex }} />
                      ))}
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground">{scan.confidence}% · {formatDate(scan.createdAt)}</span>
                </div>
              </div>

              <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" strokeWidth={1.5} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
