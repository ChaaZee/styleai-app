import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useEffect } from "react";
import ScanPage from "@/pages/scan";
import ResultsPage from "@/pages/results";
import WardrobePage from "@/pages/wardrobe";
import HistoryPage from "@/pages/history";
import NavBar from "@/components/NavBar";

function AppContent() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <NavBar />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={ScanPage} />
          <Route path="/results/:id" component={ResultsPage} />
          <Route path="/wardrobe" component={WardrobePage} />
          <Route path="/history" component={HistoryPage} />
          <Route>
            <div className="flex items-center justify-center h-64 text-muted-foreground">Page not found</div>
          </Route>
        </Switch>
      </main>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
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
