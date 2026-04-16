import { Link, useLocation } from "wouter";

// Bottom navigation with central FAB camera button — matches mockup exactly
export default function NavBar() {
  const [location] = useLocation();

  const isHome = location === "/";
  const isWardrobe = location.startsWith("/wardrobe");
  const isHistory = location.startsWith("/history");
  const isScan = location === "/scan" || location.startsWith("/results");

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-end justify-around surface-glass border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", height: 64 }}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Home */}
      <Link href="/">
        <button
          data-testid="nav-home"
          className={`flex flex-col items-center gap-0.5 px-4 py-2 transition-colors ${
            isHome ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isHome ? 2.2 : 1.75} strokeLinecap="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span className="text-[10px] font-medium tracking-wide">Home</span>
        </button>
      </Link>

      {/* Wardrobe */}
      <Link href="/wardrobe">
        <button
          data-testid="nav-wardrobe"
          className={`flex flex-col items-center gap-0.5 px-4 py-2 transition-colors ${
            isWardrobe ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isWardrobe ? 2.2 : 1.75} strokeLinecap="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <span className="text-[10px] font-medium tracking-wide">Wardrobe</span>
        </button>
      </Link>

      {/* FAB — Scan / Camera */}
      <Link href="/scan">
        <button
          data-testid="nav-scan"
          className="relative -top-5 w-14 h-14 rounded-full bg-foreground flex items-center justify-center shadow-lg hover:bg-foreground/90 transition-all active:scale-95"
          aria-label="Scan outfit"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </button>
      </Link>

      {/* History */}
      <Link href="/history">
        <button
          data-testid="nav-history"
          className={`flex flex-col items-center gap-0.5 px-4 py-2 transition-colors ${
            isHistory ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isHistory ? 2.2 : 1.75} strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span className="text-[10px] font-medium tracking-wide">History</span>
        </button>
      </Link>

      {/* Profile placeholder */}
      <button
        data-testid="nav-profile"
        className="flex flex-col items-center gap-0.5 px-4 py-2 text-muted-foreground"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        <span className="text-[10px] font-medium tracking-wide">Profile</span>
      </button>
    </nav>
  );
}
