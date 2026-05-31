import { useState } from "react";
import { createPortal } from "react-dom";

// ── Aesthetic config with outfit images ───────────────────────────────────────
const AESTHETICS = [
  {
    label: "Streetwear",
    vibe: "Hoodies, cargos, sneakers",
    icon: "👟",
    image: "https://png.pngtree.com/thumb_back/fw800/background/20260117/pngtree-urban-streetwear-look-with-hoodie-and-cargo-pants-in-graffiti-alley-image_21140560.webp",
  },
  {
    label: "Vintage",
    vibe: "Thrifted, retro, timeless",
    icon: "🧥",
    image: "https://sammydvintage.com/wp-content/uploads/70s-outfits-black-women.jpg",
  },
  {
    label: "Y2K",
    vibe: "Low-rise, butterfly clips, metallics",
    icon: "✨",
    image: "https://hips.hearstapps.com/hmg-prod/images/lead-image-hannah-outfit2-01-1662653778.jpg?crop=0.6669114946749908xw:1xh;center,top&resize=1200:*",
  },
  {
    label: "Grunge",
    vibe: "Band tees, flannels, boots",
    icon: "🎸",
    image: "https://styledmood.com/wp-content/uploads/2026/01/1-31-1024x683.webp",
  },
  {
    label: "Skater",
    vibe: "Skate brands, baggy denim, vans",
    icon: "🛹",
    image: "https://www.fashiongonerogue.com/wp-content/uploads/2023/10/Vans-Sneakers-Skater-Girl-Outfits.jpg",
  },
  {
    label: "Old Money",
    vibe: "Blazers, loafers, quiet luxury",
    icon: "🎩",
    image: "https://thevou.com/wp-content/uploads/2024/04/Old-Money-Aesthetic-Men-696x1044.jpg",
  },
  {
    label: "Preppy",
    vibe: "Polo shirts, plaid, clean cut",
    icon: "🧣",
    image: "https://www.stitchfix.com/men/blog/wp-content/uploads/2022/03/21-12-15_M_OF_V01_0689_2x3-683x1024.jpeg",
  },
  {
    label: "Boho",
    vibe: "Flowy, earthy, patterned",
    icon: "🌿",
    image: "https://d33y7pwkmheqpi.cloudfront.net/65c2e84552133f5aaff08435b6d713",
  },
  {
    label: "Dark Academia",
    vibe: "Tweed, turtlenecks, books",
    icon: "📚",
    image: "https://cdn.shopify.com/s/files/1/0726/0317/3201/files/31ae3d004a166f70f3ab5c96fab2cc8d_1000x.jpg",
  },
  {
    label: "Minimalist",
    vibe: "Clean lines, neutral palette",
    icon: "◻️",
    image: "https://images.unsplash.com/photo-1617922001439-4a2e6562f328?w=400&q=80",
  },
  {
    label: "Soft Girl",
    vibe: "Pastels, cozy, cute",
    icon: "🌸",
    image: "https://www.fashiongonerogue.com/wp-content/uploads/2024/08/Cable-Knit-Sweater-High-Waisted-Jeans-Soft-Girl.jpg",
  },
  {
    label: "Cottagecore",
    vibe: "Florals, linen, countryside",
    icon: "🌻",
    image: "https://editorialist.com/wp-content/uploads/2020/10/Cottage-Core_Hero.jpg",
  },
  {
    label: "Coquette",
    vibe: "Bows, pink, ultra-feminine",
    icon: "🎀",
    image: "https://www.lizzieinlace.com/wp-content/uploads/2024/05/8-soft-girl-aesthetic-outfits-1440x1218.jpg",
  },
  {
    label: "E-Girl",
    vibe: "Chains, stripes, egirl layering",
    icon: "⛓️",
    image: "https://www.fashiongonerogue.com/wp-content/uploads/2023/06/Long-Sleeve-T-Shirt-E-Girl-Aesthetic-elyas-pasban.jpg",
  },
  {
    label: "Techwear",
    vibe: "Tactical, black, utilitarian",
    icon: "🔧",
    image: "https://cdn.shopify.com/s/files/1/0647/4917/4993/files/techwear-cargo-pants-urban-outfit-waterproof-footwear.png",
  },
  {
    label: "Coastal Grandmother",
    vibe: "Linen, stripes, relaxed coastal",
    icon: "🌊",
    image: "https://www.stitchfix.com/women/blog/wp-content/uploads/2022/22-02-03_W_LOF_V15_0311_2x3-1-683x1024.jpeg",
  },
];

const FEMALE_ONLY_AESTHETICS = new Set([
  "Coquette", "Soft Girl", "Cottagecore", "Coastal Grandmother", "E-Girl",
]);

