import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useEffect, useState, useRef } from "react";
import HomePage from "@/pages/home";
import ScanPage from "@/pages/scan";
import ResultsPage from "@/pages/results";
import WardrobePage from "@/pages/wardrobe";
import HistoryPage from "@/pages/history";
import ProfilePage from "@/pages/profile";
import DiscoverPage from "@/pages/discover";
import HowItWorksPage from "@/pages/howItWorks";
import StyleQuizPage from "@/pages/styleQuiz";
import NavBar from "@/components/NavBar";
import { Link } from "wouter";
import { useTheme } from "@/lib/useTheme";

function ProfileInitial() {
  try {
    const raw = localStorage.getItem("stitch_profile");
    if (raw) {
      const p = JSON.parse(raw);
      if (p.name) return <span className="text-xs font-semibold text-primary">{p.name[0].toUpperCase()}</span>;
    }
  } catch {}
  return <span className="text-xs font-medium text-muted-foreground">A</span>;
}

function TopBar({ theme, toggleTheme }: { theme: string; toggleTheme: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <header className="sticky top-0 z-40 surface-glass">
      <div className="max-w-4xl mx-auto px-5 sm:px-8 h-12 sm:h-14 flex items-center justify-between">
        <Link href="/">
          <div className="flex items-center cursor-pointer" aria-label="Stitch home">
            <svg viewBox="0 -9 67 41" width="100" height="58" xmlns="http://www.w3.org/2000/svg" aria-label="Stitch">
              <text x="0"  y="19" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">S</text>
              <text x="12" y="19" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">T</text>
              <line x1="25" y1="-7.97" x2="28.9" y2="31.04" stroke="#5088B8" strokeWidth="2.5" strokeLinecap="butt"/>
              <text x="30" y="22" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">T</text>
              <text x="42" y="22" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">C</text>
              <text x="54" y="22" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">H</text>
            </svg>
          </div>
        </Link>

        {/* Right side: menu + profile */}
        <div className="flex items-center gap-2">
          {/* Hamburger / menu button */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center hover:border-primary/50 transition-colors"
              aria-label="Menu"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>

            {/* Dropdown */}
            {menuOpen && (
              <div className="absolute right-0 top-10 w-52 rounded-xl border border-border bg-card shadow-lg overflow-hidden z-50">
                <Link href="/how-it-works" onClick={() => setMenuOpen(false)}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors cursor-pointer">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-primary flex-shrink-0">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M12 16v-4M12 8h.01"/>
                    </svg>
                    <span className="text-sm font-medium text-foreground">How It Works</span>
                  </div>
                </Link>
                <div className="border-t border-border"/>
                <a
                  href="https://www.amazon.com/s?k=fashion+clothing&tag=styleaiapp-20"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors cursor-pointer"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-primary flex-shrink-0">
                    <circle cx="9" cy="21" r="1"/>
                    <circle cx="20" cy="21" r="1"/>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                  </svg>
                  <span className="text-sm font-medium text-foreground">Shop on Amazon</span>
                </a>
                <div className="border-t border-border"/>
                <Link href="/profile" onClick={() => setMenuOpen(false)}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors cursor-pointer">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-primary flex-shrink-0">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                    <span className="text-sm font-medium text-foreground">Profile</span>
                  </div>
                </Link>
                <div className="border-t border-border"/>
                <button
                  onClick={() => { toggleTheme(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors cursor-pointer"
                >
                  {theme === "dark" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-primary flex-shrink-0">
                      <circle cx="12" cy="12" r="5"/>
                      <line x1="12" y1="1" x2="12" y2="3"/>
                      <line x1="12" y1="21" x2="12" y2="23"/>
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                      <line x1="1" y1="12" x2="3" y2="12"/>
                      <line x1="21" y1="12" x2="23" y2="12"/>
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-primary flex-shrink-0">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                    </svg>
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {theme === "dark" ? "Light Mode" : "Dark Mode"}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Profile avatar */}
          <Link href="/profile">
            <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
              <ProfileInitial />
            </div>
          </Link>
        </div>
      </div>
    </header>
  );
}

function AppContent() {
  // Redirect new users to style quiz on first visit
  const [showQuiz] = useState(() => !localStorage.getItem("stitch_quiz_done"));
  const [, setLocation] = useLocation();
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    if (showQuiz) setLocation("/quiz");
  }, [showQuiz, setLocation]);

  const [currentLocation] = useLocation();
  const isQuizRoute = currentLocation === "/quiz";
  const isDiscoverRoute = currentLocation.startsWith("/discover");

  return (
    <div className="bg-background text-foreground flex flex-col" style={{ height: "100dvh", overflow: "hidden" }}>
      {!isQuizRoute && <TopBar theme={theme} toggleTheme={toggleTheme} />}
      <main className={isQuizRoute ? "flex-1 overflow-auto" : isDiscoverRoute ? "flex-1 overflow-hidden" : "flex-1 overflow-auto pb-20 sm:pb-24"}>
        <Switch>
          <Route path="/quiz" component={StyleQuizPage} />
          <Route path="/" component={HomePage} />
          <Route path="/scan" component={ScanPage} />
          <Route path="/results/:id" component={ResultsPage} />
          <Route path="/wardrobe" component={WardrobePage} />
          <Route path="/history" component={HistoryPage} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="/discover" component={DiscoverPage} />
          <Route path="/how-it-works" component={HowItWorksPage} />
          <Route>
            <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Page not found</div>
          </Route>
        </Switch>
      </main>
      {!isQuizRoute && <NavBar />}
    </div>
  );
}

function LoadingScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // Ping the health endpoint — once it responds, start fade-out
    const start = Date.now();
    const minDisplay = 1200; // always show for at least 1.2s

    fetch("/api/health", { cache: "no-store" })
      .catch(() => {}) // ignore errors — just use the timer
      .finally(() => {
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, minDisplay - elapsed);
        setTimeout(() => {
          setFading(true);
          setTimeout(onDone, 500);
        }, remaining);
      });
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#5088B8",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: "24px",
        opacity: fading ? 0 : 1,
        transition: "opacity 0.5s ease",
        pointerEvents: fading ? "none" : "all",
      }}
    >
      {/* Stitch logo — white on blue */}
      <svg viewBox="0 -9 67 41" width="160" height="98" xmlns="http://www.w3.org/2000/svg" aria-label="Stitch">
        <text x="0"  y="19" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="white">S</text>
        <text x="12" y="19" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="white">T</text>
        <line x1="25" y1="-7.97" x2="28.9" y2="31.04" stroke="white" strokeWidth="2.5" strokeLinecap="butt"/>
        <text x="30" y="22" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="white">T</text>
        <text x="42" y="22" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="white">C</text>
        <text x="54" y="22" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="white">H</text>
      </svg>
      {/* Subtle pulse dots */}
      <div style={{ display: "flex", gap: "8px" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: "50%",
            background: "rgba(255,255,255,0.6)",
            animation: `stitch-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}/>
        ))}
      </div>
      <style>{`
        @keyframes stitch-pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);

  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        {loading && <LoadingScreen onDone={() => setLoading(false)} />}
        <AppContent />
        <Toaster />
      </Router>
    </QueryClientProvider>
  );
}
