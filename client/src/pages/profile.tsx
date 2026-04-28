import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronDown, ChevronUp, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Measurement SVG diagrams ─────────────────────────────────────────────────
// Each diagram is a focused illustration on a simple body silhouette
// Accent colour matches Stitch primary: hsl(24 42% 60%) = #C8956A

const C = "#C8956A";   // accent / tape
const B = "#E8DDD4";   // body fill
const S = "#C4B8AC";   // body stroke

// Shared body silhouette paths (front view, 100×220 viewBox)
// We render different highlights on top depending on the measurement

function BodyBase({ arms = "down" }: { arms?: "down" | "out" }) {
  return (
    <>
      {/* Head */}
      <ellipse cx="50" cy="22" rx="12" ry="14" fill={B} stroke={S} strokeWidth="1.2" />
      {/* Neck */}
      <rect x="45" y="34" width="10" height="8" rx="2" fill={B} stroke={S} strokeWidth="1.2" />
      {/* Torso */}
      <path d="M28 42 Q22 58 24 80 Q25 100 28 112 L72 112 Q75 100 76 80 Q78 58 72 42 Q62 38 50 38 Q38 38 28 42Z"
        fill={B} stroke={S} strokeWidth="1.2" />
      {arms === "down" ? (
        <>
          {/* Arms down */}
          <path d="M28 44 Q18 52 16 70 Q14 84 16 96" fill="none" stroke={S} strokeWidth="8" strokeLinecap="round" />
          <path d="M72 44 Q82 52 84 70 Q86 84 84 96" fill="none" stroke={S} strokeWidth="8" strokeLinecap="round" />
          {/* Hands */}
          <ellipse cx="16" cy="100" rx="5" ry="6" fill={B} stroke={S} strokeWidth="1" />
          <ellipse cx="84" cy="100" rx="5" ry="6" fill={B} stroke={S} strokeWidth="1" />
        </>
      ) : (
        <>
          {/* Arms out (T-pose) */}
          <path d="M28 46 Q14 46 4 46" fill="none" stroke={S} strokeWidth="8" strokeLinecap="round" />
          <path d="M72 46 Q86 46 96 46" fill="none" stroke={S} strokeWidth="8" strokeLinecap="round" />
          <ellipse cx="3" cy="46" rx="5" ry="6" fill={B} stroke={S} strokeWidth="1" />
          <ellipse cx="97" cy="46" rx="5" ry="6" fill={B} stroke={S} strokeWidth="1" />
        </>
      )}
      {/* Legs */}
      <path d="M36 112 Q33 140 32 168 Q31 182 34 192" fill="none" stroke={S} strokeWidth="10" strokeLinecap="round" />
      <path d="M64 112 Q67 140 68 168 Q69 182 66 192" fill="none" stroke={S} strokeWidth="10" strokeLinecap="round" />
      {/* Feet */}
      <ellipse cx="34" cy="195" rx="7" ry="4" fill={B} stroke={S} strokeWidth="1" />
      <ellipse cx="66" cy="195" rx="7" ry="4" fill={B} stroke={S} strokeWidth="1" />
    </>
  );
}

