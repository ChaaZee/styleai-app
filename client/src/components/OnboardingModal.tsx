import { useState } from "react";

// ── Aesthetic tiles config ────────────────────────────────────────────────────
// Each tile has a label, a short vibe description, and a representative emoji / keyword
const AESTHETICS = [
  { label: "Streetwear",         vibe: "Hoodies, cargos, sneakers",         icon: "👟" },
  { label: "Vintage",            vibe: "Thrifted, retro, timeless",          icon: "🧥" },
  { label: "Y2K",                vibe: "Low-rise, butterfly clips, metallics",icon: "✨" },
  { label: "Grunge",             vibe: "Band tees, flannels, boots",         icon: "🎸" },
  { label: "Skater",             vibe: "Skate brands, baggy denim, vans",    icon: "🛹" },
  { label: "Old Money",          vibe: "Blazers, loafers, quiet luxury",     icon: "🎩" },
  { label: "Preppy",             vibe: "Polo shirts, plaid, clean cut",      icon: "🧣" },
  { label: "Boho",               vibe: "Flowy, earthy, patterned",           icon: "🌿" },
  { label: "Dark Academia",      vibe: "Tweed, turtlenecks, books",          icon: "📚" },
  { label: "Minimalist",         vibe: "Clean lines, neutral palette",       icon: "◻️" },
  { label: "Soft Girl",          vibe: "Pastels, cozy, cute",                icon: "🌸" },
  { label: "Cottagecore",        vibe: "Florals, linen, countryside",        icon: "🌻" },
  { label: "Coquette",           vibe: "Bows, pink, ultra-feminine",         icon: "🎀" },
  { label: "E-Girl",             vibe: "Chains, stripes, egirl layering",    icon: "⛓️" },
  { label: "Techwear",           vibe: "Tactical, black, utilitarian",       icon: "🔧" },
  { label: "Coastal Grandmother",vibe: "Linen, stripes, relaxed coastal",    icon: "🌊" },
];

interface OnboardingModalProps {
  userId: string;
  onComplete: () => void;
  onClose: () => void;
}

export default function OnboardingModal({ userId, onComplete, onClose }: OnboardingModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (label: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        if (next.size >= 4) return prev; // cap at 4
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
        body: JSON.stringify({ userId, aesthetics: [...selected] }),
      });
      if (!res.ok) throw new Error("Failed to save preferences");
      onComplete();
    } catch (e: any) {
      setError("Something went wrong. Try again.");
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
      {/* Backdrop */}
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
        onClick={selected.size > 0 ? undefined : onClose}
      />

      {/* Sheet — pinned to bottom edge of viewport */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "hsl(228 20% 10%)",
          maxHeight: "92dvh",
          borderTopLeftRadius: "1.5rem",
          borderTopRightRadius: "1.5rem",
          overflow: "hidden",
          zIndex: 10000,
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/10">
          <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5 sm:hidden" />
          <h2
            className="text-2xl text-white text-center"
            style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 500 }}
          >
            What's your vibe?
          </h2>
          <p
            className="text-center text-white/50 text-sm mt-1"
            style={{ fontFamily: "'Jost', sans-serif", fontWeight: 300, letterSpacing: "0.06em" }}
          >
            Pick up to 4 aesthetics · We'll tune your feed
          </p>
        </div>

        {/* Tiles — scrollable */}
        <div className="overflow-y-auto px-4 py-4" style={{ maxHeight: "calc(90vh - 200px)" }}>
          <div className="grid grid-cols-2 gap-2.5">
            {AESTHETICS.map(({ label, vibe, icon }) => {
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

        {/* Footer */}
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
      </div>
    </div>
  );
}
