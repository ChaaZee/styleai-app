import { useState, useEffect, useRef, useCallback } from "react";
import OnboardingModal from "../components/OnboardingModal";

// ── Types ────────────────────────────────────────────────────────────────────
interface DepopItem {
  id: string;
  title: string;
  price?: { priceAmount?: string; currencyCode?: string };
  image?: string;
  slug?: string;
  brand_name?: string;
  _aesthetic?: string;
}

// ── User ID (anonymous, persisted in localStorage) ───────────────────────────
function getUserId(): string {
  let id = localStorage.getItem("stitch_user_id");
  if (!id) {
    id = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("stitch_user_id", id);
  }
  return id;
}

// ── Item Card ─────────────────────────────────────────────────────────────────
function ForYouCard({
  item,
  onInteract,
}: {
  item: DepopItem;
  onInteract: (action: "like" | "save" | "skip") => void;
}) {
  const price = item.price?.priceAmount
    ? `$${parseFloat(item.price.priceAmount).toFixed(0)}`
    : null;

  const depopUrl = item.slug
    ? `https://www.depop.com/products/${item.slug}/`
    : `https://www.depop.com/search/?q=${encodeURIComponent(item.title || "")}`;

  return (
    <div className="relative rounded-2xl overflow-hidden bg-card border border-border group">
      {/* Image */}
      <a href={depopUrl} target="_blank" rel="noopener noreferrer">
        <div className="aspect-square bg-muted overflow-hidden">
          {item.image ? (
            <img
              src={item.image}
              alt={item.title}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
          )}
        </div>
      </a>

      {/* Info */}
      <div className="p-3">
        <p
          className="text-xs text-foreground line-clamp-2 leading-snug mb-1"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
          {item.title}
        </p>
        <div className="flex items-center justify-between">
          {price && (
            <span
              className="text-sm font-medium text-primary"
              style={{ fontFamily: "'Jost', sans-serif" }}
            >
              {price}
            </span>
          )}
          {item._aesthetic && (
            <span
              className="text-[9px] text-muted-foreground uppercase tracking-widest"
              style={{ fontFamily: "'Jost', sans-serif" }}
            >
              {item._aesthetic}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex border-t border-border">
        <button
          onClick={() => onInteract("skip")}
          className="flex-1 py-2.5 flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="Not for me"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <button
          onClick={() => onInteract("like")}
          className="flex-1 py-2.5 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors border-x border-border"
          title="Like"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        <button
          onClick={() => onInteract("save")}
          className="flex-1 py-2.5 flex items-center justify-center text-muted-foreground hover:text-yellow-400 hover:bg-yellow-400/10 transition-colors"
          title="Save"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ForYouPage() {
  const userId = getUserId();
  const [onboarded, setOnboarded] = useState<boolean | null>(null); // null = loading
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [items, setItems] = useState<DepopItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [interactedIds, setInteractedIds] = useState<Set<string>>(new Set());
  const loaderRef = useRef<HTMLDivElement>(null);

  // Check onboarding status
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
      // Filter out already-interacted items
      const fresh = (data.items as DepopItem[]).filter(i => !interactedIds.has(i.id));
      setItems(prev => [...prev, ...fresh]);
      setOffset(prev => prev + 20);
      setHasMore(data.hasMore);
    } catch {
      // silently fail — user sees no new items
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, onboarded, userId, offset, interactedIds]);

  // Initial load once onboarded
  useEffect(() => {
    if (onboarded === true && items.length === 0) {
      loadMore();
    }
  }, [onboarded, loadMore]);

  // Infinite scroll observer
  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  // Handle interaction (like / save / skip)
  const handleInteract = async (item: DepopItem, action: "like" | "save" | "skip") => {
    // Optimistically remove from feed
    setItems(prev => prev.filter(i => i.id !== item.id));
    setInteractedIds(prev => new Set([...prev, item.id]));

    // Fire and forget
    fetch("/api/interact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        itemId: item.id,
        action,
        query: item.title || "",
      }),
    }).catch(() => {});
  };

  // After onboarding completes
  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setOnboarded(true);
    // Load initial recommendations
    setTimeout(() => loadMore(), 300);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background" style={{ paddingBottom: 100 }}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1
              className="text-xl text-foreground"
              style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 500, letterSpacing: "0.04em" }}
            >
              For You
            </h1>
            <p
              className="text-xs text-muted-foreground mt-0.5"
              style={{ fontFamily: "'Jost', sans-serif", fontWeight: 300, letterSpacing: "0.08em" }}
            >
              Personalized to your taste
            </p>
          </div>
          {/* Refresh taste button */}
          <button
            onClick={() => setShowOnboarding(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-full border border-border hover:border-foreground/30"
            style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.06em" }}
          >
            Retune
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        {/* Empty / loading state */}
        {onboarded === null && (
          <div className="flex items-center justify-center h-64">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {onboarded === true && items.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
            <p className="text-muted-foreground" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              No recommendations yet.
            </p>
            <button
              onClick={() => loadMore()}
              className="text-primary text-sm underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Grid */}
        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {items.map(item => (
              <ForYouCard
                key={item.id}
                item={item}
                onInteract={action => handleInteract(item, action)}
              />
            ))}
          </div>
        )}

        {/* Loader sentinel */}
        <div ref={loaderRef} className="py-8 flex items-center justify-center">
          {loading && (
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          )}
          {!hasMore && items.length > 0 && (
            <p
              className="text-xs text-muted-foreground"
              style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.1em" }}
            >
              You've seen it all · Like items to refine your feed
            </p>
          )}
        </div>
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