const DIAGRAMS: Record<string, JSX.Element> = {
  height: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase />
      {/* Vertical line left side with arrows */}
      <line x1="8" y1="6" x2="8" y2="198" stroke={C} strokeWidth="1.5" />
      <polygon points="8,2 5,9 11,9" fill={C} />
      <polygon points="8,202 5,195 11,195" fill={C} />
      {/* Tick at top of head */}
      <line x1="4" y1="8" x2="12" y2="8" stroke={C} strokeWidth="1.5" />
      {/* Tick at floor */}
      <line x1="4" y1="198" x2="12" y2="198" stroke={C} strokeWidth="1.5" />
    </svg>
  ),

  chest: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase arms="out" />
      {/* Horizontal tape loop around chest */}
      <ellipse cx="50" cy="54" rx="26" ry="6" fill="none" stroke={C} strokeWidth="2" strokeDasharray="none" />
      {/* Dashed back half */}
      <ellipse cx="50" cy="54" rx="26" ry="6" fill="none" stroke={C} strokeWidth="2" strokeDasharray="3 2" opacity="0.4" />
    </svg>
  ),

  bust: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase arms="out" />
      {/* Tape loop at bust line — slightly lower and wider than chest */}
      <ellipse cx="50" cy="62" rx="27" ry="6" fill="none" stroke={C} strokeWidth="2" />
      <ellipse cx="50" cy="62" rx="27" ry="6" fill="none" stroke={C} strokeWidth="2" strokeDasharray="3 2" opacity="0.4" />
    </svg>
  ),

  waist: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase />
      {/* Waist tape — pinched in */}
      <ellipse cx="50" cy="80" rx="22" ry="5" fill="none" stroke={C} strokeWidth="2" />
      <ellipse cx="50" cy="80" rx="22" ry="5" fill="none" stroke={C} strokeWidth="2" strokeDasharray="3 2" opacity="0.4" />
    </svg>
  ),

  hips: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase />
      {/* Hip tape — wider, lower */}
      <ellipse cx="50" cy="100" rx="26" ry="6" fill="none" stroke={C} strokeWidth="2" />
      <ellipse cx="50" cy="100" rx="26" ry="6" fill="none" stroke={C} strokeWidth="2" strokeDasharray="3 2" opacity="0.4" />
    </svg>
  ),

  shoulders: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase arms="out" />
      {/* Shoulder-to-shoulder line across top of back */}
      <line x1="28" y1="44" x2="72" y2="44" stroke={C} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="28" cy="44" r="3" fill={C} />
      <circle cx="72" cy="44" r="3" fill={C} />
    </svg>
  ),

  sleeve: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase arms="out" />
      {/* Sleeve length line: shoulder to wrist (left arm) */}
      <line x1="28" y1="46" x2="4" y2="46" stroke={C} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="28" cy="46" r="3" fill={C} />
      <circle cx="4" cy="46" r="3" fill={C} />
      {/* Vertical tick at wrist */}
      <line x1="4" y1="42" x2="4" y2="50" stroke={C} strokeWidth="1.5" />
    </svg>
  ),

  inseam: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase />
      {/* Inseam line: crotch to floor (inside left leg) */}
      <line x1="46" y1="115" x2="34" y2="196" stroke={C} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="46" cy="115" r="3" fill={C} />
      <circle cx="34" cy="196" r="3" fill={C} />
    </svg>
  ),

  thigh: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase />
      {/* Thigh tape loop around upper left thigh */}
      <ellipse cx="36" cy="130" rx="11" ry="4" fill="none" stroke={C} strokeWidth="2" />
      <ellipse cx="36" cy="130" rx="11" ry="4" fill="none" stroke={C} strokeWidth="2" strokeDasharray="3 2" opacity="0.4" />
    </svg>
  ),

  weight: (
    <svg viewBox="0 0 100 220" className="w-full h-full">
      <BodyBase />
      {/* Scale icon at feet */}
      <rect x="30" y="200" width="40" height="14" rx="4" fill="none" stroke={C} strokeWidth="1.5" />
      <line x1="50" y1="196" x2="50" y2="200" stroke={C} strokeWidth="1.5" />
      <circle cx="50" cy="207" r="2" fill={C} />
    </svg>
  ),
};

