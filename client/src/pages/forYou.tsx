import { useState, useEffect, useRef, useCallback } from "react";
import OnboardingModal from "../components/OnboardingModal";

// ── Types ────────────────────────────────────────────────────────────────────
interface DepopItem {
  id: string;
  title: string;
  price?: { priceAmount?: string; currencyCode?: string };
  image?: string;
  url?: string;
  slug?: string;
  brand_name?: string;
  _aesthetic?: string;
}

// ── User ID ───────────────────────────────────────────────────────────────────
function getUserId(): string {
  let id = localStorage.getItem("stitch_user_id");
  if (!id) {
    id = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("stitch_user_id", id);
  }
  return id;
}

// ── Reel Card ─────────────────────────────────────────────────────────────────
// Full-viewport card — image fills the screen, info + actions overlay at bottom
function FitCard({
  item,
  isActive,
  onInteract,
}: {
  item: DepopItem;
  isActive: boolean;
  onInteract: (action: "like" | "save" | "skip") => void;
}) {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imgError, setImgError] = useState(false);

  const price = item.price?.priceAmount
    ? `$${parseFloat(item.price.priceAmount).toFixed(0)}`
    : null;

  const depopUrl = item.url?.startsWith("https://www.depop.com/products/")
    ? item.url
    : item.slug
    ? `https://www.depop.com/products/${item.slug}/`
    : `https://www.depop.com/search/?q=${encodeURIComponent(item.title || "")}`;

  const handleLike = () => {
    if (liked) return;
    setLiked(true);
    onInteract("like");
  };

  const handleSave = () => {
    setSaved(s => !s);
    onInteract("save");
  };

  const handleSkip = () => {
    onInteract("skip");
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-black select-none">
      {/* Full-bleed image */}
      {item.image && !imgError ? (
        <img
          src={item.image}
          alt={item.title}
          onError={() => setImgError(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ willChange: "transform" }}
          loading={isActive ? "eager" : "lazy"}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-muted-foreground/30">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </div>
      )}

      {/* Gradient overlay — bottom */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: "55%",
          background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
        }}
      />

      {/* Aesthetic chip — top left */}
      {item._aesthetic && (
        <div className="absolute top-4 left-4 z-10">
          <span
            className="px-2.5 py-1 rounded-full text-[10px] font-medium tracking-widest uppercase text-white/90"
            style={{
              background: "rgba(255,255,255,0.12)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.18)",
              fontFamily: "'Jost', sans-serif",
            }}
          >
            {item._aesthetic}
          </span>
        </div>
      )}

      {/* Right-side action buttons — vertical stack */}
      <div className="absolute right-3 bottom-32 z-10 flex flex-col items-center gap-5">
        {/* Like */}
        <button
          onClick={handleLike}
          className="flex flex-col items-center gap-1 transition-transform active:scale-90"
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center transition-colors"
            style={{
              background: liked ? "rgba(255,59,59,0.25)" : "rgba(255,255,255,0.12)",
              backdropFilter: "blur(8px)",
              border: `1px solid ${liked ? "rgba(255,59,59,0.5)" : "rgba(255,255,255,0.18)"}`,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={liked ? "#ff3b3b" : "none"} stroke={liked ? "#ff3b3b" : "white"} strokeWidth="2" strokeLinecap="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </div>
          <span className="text-[9px] text-white/70" style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.08em" }}>Like</span>
        </button>

        {/* Save */}
        <button
          onClick={handleSave}
          className="flex flex-col items-center gap-1 transition-transform active:scale-90"
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center transition-colors"
            style={{
              background: saved ? "rgba(80,136,184,0.3)" : "rgba(255,255,255,0.12)",
              backdropFilter: "blur(8px)",
              border: `1px solid ${saved ? "rgba(80,136,184,0.6)" : "rgba(255,255,255,0.18)"}`,
            }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill={saved ? "#5088B8" : "none"} stroke={saved ? "#5088B8" : "white"} strokeWidth="2" strokeLinecap="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <span className="text-[9px] text-white/70" style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.08em" }}>Save</span>
        </button>

        {/* Shop link */}
        <a
          href={depopUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-1 transition-transform active:scale-90"
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{
              background: "rgba(255,255,255,0.12)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            {/* Depop "d" */}
            <div className="w-5 h-5 rounded-full bg-[#FF2300] flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold" style={{ fontSize: "11px", lineHeight: 1 }}>d</span>
            </div>
          </div>
          <span className="text-[9px] text-white/70" style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.08em" }}>Shop</span>
        </a>

        {/* Skip */}
        <button
          onClick={handleSkip}
          className="flex flex-col items-center gap-1 transition-transform active:scale-90"
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{
              background: "rgba(255,255,255,0.12)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </div>
          <span className="text-[9px] text-white/70" style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.08em" }}>Skip</span>
        </button>
      </div>

      {/* Bottom info overlay */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-6 pt-4">
        <p
          className="text-white font-medium text-sm leading-snug line-clamp-2 mb-1 pr-16"
          style={{ fontFamily: "'DM Sans', sans-serif", textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}
        >
          {item.title}
        </p>
        <div className="flex items-center gap-3">
          {price && (
            <span
              className="text-white font-semibold text-base"
              style={{ fontFamily: "'Jost', sans-serif", textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}
            >
              {price}
            </span>
          )}
          {item.brand_name && (
            <span
              className="text-white/60 text-xs"
              style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.08em" }}
            >
              {item.brand_name}
            </span>
          )}
        </div>
        {/* Swipe hint — shown only on first card */}
        <p
          className="text-white/30 text-[9px] mt-2 tracking-widest uppercase"
          style={{ fontFamily: "'Jost', sans-serif" }}
        >
          Scroll for next fit
        </p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ForYouPage() {
  const userId = getUserId();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [items, setItems] = useState<DepopItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [interactedIds, setInteractedIds] = useState<Set<string>>(new Set());
  const loaderRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check onboarding
  useEffect(() => {
    fetch(`/api/user-profile/${userId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.onboarded) {
          setOnboarded(false);
          setShowOnboarding(true);
        } else {
          setOnboarded(true);
        }
      })
      .catch(() => {
        setOnboarded(false);
        setShowOnboarding(true);
      });
  }, [userId]);

  // Load recommendations
  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !onboarded) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/for-you/${userId}?offset=${offset}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const fresh = (data.items as DepopItem[]).filter(i => !interactedIds.has(i.id));
      setItems(prev => [...prev, ...fresh]);
      setOffset(prev => prev + 20);
      setHasMore(data.hasMore);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, onboarded, userId, offset, interactedIds]);

  // Initial load
  useEffect(() => {
    if (onboarded === true && items.length === 0) loadMore();
  }, [onboarded, loadMore]);

  // IntersectionObserver to detect which card is active (for eager loading)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cards = container.querySelectorAll("[data-card-idx]");
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const idx = parseInt((entry.target as HTMLElement).dataset.cardIdx || "0");
          setActiveIdx(idx);
          // Pre-fetch when 3 from end
          if (idx >= items.length - 3) loadMore();
        }
      });
    }, { threshold: 0.6 });
    cards.forEach(c => obs.observe(c));
    return () => obs.disconnect();
  }, [items.length, loadMore]);

  // Infinite scroll sentinel
  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  // Handle interaction
  const handleInteract = useCallback(async (item: DepopItem, action: "like" | "save" | "skip") => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    setInteractedIds(prev => new Set([...prev, item.id]));
    fetch("/api/interact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        itemId: item.id,
        action,
        query: item.title || "",
        item, // full item for liked_items storage
      }),
    }).catch(() => {});
  }, [userId]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setOnboarded(true);
    setTimeout(() => loadMore(), 300);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0"
      style={{
        // Sits under the NavBar — NavBar is h-16 (64px) at bottom
        top: 0,
        bottom: 64,
        left: 0,
        right: 0,
        background: "#000",
      }}
    >
      {/* Loading spinner */}
      {onboarded === null && (
        <div className="flex items-center justify-center h-full">
          <div className="w-7 h-7 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Onboarded but no items yet */}
      {onboarded === true && items.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
          <p className="text-white/60 text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            No fits yet — like some outfits to train your feed.
          </p>
          <button
            onClick={() => setShowOnboarding(true)}
            className="px-5 py-2 rounded-full text-sm font-medium text-white"
            style={{ background: "#5088B8", fontFamily: "'Jost', sans-serif" }}
          >
            Set taste →
          </button>
        </div>
      )}

      {/* Reel container — vertical snap scroll */}
      {items.length > 0 && (
        <div
          ref={containerRef}
          className="h-full overflow-y-scroll"
          style={{
            scrollSnapType: "y mandatory",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
          }}
        >
          <style>{`
            div[data-reel-scroll]::-webkit-scrollbar { display: none; }
          `}</style>

          {items.map((item, idx) => (
            <div
              key={item.id}
              data-card-idx={String(idx)}
              style={{
                scrollSnapAlign: "start",
                height: "100%",
                flexShrink: 0,
                position: "relative",
              }}
            >
              <FitCard
                item={item}
                isActive={idx === activeIdx}
                onInteract={action => handleInteract(item, action)}
              />
            </div>
          ))}

          {/* End of feed */}
          <div ref={loaderRef} style={{ scrollSnapAlign: "start", height: "100%", position: "relative" }}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-7 h-7 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            ) : !hasMore ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
                <p className="text-white/40 text-sm" style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.1em" }}>
                  You've seen everything · Like more to improve your feed
                </p>
                <button
                  onClick={() => { setOffset(0); setHasMore(true); setItems([]); }}
                  className="text-white/60 text-xs underline"
                  style={{ fontFamily: "'Jost', sans-serif" }}
                >
                  Start over
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Floating "Retune" button — top right */}
      {onboarded === true && (
        <button
          onClick={() => setShowOnboarding(true)}
          className="absolute top-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white/80 text-[10px] tracking-widest uppercase transition-opacity hover:opacity-100"
          style={{
            background: "rgba(255,255,255,0.1)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.15)",
            fontFamily: "'Jost', sans-serif",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
          </svg>
          Retune
        </button>
      )}

      {/* Header label — top left */}
      <div
        className="absolute top-4 left-4 z-20"
        style={{ pointerEvents: "none" }}
      >
        <span
          className="text-white/90 text-lg"
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontWeight: 500,
            letterSpacing: "0.06em",
            textShadow: "0 1px 8px rgba(0,0,0,0.5)",
          }}
        >
          Fits
        </span>
      </div>

      {/* Onboarding Modal */}
      {showOnboarding && (
        <OnboardingModal
          userId={userId}
          onComplete={handleOnboardingComplete}
          onClose={() => setShowOnboarding(false)}
        />
      )}
    </div>
  );
}
