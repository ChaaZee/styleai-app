import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Clock, ChevronRight, Sparkles } from "lucide-react";
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

  const handleScanClick = (scan: Scan) => {
    setLocation(`/results/${scan.id}`);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="font-display text-3xl gold-gradient">Scan History</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{scans.length} outfit{scans.length !== 1 ? "s" : ""} analyzed</p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl bg-card border border-border p-4 flex gap-3">
              <div className="w-14 h-14 rounded-lg shimmer flex-shrink-0" />
              <div className="flex-1"><div className="h-4 shimmer rounded w-1/3 mb-2" /><div className="h-3 shimmer rounded w-1/2" /></div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && scans.length === 0 && (
        <div className="text-center py-20 fade-up">
          <Clock size={40} className="mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">No scans yet. Upload your first outfit to get started.</p>
        </div>
      )}

      <div className="space-y-3">
        {scans.map((scan) => (
          <button
            key={scan.id}
            onClick={() => handleScanClick(scan)}
            data-testid={`card-scan-${scan.id}`}
            className="w-full rounded-xl bg-card border border-border p-4 flex items-center gap-3 hover:border-primary/30 transition-colors text-left fade-up"
          >
            <div className="w-14 h-14 rounded-lg overflow-hidden bg-muted flex-shrink-0">
              <img src={scan.imageData} alt={scan.aesthetic} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Sparkles size={12} className="text-primary flex-shrink-0" />
                <span className="font-medium text-foreground text-sm truncate">{scan.aesthetic}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1 w-16 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary/70 rounded-full" style={{ width: `${scan.confidence}%` }} />
                </div>
                <span className="text-xs text-primary">{scan.confidence}%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{formatDate(scan.createdAt)}</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