// ── Measurement guide text ───────────────────────────────────────────────────
const GUIDE: Record<string, { how: string; tip: string }> = {
  height:    { how: "Stand barefoot against a wall. Measure from the floor to the top of your head.", tip: "Keep your chin level and heels flat on the floor." },
  chest:     { how: "Wrap the tape around the fullest part of your chest, just under your arms.", tip: "Keep your arms relaxed at your sides. Don't flex." },
  bust:      { how: "Wrap the tape around the fullest part of your bust, over your bra.", tip: "Keep the tape parallel to the floor and snug but not tight." },
  waist:     { how: "Measure around the narrowest part of your torso, just above your belly button.", tip: "Try bending sideways — the crease is your natural waist." },
  hips:      { how: "Measure around the fullest part of your hips and seat.", tip: "Stand with feet together. Keep tape parallel to the floor." },
  shoulders: { how: "Measure from one shoulder seam to the other across your upper back.", tip: "Stand naturally. Don't roll your shoulders forward or back." },
  sleeve:    { how: "From the shoulder seam, down over a bent elbow to the wrist bone.", tip: "Keep arm slightly bent for the most accurate fit." },
  inseam:    { how: "From the top of your inner thigh down to the floor.", tip: "Measure against a pair of well-fitting trousers for accuracy." },
  thigh:     { how: "Measure around the fullest part of your upper thigh.", tip: "Keep the tape parallel to the floor and snug but not tight." },
  weight:    { how: "Weigh yourself on a flat surface in the morning before eating.", tip: "Consistent conditions give the most reliable reading." },
};

