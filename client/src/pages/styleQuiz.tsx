import { useState } from "react";
import { useLocation } from "wouter";
import { initVectorFromQuiz } from "@/lib/styleVector";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Option {
  id: string;
  label: string;
  emoji: string;
  tags: string[];
}

interface Question {
  id: string;
  question: string;
  subtitle?: string;
  multi?: boolean; // allow multiple selections
  options: Option[];
}

// ── Quiz questions ────────────────────────────────────────────────────────────
const QUESTIONS: Question[] = [
  {
    id: "vibe",
    question: "What's your overall vibe?",
    subtitle: "Pick the mood that feels most like you",
    options: [
      { id: "clean",   label: "Clean & Minimal",    emoji: "🤍", tags: ["Minimalist", "Clean Girl", "Old Money"] },
      { id: "bold",    label: "Bold & Streetwear",  emoji: "🔥", tags: ["Streetwear", "Hypebeast", "Y2K"] },
      { id: "soft",    label: "Soft & Romantic",    emoji: "🌸", tags: ["Romantic", "Cottagecore", "Boho"] },
      { id: "dark",    label: "Dark & Edgy",        emoji: "🖤", tags: ["Dark Academia", "Indie", "Grunge"] },
    ],
  },
  {
    id: "palette",
    question: "Pick your colour palette",
    subtitle: "What colours do you naturally reach for?",
    options: [
      { id: "neutral", label: "Neutrals",    emoji: "🤎", tags: ["Minimalist", "Old Money", "Clean Girl"] },
      { id: "earth",   label: "Earth tones", emoji: "🍂", tags: ["Boho", "Cottagecore", "Coastal"] },
      { id: "mono",    label: "Black & White", emoji: "🩶", tags: ["Minimalist", "Dark Academia", "Streetwear"] },
      { id: "bright",  label: "Bright & bold", emoji: "🌈", tags: ["Y2K", "Hypebeast", "Preppy"] },
    ],
  },
  {
    id: "piece",
    question: "What's your go-to piece?",
    subtitle: "The item you always come back to",
    options: [
      { id: "hoodie",  label: "Oversized hoodie",   emoji: "👕", tags: ["Streetwear", "Athleisure", "Hypebeast"] },
      { id: "blazer",  label: "Tailored blazer",    emoji: "🧥", tags: ["Old Money", "Business Casual", "Dark Academia"] },
      { id: "dress",   label: "Flowy dress",        emoji: "👗", tags: ["Romantic", "Cottagecore", "Boho"] },
      { id: "cargo",   label: "Cargo trousers",     emoji: "👖", tags: ["Streetwear", "Y2K", "Indie"] },
    ],
  },
  {
    id: "shop",
    question: "How do you shop?",
    subtitle: "Your go-to approach when building your wardrobe",
    options: [
      { id: "thrift",  label: "Thrift & vintage",   emoji: "♻️", tags: ["Indie", "Dark Academia", "Cottagecore", "Y2K"] },
      { id: "fast",    label: "Fast fashion finds",  emoji: "🛍️", tags: ["Y2K", "Clean Girl", "Streetwear"] },
      { id: "invest",  label: "Investment pieces",   emoji: "💎", tags: ["Old Money", "Minimalist", "Business Casual"] },
      { id: "mix",     label: "Mix of everything",   emoji: "🔀", tags: ["Coastal", "Romantic", "Preppy"] },
    ],
  },
  {
    id: "inspo",
    question: "Where do you get style inspo?",
    subtitle: "Pick what resonates most",
    options: [
      { id: "pinterest", label: "Pinterest boards",  emoji: "📌", tags: ["Cottagecore", "Romantic", "Minimalist"] },
      { id: "street",    label: "Street style",      emoji: "📸", tags: ["Streetwear", "Hypebeast", "Y2K"] },
      { id: "runway",    label: "Runway & editorials", emoji: "✨", tags: ["Old Money", "Dark Academia", "Business Casual"] },
      { id: "friends",   label: "Friends & community", emoji: "👯", tags: ["Clean Girl", "Preppy", "Coastal", "Athleisure"] },
    ],
  },
];

