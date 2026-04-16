import { useLocation } from "wouter";

const FEED_ITEMS = [
  { id: 1, brand: "& Other Stories", name: "Linen Blazer Dress", price: 149, match: true, height: 180, img: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=300&q=80", pos: "top center" },
  { id: 2, brand: "Mango", name: "Structured Tote", price: 79, match: false, height: 130, img: "https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=300&q=80", pos: "center" },
  { id: 3, brand: "Arket", name: "Cashmere Crew Neck", price: 195, match: false, height: 210, img: "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=300&q=80", pos: "top" },
  { id: 4, brand: "COS", name: "Wide Leg Trousers", price: 89, sale: "-30%", match: false, height: 160, img: "https://images.unsplash.com/photo-1544966503-7cc5ac882d5f?w=300&q=80", pos: "center" },
  { id: 5, brand: "New Balance", name: "990v6 Sneaker", price: 185, match: true, height: 145, img: "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=300&q=80", pos: "center" },
  { id: 6, brand: "Totême", name: "Silk Wrap Dress", price: 420, match: false, height: 195, img: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=300&q=80", pos: "top" },
];

const COMPLETE_LOOK = [
  { name: "Linen Trousers", price: 68, img: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=240&q=80" },
  { name: "White Sneakers", price: 112, img: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=240&q=80" },
  { name: "Tote Bag", price: 89, img: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=240&q=80" },
  { name: "Linen Scarf", price: 45, img: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=240&q=80" },
];

const CHIPS = ["For You", "Minimal", "Coastal", "Dark Acad.", "Streetwear", "Trending"];

export default function HomePage() {
  const [, setLocation] = useLocation();

  return (
    <div className="max-w-2xl mx-auto fade-up">
      {/* Greeting */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Good morning</p>
          <h1 className="font-display text-2xl text-foreground leading-tight">Your Feed</h1>
        </div>
      </div>

      {/* Aesthetic chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-5 pb-3">
        {CHIPS.map((c, i) => (
          <button
            key={c}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all ${
              i === 0
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground border border-border hover:text-foreground"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Complete Your Look */}
      <div className="px-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-foreground">Complete Your Look</span>
          <span className="text-xs text-primary underline underline-offset-2 cursor-pointer">See all</span>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1">
          {COMPLETE_LOOK.map((item) => (
            <div key={item.name} className="flex-shrink-0 w-28 rounded-xl border border-border bg-card overflow-hidden">
              <div
                className="h-32 bg-muted bg-cover bg-center"
                style={{ backgroundImage: `url('${item.img}')` }}
              />
              <div className="p-2">
                <p className="text-xs font-semibold text-primary">${item.price}</p>
                <p className="text-[10px] text-muted-foreground truncate">{item.name}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* For You header */}
      <div className="px-5 flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-foreground">For You</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">↑ 24 new</span>
      </div>

      {/* Masonry grid — 2 columns */}
      <div className="px-5 columns-2 gap-3 space-y-0">
        {FEED_ITEMS.map((item) => (
          <div
            key={item.id}
            className="break-inside-avoid mb-3 rounded-xl border border-border bg-card overflow-hidden relative hover:border-primary/30 transition-colors cursor-pointer"
            onClick={() => setLocation("/")}
          >
            {item.match && (
              <div className="absolute top-2 left-2 z-10 text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">Match</div>
            )}
            {item.sale && (
              <div className="absolute top-2 left-2 z-10 text-[10px] px-2 py-0.5 rounded-full bg-foreground text-background font-medium">{item.sale}</div>
            )}
            <div
              className="w-full bg-muted bg-cover"
              style={{
                height: item.height,
                backgroundImage: `url('${item.img}')`,
                backgroundPosition: item.pos,
              }}
            />
            <div className="p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">{item.brand}</p>
              <p className="text-xs text-foreground font-medium leading-snug mb-1.5">{item.name}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">${item.price}</span>
                <button className="text-muted-foreground hover:text-primary transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={item.match ? "hsl(24 42% 60%)" : "none"} stroke="currentColor" strokeWidth="1.75">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