// ── Measurement row ──────────────────────────────────────────────────────────
function MeasurementRow({
  id, label, value, unit, onChange,
}: {
  id: string; label: string; value: string; unit: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const guide = GUIDE[id];
  const diagram = DIAGRAMS[id];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden transition-all duration-200">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              placeholder="—"
              value={value}
              onChange={e => onChange(e.target.value)}
              className="w-20 text-sm font-medium bg-transparent border-b border-border focus:border-primary outline-none py-0.5 text-foreground placeholder:text-muted-foreground/50 transition-colors"
            />
            <span className="text-xs text-muted-foreground">{unit}</span>
          </div>
        </div>
        {guide && (
          <button
            onClick={() => setOpen(o => !o)}
            className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0 p-1"
            aria-label="How to measure"
          >
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        )}
      </div>

      {open && guide && (
        <div className="border-t border-border/60 flex gap-0">
          {/* Diagram */}
          {diagram && (
            <div className="w-24 flex-shrink-0 bg-muted/40 flex items-center justify-center p-3">
              <div className="w-16 h-28">
                {diagram}
              </div>
            </div>
          )}
          {/* Text */}
          <div className="flex-1 px-4 py-3">
            <p className="text-xs text-foreground mb-2 leading-relaxed">{guide.how}</p>
            <p className="text-[11px] text-primary font-medium leading-relaxed">Tip: {guide.tip}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main profile page ────────────────────────────────────────────────────────
const STORAGE_KEY = "stitch_profile";

interface Profile {
  name: string;
  unit: "in" | "cm";
  gender: string;
  height: string;
  chest: string;
  bust: string;
  waist: string;
  hips: string;
  shoulders: string;
  sleeve: string;
  inseam: string;
  thigh: string;
  weight: string;
}

const EMPTY: Profile = {
  name: "", unit: "in", gender: "",
  height: "", chest: "", bust: "", waist: "",
  hips: "", shoulders: "", sleeve: "", inseam: "", thigh: "", weight: "",
};

// ── Style DNA Section ────────────────────────────────────────────────────────
function StyleDNASection() {
  const [aesthetics, setAesthetics] = useState<string[]>([]);
  const [hasQuiz, setHasQuiz] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    try {
      const raw = localStorage.getItem("stitch_profile");
      if (raw) {
        const p = JSON.parse(raw);
        if (p.aesthetics?.length) {
          setAesthetics(p.aesthetics);
          setHasQuiz(true);
        }
      }
    } catch {}
  }, []);

  const retakeQuiz = () => {
    localStorage.removeItem("stitch_quiz_done");
    setLocation("/quiz");
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your Style DNA</p>
        <button
          onClick={retakeQuiz}
          className="text-xs text-primary hover:text-primary/80 transition-colors"
        >
          {hasQuiz ? "Retake" : "Take quiz"}
        </button>
      </div>
      {hasQuiz ? (
        <div className="flex flex-wrap gap-2">
          {aesthetics.map((a, i) => (
            <span
              key={a}
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                i === 0
                  ? "bg-primary text-white border-primary"
                  : "bg-primary/10 text-primary border-primary/30"
              }`}
            >
              {i === 0 && <span className="mr-1">✦</span>}{a}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Take the style quiz to discover your aesthetic.
        </p>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setProfile(JSON.parse(raw));
    } catch {}
  }, []);

  const set = (key: keyof Profile) => (val: string) =>
    setProfile(p => ({ ...p, [key]: val }));

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    setSaved(true);
    toast({ title: "Profile saved" });
    setTimeout(() => setSaved(false), 2000);
  };

  const unit = profile.unit;
  const showBust = profile.gender === "female" || profile.gender === "";

  return (
    <div className="max-w-lg mx-auto px-5 sm:px-8 py-5">

      <button onClick={() => setLocation("/")} className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm mb-5 transition-colors">
        <ChevronLeft size={16} /> Back
      </button>

      <h1 className="font-display text-3xl text-foreground mb-1">Your Profile</h1>
      <p className="text-xs text-muted-foreground mb-6">Measurements are stored on your device only.</p>

      {/* Name + gender + units */}
      <div className="rounded-xl border border-border bg-card p-4 mb-4 space-y-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Name</p>
          <input
            type="text"
            placeholder="Your name"
            value={profile.name}
            onChange={e => set("name")(e.target.value)}
            className="w-full text-sm bg-transparent border-b border-border focus:border-primary outline-none py-1 text-foreground placeholder:text-muted-foreground/50 transition-colors"
          />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">I shop for</p>
          <div className="flex gap-2">
            {["male", "female", "both"].map(g => (
              <button
                key={g}
                onClick={() => set("gender")(g)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${profile.gender === g ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
              >
                {g === "male" ? "Menswear" : g === "female" ? "Womenswear" : "Both"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Units</p>
          <div className="flex gap-2">
            {(["in", "cm"] as const).map(u => (
              <button
                key={u}
                onClick={() => set("unit")(u)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${unit === u ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
              >
                {u === "in" ? "Inches" : "Centimetres"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Style DNA */}
      <StyleDNASection />

      {/* Measurements */}
      <div className="space-y-2 mb-4">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Upper Body</p>
        <MeasurementRow id="height"    label="Height"          value={profile.height}    unit={unit}              onChange={set("height")} />
        <MeasurementRow id="chest"     label={showBust ? "Chest / Bust" : "Chest"} value={profile.chest} unit={unit} onChange={set("chest")} />
        {showBust && (
          <MeasurementRow id="bust"    label="Bust (over bra)" value={profile.bust}      unit={unit}              onChange={set("bust")} />
        )}
        <MeasurementRow id="shoulders" label="Shoulder Width"  value={profile.shoulders} unit={unit}              onChange={set("shoulders")} />
        <MeasurementRow id="sleeve"    label="Sleeve Length"   value={profile.sleeve}    unit={unit}              onChange={set("sleeve")} />

        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">Core</p>
        <MeasurementRow id="waist"     label="Waist"           value={profile.waist}     unit={unit}              onChange={set("waist")} />
        <MeasurementRow id="hips"      label="Hips"            value={profile.hips}      unit={unit}              onChange={set("hips")} />

        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">Lower Body</p>
        <MeasurementRow id="inseam"    label="Inseam"          value={profile.inseam}    unit={unit}              onChange={set("inseam")} />
        <MeasurementRow id="thigh"     label="Thigh"           value={profile.thigh}     unit={unit}              onChange={set("thigh")} />

        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">General</p>
        <MeasurementRow id="weight"    label="Weight"          value={profile.weight}    unit={unit === "in" ? "lbs" : "kg"} onChange={set("weight")} />
      </div>

      <button
        onClick={handleSave}
        className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${saved ? "bg-green-500 text-white" : "bg-primary text-white hover:bg-primary/90"}`}
      >
        {saved ? <><Check size={15} /> Saved</> : "Save Profile"}
      </button>
    </div>
  );
}
