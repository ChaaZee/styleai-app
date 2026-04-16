import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
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
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="max-w-4xl mx-auto fade-up">
      {/* Header */}
      <div className="px-5 sm:px-8 pt-5 sm:pt-7 pb-4">
        <h1 className="font-display text-3xl sm:text-4xl text-foreground">Scan History</h1>
        <p className="text-xs text-muted-foreground mt-1">
          {scans.length} outfit{scans.length !== 1 ? "s" : ""} analysed
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="px-5 sm:px-8 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3 flex gap-3 items-center">
              <div className="w-16 h-16 rounded-xl shimmer flex-shrink-0" />
              <div className="flex-1">
                <div className="h-3.5 shimmer rounded-full w-1/3 mb-2" />
                <div className="h-2.5 shimmer rounded-full w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && scans.length === 0 && (
        <div className="text-center py-24 px-5">
          <div className="w-14 h-14 rounded-2xl border border-border flex items-center justify-center mx-auto mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">No scans yet.</p>
          <button
            onClick={() => setLocation("/scan")}
            className="text-sm text-primary mt-2 underline underline-offset-2"
          >
            Scan your first outfit
          </button>
        </div>
      )}

      {/* Scan list — each row matches the results-query style from mockup */}
      {!isLoading && scans.length > 0 && (
        <div className="px-5 sm:px-8 space-y-2 pb-4">
          {scans.map((scan, i) => {
            const palette: string[] = (() => { try { return JSON.parse(scan.colorPalette); } catch { return []; } })();
            const breakdown: { label: string; score: number }[] = (() => {
              try { return JSON.parse(scan.styleBreakdown); } catch { return []; }
            })();

            return (
              <button
                key={scan.id}
                onClick={() => setLocation(`/results/${scan.id}`)}
                data-testid={`card-scan-${scan.id}`}
                style={{ animationDelay: `${i * 40}ms` }}
                className="w-full rounded-xl border border-border bg-card p-3 flex items-center gap-3 hover:border-primary/30 hover:bg-muted/20 transition-all text-left fade-up group"
              >
                {/* Thumbnail */}
                <div
                  className="w-16 h-16 rounded-xl bg-cover bg-center border border-border flex-shrink-0"
                  style={{ backgroundImage: `url('${scan.imageData}')` }}
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm truncate mb-1">{scan.aesthetic}</p>

                  {/* Mini style bar */}
                  {breakdown[0] && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="h-1 w-20 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${breakdown[0].score}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{breakdown[0].score}%</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {/* Colour dots */}
                    {palette.slice(0, 4).map((hex, j) => (
                      <div key={j} className="w-2.5 h-2.5 rounded-full border border-border/60" style={{ backgroundColor: hex }} />
                    ))}
                    <span className="text-[10px] text-muted-foreground">{formatDate(scan.createdAt)}</span>
                  </div>
                </div>

                <ChevronRight size={14} className="text-muted-foreground flex-shrink-0 group-hover:text-foreground transition-colors" strokeWidth={1.75} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
