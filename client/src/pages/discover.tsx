import { useState, useCallback, useEffect, useRef } from "react";
import { onLike, onUnlike, rankByVector } from "@/lib/styleVector";
import { getUserId } from "@/lib/deviceId";

// ── Clothing icon map ─────────────────────────────────────────────────────────
type IconKey = "shirt"|"pants"|"dress"|"shoes"|"bag"|"jacket"|"skirt"|"accessory";
const ClothingIcons: Record<IconKey, JSX.Element> = {
  shirt:     <svg viewBox="0 0 40 40" fill="none" width="24" height="24"><path d="M14 4 L8 10 L4 8 L2 18 L8 17 L8 36 L32 36 L32 17 L38 18 L36 8 L32 10 L26 4 Q23 8 20 8 Q17 8 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>,
  pants:     <svg viewBox="0 0 40 40" fill="none" width="24" height="24"><path d="M6 4 L34 4 L34 10 L26 10 L26 36 L20 36 L20 18 L20 36 L14 36 L14 10 L6 10 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>,
  dress:     <svg viewBox="0 0 40 40" fill="none" width="24" height="24"><path d="M15 4 Q20 8 25 4 L30 12 L26 14 L30 36 L10 36 L14 14 L10 12 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>,
  shoes:     <svg viewBox="0 0 40 40" fill="none" width="24" height="24"><path d="M4 28 L4 20 Q4 14 10 14 L18 14 L18 20 L28 20 Q36 20 36 26 L36 28 L16 28 Q12 28 12 32 L4 32 Q4 30 4 28Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>,
  bag:       <svg viewBox="0 0 40 40" fill="none" width="24" height="24"><rect x="6" y="14" width="28" height="22" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M14 14 Q14 6 20 6 Q26 6 26 14" stroke="currentColor" strokeWidth="1.8"/><line x1="6" y1="22" x2="34" y2="22" stroke="currentColor" strokeWidth="1.4"/></svg>,
  jacket:    <svg viewBox="0 0 40 40" fill="none" width="24" height="24"><path d="M14 4 L8 10 L4 8 L2 20 L8 19 L8 36 L32 36 L32 19 L38 20 L36 8 L32 10 L26 4 Q23 9 20 9 Q17 9 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><line x1="20" y1="9" x2="20" y2="36" stroke="currentColor" strokeWidth="1.4"/></svg>,
  skirt:     <svg viewBox="0 0 40 40" fill="none" width="24" height="24"><path d="M10 8 L30 8 L36 36 L4 36 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><line x1="8" y1="14" x2="32" y2="14" stroke="currentColor" strokeWidth="1.4"/></svg>,
  accessory: <svg viewBox="0 0 40 40" fill="none" width="24" height="24"><circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="1.8"/><circle cx="20" cy="20" r="4" stroke="currentColor" strokeWidth="1.4"/></svg>,
};

