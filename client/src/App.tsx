import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useEffect } from "react";
import HomePage from "@/pages/home";
import ScanPage from "@/pages/scan";
import ResultsPage from "@/pages/results";
import WardrobePage from "@/pages/wardrobe";
import HistoryPage from "@/pages/history";
import ProfilePage from "@/pages/profile";
import DiscoverPage from "@/pages/discover";
import NavBar from "@/components/NavBar";
import { Link } from "wouter";

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

function TopBar() {
  return (
    <header className="sticky top-0 z-40 surface-glass">
      <div className="max-w-4xl mx-auto px-5 sm:px-8 h-12 sm:h-14 flex items-center justify-between">
        <Link href="/">
          <div className="flex items-center cursor-pointer" aria-label="Stitch home">
            {/* Stitch logo — Bebas Neue, diagonal slash as the I, ST up / TCH down */}
            {/* Canonical Stitch logo — viewBox="0 -2 67 35", font-size 30, tight equal gaps */}
            <svg viewBox="0 -2 67 35" width="100" height="52" xmlns="http://www.w3.org/2000/svg" aria-label="Stitch">
              <text x="0"  y="19" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">S</text>
              <text x="12" y="19" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">T</text>
              <line x1="25" y1="-1" x2="28" y2="33" stroke="#5088B8" strokeWidth="2.5" strokeLinecap="round"/>
              <text x="30" y="26" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">T</text>
              <text x="42" y="26" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">C</text>
              <text x="54" y="26" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">H</text>
            </svg>
          </div>
        </Link>
        <Link href="/profile">
          <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
            <ProfileInitial />
          </div>
        </Link>
      </div>
    </header>
  );
}

function AppContent() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <TopBar />
      <main className="flex-1 pb-20 sm:pb-24">
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/scan" component={ScanPage} />
          <Route path="/results/:id" component={ResultsPage} />
          <Route path="/wardrobe" component={WardrobePage} />
          <Route path="/history" component={HistoryPage} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="/discover" component={DiscoverPage} />
          <Route>
            <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Page not found</div>
          </Route>
        </Switch>
      </main>
      <NavBar />
    </div>
  );
}

export default function App() {
  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AppContent />
        <Toaster />
      </Router>
    </QueryClientProvider>
  );
}
