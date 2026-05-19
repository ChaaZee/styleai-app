import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Scan } from "@shared/schema";
import { getDeviceId } from "../lib/deviceId";

function getUserId(): string {
  let id = localStorage.getItem("stitch_user_id");
  if (!id) {
    id = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("stitch_user_id", id);
  }
  return id;
}

interface LikedItem {
  id: string;
  title: string;
  image?: string;
  url?: string;
  price?: number;
  brand?: string;
  _aesthetic?: string;
  likedAt: string;
}

export default function HistoryPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"scans" | "liked">("scans");
  const deviceId = getDeviceId();
  const userId = getUserId();

  const { data: scans = [], isLoading: scansLoading } = useQuery<Scan[]>({
    queryKey: ["/api/scans", deviceId],
    queryFn: async () => {
      const res = await fetch("/api/scans", { headers: { "x-device-id": deviceId } });
      if (!res.ok) throw new Error("Failed to fetch scans");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: likedData, isLoading: likedLoading } = useQuery<{ items: LikedItem[] }>({
    queryKey: ["/api/liked-items", userId],
    queryFn: async () => {
      const res = await fetch(`/api/liked-items/${userId}`);
      if (!res.ok) throw new Error("Failed to fetch liked items");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
    enabled: activeTab === "liked",
  });

  const likedItems: LikedItem[] = likedData?.items || [];

  const formatDate = (ts: any) => {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="max-w-4xl mx-auto fade-up">
      {/* Header */}
      <div className="px-5 sm:px-8 pt-5 sm:pt-7 pb-3">
        <h1 className="font-display text-3xl sm:text-4xl text-foreground">History</h1>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 px-5 sm:px-8 pb-4">
        <button
          onClick={() => setActiveTab("scans")}
          className={`px-4 py-1.5 rounded-full text-[10px] tracking-widest uppercase font-medium transition-all ${
            activeTab === "scans"
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground border border-border hover:text-foreground"
          }`}
          style={{ fontFamily: "'Jost', sans-serif" }}
        >
          Scans · {scans.length}
        </button>
        <button
          onClick={() => setActiveTab("liked")}
          className={`px-4 py-1.5 rounded-full text-[10px] tracking-widest uppercase font-medium transition-all ${
            activeTab === "liked"
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground border border-border hover:text-foreground"
          }`}
          style={{ fontFamily: "'Jost', sans-serif" }}
        >
          Liked · {likedItems.length || 0}
        </button>
      </div>

      {/* ── SCANS TAB ── */}
      {activeTab === "scans" && (
        <>
          {scansLoading && (
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

          {!scansLoading && scans.length === 0 && (
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

          {!scansLoading && scans.length > 0 && (
            <div className="px-5 sm:px-8 space-y-2 pb-4">
              {scans.map((scan, i) => {
                const palette: string[] = (() => { try { return JSON.parse(scan.colorPalette); } catch { return []; } })();
                const breakdown: { label: string; score: number }[] = (() => {
                  try { return JSON.parse(scan.styleBreakdown); } catch { return []; }
                })();
                return (
                  <div
                    key={scan.id}
                    data-testid={`card-scan-${scan.id}`}
                    style={{ animationDelay: `${i * 40}ms` }}
                    className="rounded-xl border border-border bg-card overflow-hidden fade-up"
                  >
                    <button
                      onClick={() => setLocation(`/results/${scan.id}`)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-muted/20 transition-all text-left group"
                    >
                      <div
                        className="w-16 h-16 rounded-xl bg-cover bg-center border border-border flex-shrink-0"
                        style={{ backgroundImage: `url('${scan.imageData}')` }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground text-sm truncate mb-1">{scan.aesthetic}</p>
                        {breakdown[0] && (
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="h-1 w-20 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${breakdown[0].score}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{breakdown[0].score}%</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          {palette.slice(0, 4).map((hex, j) => (
                            <div key={j} className="w-2.5 h-2.5 rounded-full border border-border/60" style={{ backgroundColor: hex }} />
                          ))}
                          <span className="text-[10px] text-muted-foreground">{formatDate(scan.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <ChevronRight size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" strokeWidth={1.75} />
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── LIKED TAB ── */}
      {activeTab === "liked" && (
        <>
          {likedLoading && (
            <div className="px-5 sm:px-8">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="aspect-[3/4] shimmer" />
                    <div className="p-2.5 space-y-1.5">
                      <div className="h-2.5 shimmer rounded-full w-3/4" />
                      <div className="h-2 shimmer rounded-full w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!likedLoading && likedItems.length === 0 && (
            <div className="text-center py-24 px-5">
              <div className="w-14 h-14 rounded-2xl border border-border flex items-center justify-center mx-auto mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </div>
              <p className="text-sm text-muted-foreground">No liked items yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Like items in Fits to save them here.</p>
            </div>
          )}

          {!likedLoading && likedItems.length > 0 && (
            <div className="px-5 sm:px-8 pb-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {likedItems.map((item, i) => (
                  <a
                    key={item.id + i}
                    href={item.url || `https://www.depop.com/search/?q=${encodeURIComponent(item.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-border bg-card overflow-hidden group hover:border-primary/40 transition-colors block"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    {/* Image */}
                    <div className="aspect-[3/4] bg-muted overflow-hidden relative">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                          </svg>
                        </div>
                      )}
                      {/* Liked heart badge */}
                      <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="#ff3b3b" stroke="#ff3b3b" strokeWidth="2" strokeLinecap="round">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                        </svg>
                      </div>
                      {/* Aesthetic chip */}
                      {item._aesthetic && (
                        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full text-[8px] font-medium text-white/90 tracking-widest uppercase"
                          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)", fontFamily: "'Jost', sans-serif" }}>
                          {item._aesthetic}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-2.5">
                      <p className="text-xs text-foreground font-medium leading-snug line-clamp-2 mb-1"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}>
                        {item.title}
                      </p>
                      <div className="flex items-center justify-between">
                        {item.price && item.price > 0 ? (
                          <span className="text-xs text-primary font-semibold" style={{ fontFamily: "'Jost', sans-serif" }}>
                            ${item.price.toFixed(0)}
                          </span>
                        ) : <span />}
                        {/* Depop badge */}
                        <div className="flex items-center gap-1">
                          <div className="w-3.5 h-3.5 rounded-full bg-[#FF2300] flex items-center justify-center">
                            <span className="text-white font-bold" style={{ fontSize: "7px", lineHeight: 1 }}>d</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