function pieceIcon(piece: string): IconKey {
  const p = piece.toLowerCase();
  if (p.includes("pant")||p.includes("jean")||p.includes("trouser")||p.includes("short")) return "pants";
  if (p.includes("shoe")||p.includes("sneaker")||p.includes("boot")||p.includes("heel")||p.includes("sandal")) return "shoes";
  if (p.includes("bag")||p.includes("tote")||p.includes("purse")) return "bag";
  if (p.includes("dress")) return "dress";
  if (p.includes("skirt")) return "skirt";
  if (p.includes("jacket")||p.includes("coat")||p.includes("blazer")||p.includes("hoodie")) return "jacket";
  return "shirt";
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface OutfitCard {
  id: string;
  imageUrl: string;
  aesthetic: string;
  palette: string[];
  tags: string[];
  keyPieces: string[];
  postUrl?: string;
  subreddit?: string;
  likesCount?: number;
}
interface LikedItem { id: string; aesthetic: string; likedAt: number; }
interface DepopListing { title: string; image: string; url: string; price: number; }
interface ShopTheLookGroup { piece: string; items: DepopListing[]; }

// ── Heart burst overlay ───────────────────────────────────────────────────────
function HeartBurst({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-20">
      <svg width="90" height="90" viewBox="0 0 24 24" fill="#E8405A" stroke="#E8405A" strokeWidth="0.5"
        style={{ animation: "heartPop 0.55s ease forwards" }}>
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    </div>
  );
}

// ── Shop the Look panel ───────────────────────────────────────────────────────
function ShopTheLookPanel({ aesthetic, keyPieces }: { aesthetic: string; keyPieces: string[] }) {
  const [groups, setGroups] = useState<ShopTheLookGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const fetched = useRef<string>("");

  useEffect(() => {
    const key = `${aesthetic}|${keyPieces.slice(0,4).join(",")}`;
    if (!keyPieces.length || fetched.current === key) return;
    fetched.current = key;
    setLoading(true);
    const pieces = encodeURIComponent(keyPieces.slice(0,4).join(","));
    fetch(`/api/discover/shop-the-look?aesthetic=${encodeURIComponent(aesthetic)}&pieces=${pieces}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data)) setGroups(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [aesthetic, keyPieces]);

  // Fallback to static links while loading or if no results
  const showFallback = !loading && (!groups || groups.every(g => !g.items?.length));

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="font-label text-[9px] text-muted-foreground">Shop the Look</p>
        <div className="flex items-center gap-1">
          <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ backgroundColor: "#FF2300" }}>
            <span className="text-white font-bold" style={{ fontSize: "8px" }}>d</span>
          </div>
          <span className="text-[9px] text-muted-foreground">Depop</span>
        </div>
      </div>

      {loading && (
        <div className="flex gap-1.5">
          {keyPieces.slice(0,4).map((_, i) => (
            <div key={i} className="flex-1 rounded-xl border border-border aspect-square shimmer" />
          ))}
        </div>
      )}

      {!loading && groups && groups.some(g => g.items?.length > 0) && (
        <div className="flex gap-1.5">
          {groups.map(({ piece, items }) => {
            const item = items[0];
            if (!item) return null;
            return (
              <a key={piece}
                href={item.url}
                target="_blank" rel="noopener noreferrer"
                className="flex-1 flex flex-col items-center gap-1 rounded-xl border border-border overflow-hidden hover:border-primary/50 transition-colors group">
                {item.image ? (
                  <div className="w-full aspect-square overflow-hidden">
                    <img src={item.image} alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  </div>
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center">
                    <span className="text-foreground/60">{ClothingIcons[pieceIcon(piece)]}</span>
                  </div>
                )}
                <div className="px-1 pb-1.5 w-full">
                  <p className="text-[8px] text-muted-foreground text-center leading-tight line-clamp-1">{piece}</p>
                  {item.price > 0 && (
                    <p className="text-[8px] font-medium text-foreground text-center">${item.price.toFixed(0)}</p>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}

      {showFallback && (
        <div className="flex gap-1.5">
          {keyPieces.slice(0,4).map(piece => (
            <a key={piece}
              href={`https://www.depop.com/search/?q=${encodeURIComponent(`${piece} ${aesthetic}`)}`}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl border border-border hover:border-primary/50 transition-colors group">
              <span className="text-foreground/60 group-hover:text-primary transition-colors">{ClothingIcons[pieceIcon(piece)]}</span>
              <span className="text-[9px] text-muted-foreground text-center leading-tight line-clamp-2">{piece}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single card ───────────────────────────────────────────────────────────────
function DiscoverCard({ card, liked, onToggleLike }: {
  card: OutfitCard; liked: boolean; onToggleLike: () => void;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [burst, setBurst] = useState(false);
  const lastTap = useRef(0);
  const [burstHeart, setBurstHeart] = useState(false);

  const handleImgTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 350) {
      setBurstHeart(true);
      setTimeout(() => setBurstHeart(false), 600);
      if (!liked) onToggleLike();
    }
    lastTap.current = now;
  };

  const handleHeart = () => {
    if (!liked) { setBurst(true); setTimeout(() => setBurst(false), 600); }
    onToggleLike();
  };

  return (
    <div className="flex flex-col bg-background" style={{ height: "100%", flexShrink: 0 }}>
      {/* Image — 60% */}
      <div className="relative overflow-hidden bg-muted" style={{ height: "60%", flexShrink: 0 }} onClick={handleImgTap}>
        {!imgLoaded && !imgError && <div className="absolute inset-0 bg-muted animate-pulse"/>}
        {!imgError
          ? <img src={card.imageUrl} alt={card.aesthetic} draggable={false}
              className="w-full h-full object-cover select-none"
              style={{ opacity: imgLoaded ? 1 : 0, transition: "opacity 0.3s" }}
              onLoad={() => setImgLoaded(true)} onError={() => { setImgError(true); setImgLoaded(true); }}/>
          : <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">Image unavailable</div>
        }
        <HeartBurst visible={burstHeart}/>
        {imgLoaded && !imgError && (
          <div className="absolute bottom-3 left-3">
            <span className="px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: "rgba(0,0,0,0.45)", fontFamily: "'Jost', sans-serif", fontWeight: 300, fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              {card.aesthetic}
            </span>
          </div>
        )}
        {/* Heart button */}
        <button onClick={e => { e.stopPropagation(); handleHeart(); }}
          className="absolute bottom-3 right-3 w-10 h-10 flex items-center justify-center active:scale-90 transition-transform"
          style={{ WebkitTapHighlightColor: "transparent" }}>
          {burst && <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: "rgba(232,64,90,0.3)", animationDuration: "0.5s" }}/>}
          <svg width="24" height="24" viewBox="0 0 24 24"
            fill={liked ? "#E8405A" : "none"} stroke="white" strokeWidth="1.75" strokeLinecap="round"
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))", transition: "fill 0.2s", transform: burst ? "scale(1.3)" : "scale(1)" }}>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
      </div>

      {/* Info panel — 40% */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5" style={{ minHeight: 0 }}>
        {/* Palette */}
        <div className="flex gap-1.5">
          {card.palette.slice(0,5).map((hex,i) => (
            <div key={i} className="w-5 h-5 rounded-full border border-border/60 flex-shrink-0" style={{ backgroundColor: hex }}/>
          ))}
        </div>

        {/* Shop the Look — real Depop items via vector search */}
        {card.keyPieces.length > 0 && (
          <ShopTheLookPanel aesthetic={card.aesthetic} keyPieces={card.keyPieces} />
        )}

        {/* Tags + source */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 flex-wrap">
            {card.tags.slice(0,3).map(t => <span key={t} className="tag text-[10px] px-2 py-0.5">{t}</span>)}
          </div>
          {card.postUrl && (
            <a href={card.postUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary flex-shrink-0">
              <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 0C4.478 0 0 4.478 0 10s4.478 10 10 10 10-4.478 10-10S15.522 0 10 0zm4.898 7.01a1.333 1.333 0 1 1 0 2.667 1.333 1.333 0 0 1 0-2.667zm-9.796 0a1.333 1.333 0 1 1 0 2.667 1.333 1.333 0 0 1 0-2.667zM10 15.5c-2.56 0-4.7-1.46-5.5-3.5h11c-.8 2.04-2.94 3.5-5.5 3.5z"/>
              </svg>
              r/{card.subreddit || "reddit"}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DiscoverPage() {
  const [cards, setCards] = useState<OutfitCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const userId = getUserId();

  // Touch swipe state
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const swiping = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load(attempt = 1) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 55000);
        // Pass userId for personalized ordering if available
        const url = userId ? `/api/discover?userId=${encodeURIComponent(userId)}` : "/api/discover";
        const r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        const data = await r.json();
        if (cancelled) return;
        if (!Array.isArray(data) || data.length === 0) {
          if (attempt < 2) { setTimeout(() => load(2), 3000); return; }
          setLoading(false); return;
        }
        const parsed: OutfitCard[] = data.map((row: any) => ({
          id: String(row.id),
          imageUrl: row.image_url || row.imageUrl || "",
          aesthetic: row.aesthetic || "",
          palette: (() => { try { return JSON.parse(row.color_palette || row.colorPalette || "[]"); } catch { return []; } })(),
          tags: (() => { try { return JSON.parse(row.tags || "[]"); } catch { return []; } })(),
          keyPieces: (() => { try { return JSON.parse(row.key_pieces || row.keyPieces || "[]"); } catch { return []; } })(),
          postUrl: row.post_url || row.postUrl || null,
          subreddit: row.subreddit || null,
          likesCount: row.likes_count ?? row.likesCount ?? 0,
        }));
        // If userId returned personalised (already taste-ordered), skip client-side re-rank
        const ranked = userId ? parsed : rankByVector(parsed);
        if (!cancelled) { setCards(ranked); setLoading(false); }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const [likes, setLikes] = useState<Record<string, boolean>>(() => {
    try { const a: LikedItem[] = JSON.parse(localStorage.getItem("stitch_likes") || "[]"); return Object.fromEntries(a.map(l => [l.id, true])); }
    catch { return {}; }
  });

  const toggleLike = useCallback((card: OutfitCard) => {
    setLikes(prev => {
      const next = { ...prev, [card.id]: !prev[card.id] };
      if (next[card.id]) {
        onLike(card.aesthetic, card.tags);
        fetch(`/api/discover/${card.id}/like`, { method: "POST" }).catch(() => {});
      } else {
        onUnlike(card.aesthetic, card.tags);
      }
      try {
        const arr: LikedItem[] = JSON.parse(localStorage.getItem("stitch_likes") || "[]");
        if (next[card.id]) { if (!arr.find(l => l.id === card.id)) arr.push({ id: card.id, aesthetic: card.aesthetic, likedAt: Date.now() }); }
        else { const i = arr.findIndex(l => l.id === card.id); if (i !== -1) arr.splice(i, 1); }
        localStorage.setItem("stitch_likes", JSON.stringify(arr));
      } catch {}
      return next;
    });
  }, []);

  const goNext = useCallback(() => setIdx(i => Math.min(i + 1, cards.length)), [cards.length]);
  const goPrev = useCallback(() => setIdx(i => Math.max(i - 1, 0)), []);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    swiping.current = true;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!swiping.current) return;
    swiping.current = false;
    const dy = touchStartY.current - e.changedTouches[0].clientY;
    const dx = Math.abs(touchStartX.current - e.changedTouches[0].clientX);
    if (Math.abs(dy) < 50 || dx > Math.abs(dy) * 0.8) return;
    if (dy > 0) goNext(); else goPrev();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 bg-background" style={{ height: "100%", paddingBottom: "64px", boxSizing: "border-box" }}>
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin"/>
        <p className="text-sm text-muted-foreground">Loading outfits…</p>
        <p className="text-xs text-muted-foreground/50">Server may take a moment to wake up</p>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-8 text-center bg-background" style={{ height: "100%", paddingBottom: "64px", boxSizing: "border-box" }}>
        <p className="text-sm font-medium text-foreground">No outfits yet</p>
        <p className="text-xs text-muted-foreground">Check back soon.</p>
      </div>
    );
  }

  // End card
  if (idx >= cards.length) {
    const likedCount = Object.values(likes).filter(Boolean).length;
    return (
      <div className="flex flex-col items-center justify-center gap-3 bg-background" style={{ height: "100%", paddingBottom: "64px", boxSizing: "border-box" }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#E8405A" strokeWidth="1.5" strokeLinecap="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <p className="font-display text-2xl text-foreground">You're all caught up</p>
        <p className="text-sm text-muted-foreground">{likedCount} outfit{likedCount !== 1 ? "s" : ""} liked</p>
        <button onClick={() => setIdx(0)} className="mt-2 text-xs text-primary underline">Start over</button>
      </div>
    );
  }

  const card = cards[idx];

  return (
    <>
      <style>{`
        @keyframes heartPop {
          0%   { transform: scale(0.4); opacity: 0; }
          50%  { transform: scale(1.25); opacity: 1; }
          80%  { transform: scale(0.95); opacity: 1; }
          100% { transform: scale(1.1); opacity: 0; }
        }
      `}</style>

      {/* Progress indicator */}
      <div className="flex gap-px px-4 pt-2 flex-shrink-0" style={{ paddingBottom: "4px" }}>
        {cards.slice(0, Math.min(cards.length, 20)).map((_, i) => (
          <div key={i} className="h-0.5 flex-1 rounded-full transition-colors duration-300"
            style={{ backgroundColor: i <= idx ? "hsl(var(--primary))" : "hsl(var(--border))" }}/>
        ))}
      </div>

      {/* Card area with swipe */}
      <div
        style={{ flex: 1, minHeight: 0, paddingBottom: "64px", boxSizing: "border-box", touchAction: "pan-x pinch-zoom" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <DiscoverCard
          key={card.id}
          card={card}
          liked={!!likes[card.id]}
          onToggleLike={() => toggleLike(card)}
        />
      </div>

      {/* Nav arrows (visible on desktop, hidden on mobile via opacity) */}
      <div className="absolute bottom-20 right-4 flex flex-col gap-2 opacity-0 sm:opacity-100 pointer-events-none sm:pointer-events-auto">
        <button onClick={goPrev} disabled={idx === 0} className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center disabled:opacity-30">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
        </button>
        <button onClick={goNext} className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
    </>
  );
}
