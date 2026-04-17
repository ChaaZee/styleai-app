import { useState, useEffect, lazy, Suspense } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronDown, ChevronUp, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getDeviceId } from "../lib/deviceId";

const MeasurementViewer3D = lazy(() => import("../components/MeasurementViewer3D"));

// ── Measurement guide data ──────────────────────────────────────────────────
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
};


// ── Measurement row ──────────────────────────────────────────────────────────
function MeasurementRow({
  id, label, value, unit, onChange, isActive, onFocus, onBlur,
}: {
  id: string; label: string; value: string; unit: string;
  onChange: (v: string) => void; isActive: boolean;
  onFocus: () => void; onBlur: () => void;
}) {
  const [open, setOpen] = useState(false);
  const guide = GUIDE[id];

  return (
    <div className={`rounded-xl border transition-all duration-200 ${isActive ? "border-primary bg-card" : "border-border bg-card"}`}>
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
              onFocus={onFocus}
              onBlur={onBlur}
              className="w-20 text-sm font-medium bg-transparent border-b border-border focus:border-primary outline-none py-0.5 text-foreground placeholder:text-muted-foreground/50 transition-colors"
            />
            <span className="text-xs text-muted-foreground">{unit}</span>
          </div>
        </div>
        {guide && (
          <button
            onClick={() => setOpen(o => !o)}
            className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
            aria-label="How to measure"
          >
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        )}
      </div>
      {open && guide && (
        <div className="px-4 pb-3 border-t border-border/60 pt-2.5">
          <p className="text-xs text-foreground mb-1">{guide.how}</p>
          <p className="text-[11px] text-primary font-medium">Tip: {guide.tip}</p>
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

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Load from localStorage on mount
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

      {/* Back */}
      <button onClick={() => setLocation("/")} className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm mb-5 transition-colors">
        <ChevronLeft size={16} /> Back
      </button>

      <h1 className="font-display text-3xl text-foreground mb-1">Your Profile</h1>
      <p className="text-xs text-muted-foreground mb-6">Measurements are stored on your device only.</p>

      {/* Name + gender */}
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

      {/* 3D Viewer */}
      <div className="mb-4">
        <Suspense fallback={
          <div className="w-full rounded-xl border border-border bg-muted flex items-center justify-center" style={{ height: 340 }}>
            <span className="text-xs text-muted-foreground">Loading 3D viewer…</span>
          </div>
        }>
          <MeasurementViewer3D activeField={activeField} gender={profile.gender as any || "male"} />
        </Suspense>
        <p className="text-[10px] text-center text-muted-foreground mt-1.5">Drag to rotate · Scroll to zoom</p>
      </div>

      {/* Measurements */}
      <div className="space-y-2 mb-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Upper Body</p>
          <MeasurementRow id="height" label="Height" value={profile.height} unit={unit} onChange={set("height")} isActive={activeField === "height"} onFocus={() => setActiveField("height")} onBlur={() => setActiveField(null)} />
          <MeasurementRow id="chest" label={showBust ? "Chest / Bust" : "Chest"} value={profile.chest} unit={unit} onChange={set("chest")} isActive={activeField === "chest"} onFocus={() => setActiveField("chest")} onBlur={() => setActiveField(null)} />
          {showBust && (
            <MeasurementRow id="bust" label="Bust (over bra)" value={profile.bust} unit={unit} onChange={set("bust")} isActive={activeField === "bust"} onFocus={() => setActiveField("bust")} onBlur={() => setActiveField(null)} />
          )}
          <MeasurementRow id="shoulders" label="Shoulder Width" value={profile.shoulders} unit={unit} onChange={set("shoulders")} isActive={activeField === "shoulders"} onFocus={() => setActiveField("shoulders")} onBlur={() => setActiveField(null)} />
          <MeasurementRow id="sleeve" label="Sleeve Length" value={profile.sleeve} unit={unit} onChange={set("sleeve")} isActive={activeField === "sleeve"} onFocus={() => setActiveField("sleeve")} onBlur={() => setActiveField(null)} />

          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">Core</p>
          <MeasurementRow id="waist" label="Waist" value={profile.waist} unit={unit} onChange={set("waist")} isActive={activeField === "waist"} onFocus={() => setActiveField("waist")} onBlur={() => setActiveField(null)} />
          <MeasurementRow id="hips" label="Hips" value={profile.hips} unit={unit} onChange={set("hips")} isActive={activeField === "hips"} onFocus={() => setActiveField("hips")} onBlur={() => setActiveField(null)} />

          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">Lower Body</p>
          <MeasurementRow id="inseam" label="Inseam" value={profile.inseam} unit={unit} onChange={set("inseam")} isActive={activeField === "inseam"} onFocus={() => setActiveField("inseam")} onBlur={() => setActiveField(null)} />
          <MeasurementRow id="thigh" label="Thigh" value={profile.thigh} unit={unit} onChange={set("thigh")} isActive={activeField === "thigh"} onFocus={() => setActiveField("thigh")} onBlur={() => setActiveField(null)} />

          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">General</p>
          <MeasurementRow id="weight" label="Weight" value={profile.weight} unit={unit === "in" ? "lbs" : "kg"} onChange={set("weight")} isActive={activeField === "weight"} onFocus={() => setActiveField("weight")} onBlur={() => setActiveField(null)} />
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${saved ? "bg-green-500 text-white" : "bg-primary text-white hover:bg-primary/90"}`}
      >
        {saved ? <><Check size={15} /> Saved</> : "Save Profile"}
      </button>
    </div>
  );
}
