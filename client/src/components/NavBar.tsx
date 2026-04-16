import { Link, useLocation } from "wouter";
import { Camera, Shirt, Clock } from "lucide-react";

export default function NavBar() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", icon: Camera, label: "Scan" },
    { href: "/wardrobe", icon: Shirt, label: "Wardrobe" },
    { href: "/history", icon: Clock, label: "History" },
  ];

  return (
    <header className="sticky top-0 z-50 surface-glass">
      <div className="max-w-2xl mx-auto px-5 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/">
          <div className="flex items-center gap-2.5 cursor-pointer" data-testid="nav-logo">
            {/* Minimal geometric mark */}
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-label="StyleAI logo">
              <rect x="1" y="1" width="20" height="20" rx="5" stroke="hsl(24 42% 60%)" strokeWidth="1.2" fill="none"/>
              <path d="M6 13 C6 9.5 8.5 7.5 11 7.5 C13.5 7.5 16 9.5 16 13" stroke="hsl(24 42% 60%)" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
              <circle cx="11" cy="15.5" r="2" fill="hsl(24 42% 60%)"/>
            </svg>
            <span className="font-display text-[17px] tracking-[0.01em] text-foreground">StyleAI</span>
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-0.5" role="navigation" aria-label="Main navigation">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = location === href || (href !== "/" && location.startsWith(href));
            return (
              <Link key={href} href={href}>
                <button
                  data-testid={`nav-${label.toLowerCase()}`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-150 ${
                    isActive
                      ? "text-primary bg-primary/8 font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon size={14} strokeWidth={isActive ? 2 : 1.75} />
                  <span className="tracking-[0.01em]">{label}</span>
                </button>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