// ── Score aesthetics from answers ────────────────────────────────────────────
function scoreAesthetics(answers: Record<string, string[]>): string[] {
  const scores: Record<string, number> = {};
  for (const optionIds of Object.values(answers)) {
    for (const oid of optionIds) {
      for (const q of QUESTIONS) {
        const opt = q.options.find(o => o.id === oid);
        if (opt) {
          for (const tag of opt.tags) {
            scores[tag] = (scores[tag] || 0) + 1;
          }
        }
      }
    }
  }
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([aesthetic]) => aesthetic);
}

// ── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-1 flex-1 rounded-full transition-all duration-300"
          style={{ background: i <= current ? "hsl(var(--primary))" : "hsl(var(--border))" }}
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StyleQuizPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);

  const question = QUESTIONS[step];
  const isLast = step === QUESTIONS.length - 1;

  function toggleOption(id: string) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function handleNext() {
    if (selected.length === 0) return;
    const newAnswers = { ...answers, [question.id]: selected };
    setAnswers(newAnswers);

    if (isLast) {
      // Score and save
      const topAesthetics = scoreAesthetics(newAnswers);
      const existing = JSON.parse(localStorage.getItem("stitch_profile") || "{}");
      localStorage.setItem("stitch_profile", JSON.stringify({
        ...existing,
        aesthetics: topAesthetics,
        quizCompleted: true,
      }));
      localStorage.setItem("stitch_quiz_done", "1");
      // Seed the style preference vector from quiz results
      initVectorFromQuiz(topAesthetics);

      setLeaving(true);
      setTimeout(() => setLocation("/"), 400);
    } else {
      setLeaving(true);
      setTimeout(() => {
        setStep(s => s + 1);
        setSelected([]);
        setLeaving(false);
      }, 200);
    }
  }

  function handleSkip() {
    localStorage.setItem("stitch_quiz_done", "1");
    setLocation("/");
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="px-5 sm:px-8 pt-8 pb-2 max-w-lg mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <svg viewBox="0 -9 67 41" width="80" height="46" xmlns="http://www.w3.org/2000/svg">
              <text x="0"  y="19" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">S</text>
              <text x="12" y="19" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">T</text>
              <line x1="25" y1="-7.97" x2="28.9" y2="31.04" stroke="#5088B8" strokeWidth="2.5" strokeLinecap="butt"/>
              <text x="30" y="22" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">T</text>
              <text x="42" y="22" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">C</text>
              <text x="54" y="22" fontFamily="'Bebas Neue',sans-serif" fontSize="30" fill="#5088B8">H</text>
            </svg>
          </div>
          <button
            onClick={handleSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip
          </button>
        </div>

        <ProgressBar current={step} total={QUESTIONS.length} />

        {/* Question */}
        <div
          className="transition-opacity duration-200"
          style={{ opacity: leaving ? 0 : 1 }}
        >
          <p className="font-label text-[9px] text-primary mb-1">
            {step + 1} of {QUESTIONS.length}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl text-foreground mb-1 leading-tight">
            {question.question}
          </h1>
          {question.subtitle && (
            <p className="text-sm text-muted-foreground mb-6">{question.subtitle}</p>
          )}

          {/* Options grid */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            {question.options.map(opt => {
              const isSelected = selected.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => toggleOption(opt.id)}
                  className={`rounded-2xl border p-4 text-left transition-all duration-150 active:scale-[0.97] ${
                    isSelected
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="text-2xl mb-2">{opt.emoji}</div>
                  <p className={`text-sm font-semibold leading-tight ${isSelected ? "text-primary" : "text-foreground"}`}>
                    {opt.label}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Next button */}
          <button
            onClick={handleNext}
            disabled={selected.length === 0}
            className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 active:scale-[0.98]"
          >
            {isLast ? "See my style →" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