interface OnboardingModalProps {
  userId: string;
  onComplete: () => void;
  onClose: () => void;
}

type Step = "shuffle" | "picker";

export default function OnboardingModal({ userId, onComplete, onClose }: OnboardingModalProps) {
  const userGender = (() => {
    try { return (JSON.parse(localStorage.getItem("stitch_profile") || "{}") as any).gender || "both"; } catch { return "both"; }
  })();

  const visibleAesthetics = userGender === "male"
    ? AESTHETICS.filter(a => !FEMALE_ONLY_AESTHETICS.has(a.label))
    : AESTHETICS;

  // ── Step state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("shuffle");
  const [shuffleIndex, setShuffleIndex] = useState(0);
  const [liked, setLiked] = useState<Set<string>>(new Set());   // from shuffle
  const [selected, setSelected] = useState<Set<string>>(new Set()); // for picker
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // animate direction: "like" | "dislike" | null
  const [animDir, setAnimDir] = useState<"like" | "dislike" | null>(null);

  const currentCard = visibleAesthetics[shuffleIndex];
  const totalCards = visibleAesthetics.length;
  const progress = shuffleIndex / totalCards;

  // ── Shuffle handlers ──────────────────────────────────────────────────────
  const advanceShuffle = (isLike: boolean) => {
    setAnimDir(isLike ? "like" : "dislike");
    setTimeout(() => {
      setAnimDir(null);
      if (isLike && currentCard) {
        setLiked(prev => new Set([...prev, currentCard.label]));
      }
      const nextIndex = shuffleIndex + 1;
      if (nextIndex >= totalCards) {
        // Done — move to picker with liked items pre-selected (cap at 4)
        const preSelected = new Set([...liked, ...(isLike && currentCard ? [currentCard.label] : [])]);
        const capped = new Set([...preSelected].slice(0, 4));
        setSelected(capped);
        setStep("picker");
      } else {
        setShuffleIndex(nextIndex);
      }
    }, 280);
  };

  const skipShuffle = () => {
    setSelected(new Set());
    setStep("picker");
  };

  // ── Picker handlers ───────────────────────────────────────────────────────
  const toggle = (label: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        if (next.size >= 4) return prev;
        next.add(label);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          aesthetics: [...selected],
          gender: (() => {
            try { return (JSON.parse(localStorage.getItem("stitch_profile") || "{}") as any).gender || "both"; } catch { return "both"; }
          })(),
        }),
      });
      if (!res.ok) throw new Error("Failed to save preferences");
      onComplete();
    } catch {
      setError("Something went wrong. Try again.");
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const modal = (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
      {/* Backdrop */}
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
        onClick={undefined}
      />

      {/* Sheet */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "hsl(228 20% 8%)",
          maxHeight: "96dvh",
          borderTopLeftRadius: "1.5rem",
          borderTopRightRadius: "1.5rem",
          overflow: "hidden",
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {step === "shuffle" ? (
          // ── STEP 0: STYLE SHUFFLE ─────────────────────────────────────────
          <>
            {/* Header */}
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <div>
                <h2
                  className="text-2xl text-white"
                  style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 500 }}
                >
                  Style Shuffle
                </h2>
                <p
                  className="text-white/40 text-xs mt-0.5"
                  style={{ fontFamily: "'Jost', sans-serif", fontWeight: 300, letterSpacing: "0.05em" }}
                >
                  Like the looks you vibe with
                </p>
              </div>
              <button
                onClick={skipShuffle}
                className="text-white/35 text-xs hover:text-white/60 transition-colors"
                style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.06em" }}
              >
                Skip →
              </button>
            </div>

            {/* Progress bar */}
            <div className="px-5 pb-3">
              <div className="h-0.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#5088B8] rounded-full transition-all duration-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <p className="text-white/25 text-xs mt-1.5 text-right" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                {shuffleIndex + 1} / {totalCards}
              </p>
            </div>

            {/* Card image */}
            {currentCard && (
              <div className="flex-1 px-4 pb-2 flex flex-col min-h-0">
                <div
                  className="relative flex-1 rounded-3xl overflow-hidden"
                  style={{
                    transform: animDir === "like"
                      ? "translateX(120%) rotate(12deg)"
                      : animDir === "dislike"
                      ? "translateX(-120%) rotate(-12deg)"
                      : "translateX(0) rotate(0deg)",
                    transition: animDir ? "transform 0.28s ease-in" : "none",
                    minHeight: "280px",
                    maxHeight: "420px",
                  }}
                >
                  <img
                    src={currentCard.image}
                    alt={currentCard.label}
                    className="w-full h-full object-cover"
                    style={{ display: "block" }}
                  />
                  {/* Gradient overlay at bottom */}
                  <div
                    className="absolute inset-x-0 bottom-0 h-32"
                    style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)" }}
                  />
                  {/* Aesthetic label */}
                  <div className="absolute bottom-4 left-4 right-4">
                    <p
                      className="text-white text-xl"
                      style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 600 }}
                    >
                      {currentCard.icon} {currentCard.label}
                    </p>
                    <p
                      className="text-white/60 text-xs mt-0.5"
                      style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                      {currentCard.vibe}
                    </p>
                  </div>
                  {/* Like/dislike overlay hint */}
                  {animDir === "like" && (
                    <div className="absolute top-4 left-4 bg-[#5088B8] text-white text-sm font-bold px-3 py-1 rounded-full rotate-[-15deg]" style={{ fontFamily: "'Jost', sans-serif" }}>
                      LIKE ♥
                    </div>
                  )}
                  {animDir === "dislike" && (
                    <div className="absolute top-4 right-4 bg-red-500 text-white text-sm font-bold px-3 py-1 rounded-full rotate-[15deg]" style={{ fontFamily: "'Jost', sans-serif" }}>
                      NOPE ✕
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="px-6 pt-3 pb-7 flex gap-4">
              <button
                onClick={() => advanceShuffle(false)}
                disabled={!!animDir}
                className="flex-1 py-4 rounded-2xl border border-white/15 bg-white/5 flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <span className="text-2xl">✕</span>
                <span className="text-white/50 text-sm" style={{ fontFamily: "'Jost', sans-serif" }}>Nope</span>
              </button>
              <button
                onClick={() => advanceShuffle(true)}
                disabled={!!animDir}
                className="flex-1 py-4 rounded-2xl bg-[#5088B8] flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <span className="text-2xl">♥</span>
                <span className="text-white text-sm font-medium" style={{ fontFamily: "'Jost', sans-serif" }}>Like</span>
              </button>
            </div>
          </>
        ) : (
          // ── STEP 1: AESTHETIC PICKER ──────────────────────────────────────
          <>
            <div className="px-6 pt-6 pb-4 border-b border-white/10">
              <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5 sm:hidden" />
              <h2
                className="text-2xl text-white text-center"
                style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 500 }}
              >
                {selected.size > 0 ? "Confirm your vibes" : "What's your vibe?"}
              </h2>
              <p
                className="text-center text-white/50 text-sm mt-1"
                style={{ fontFamily: "'Jost', sans-serif", fontWeight: 300, letterSpacing: "0.06em" }}
              >
                {selected.size > 0
                  ? `${selected.size} picked from your shuffle · adjust below`
                  : "Pick up to 4 aesthetics · We'll tune your feed"}
              </p>
            </div>

            <div className="overflow-y-auto px-4 py-4" style={{ maxHeight: "calc(90vh - 200px)" }}>
              <div className="grid grid-cols-2 gap-2.5">
                {visibleAesthetics.map(({ label, vibe, icon }) => {
                  const active = selected.has(label);
                  return (
                    <button
                      key={label}
                      onClick={() => toggle(label)}
                      className={`relative text-left rounded-2xl px-4 py-3.5 transition-all duration-200 border ${
                        active
                          ? "border-[#5088B8] bg-[#5088B8]/15"
                          : "border-white/10 bg-white/5 hover:border-white/20"
                      }`}
                    >
                      {active && (
                        <div className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-[#5088B8] flex items-center justify-center">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        </div>
                      )}
                      <span className="text-xl block mb-1">{icon}</span>
                      <span
                        className="block text-sm text-white font-medium leading-tight"
                        style={{ fontFamily: "'Jost', sans-serif", fontWeight: 400 }}
                      >
                        {label}
                      </span>
                      <span
                        className="block text-xs text-white/40 mt-0.5 leading-snug"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                      >
                        {vibe}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-4 pt-3 pb-6 border-t border-white/10">
              {error && (
                <p className="text-red-400 text-xs text-center mb-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                  {error}
                </p>
              )}
              <button
                onClick={handleConfirm}
                disabled={selected.size === 0 || saving}
                className={`w-full py-3.5 rounded-2xl text-sm font-medium transition-all ${
                  selected.size === 0
                    ? "bg-white/10 text-white/30 cursor-not-allowed"
                    : "bg-[#5088B8] text-white hover:bg-[#5088B8]/90 active:scale-[0.98]"
                }`}
                style={{ fontFamily: "'Jost', sans-serif", letterSpacing: "0.08em" }}
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                    Building your feed…
                  </span>
                ) : selected.size === 0 ? (
                  "Select at least one"
                ) : (
                  `Build my feed  ·  ${selected.size} selected`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
