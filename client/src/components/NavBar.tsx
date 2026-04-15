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
    <header className="sticky top-0 z-50 surface-glass border-b border-border">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer" data-testid="nav-logo">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="StyleAI logo">
              <rect x="2" y="2" width="24" height="24" rx="6" stroke="hsl(33 45% 60%)" strokeWidth="1.5"/>
              <path d="M8 14 C8 10 11 8 14 8 C17 8 20 10 20 14" stroke="hsl(33 45% 60%)" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              <circle cx="14" cy="17" r="3" fill="hsl(33 45% 60%)" opacity="0.8"/>
              <path d="M10 20 L14 14 L18 20" stroke="hsl(33 45% 60%)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5"/>
            </svg>
            <span className="font-display text-lg tracking-wide text-foreground">StyleAI</span>
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-1" role="navigation" aria-label="Main navigation">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = location === href || (href !== "/" && location.startsWith(href));
            return (
              <Link key={href} href={href}>
                <button
                  data-testid={`nav-${label.toLowerCase()}`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${
                    isActive
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
