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
import NavBar from "@/components/NavBar";
import { Link } from "wouter";

function TopBar() {
  return (
    <header className="sticky top-0 z-40 surface-glass">
      <div className="max-w-4xl mx-auto px-5 sm:px-8 h-12 sm:h-14 flex items-center justify-between">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-label="Stitch logo">
              <rect x="1" y="1" width="20" height="20" rx="5" stroke="hsl(24 42% 60%)" strokeWidth="1.2" fill="none"/>
              <path d="M6 13 C6 9.5 8.5 7.5 11 7.5 C13.5 7.5 16 9.5 16 13" stroke="hsl(24 42% 60%)" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
              <circle cx="11" cy="15.5" r="2" fill="hsl(24 42% 60%)"/>
            </svg>
            <span className="font-display text-[16px] tracking-[0.01em] text-foreground">Stitch</span>
          </div>
        </Link>
        <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center">
          <span className="text-xs font-medium text-muted-foreground">A</span>
        </div>
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
