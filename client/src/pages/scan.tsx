import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { Upload, Sparkles, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getDeviceId } from "../lib/deviceId";

type UploadState = "idle" | "preview" | "analyzing" | "done";

const ANALYSIS_STEPS = [
  { label: "Reading silhouette",   sub: "Mapping garment shapes & layers…" },
  { label: "Detecting fabrics",    sub: "Identifying textures and materials…" },
  { label: "Reading the palette",  sub: "Extracting colour story…" },
  { label: "Classifying aesthetic",sub: "Matching to style taxonomy…" },
  { label: "Building your profile",sub: "Scoring fit, occasion & vibe…" },
];

export default function ScanPage() {
  const [, setLocation] = useLocation();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    if (uploadState !== "analyzing") { setStepIdx(0); return; }
    const id = setInterval(() => setStepIdx(i => (i + 1) % ANALYSIS_STEPS.length), 2200);
    return () => clearInterval(id);
  }, [uploadState]);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image.", variant: "destructive" });
      return;
    }
    setPreviewUrl(URL.createObjectURL(file));
    setSelectedFile(file);
    setUploadState("preview");
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleAnalyze = async () => {
    if (!selectedFile) return;
    setUploadState("analyzing");
    try {
      const formData = new FormData();
      formData.append("image", selectedFile);
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "x-device-id": getDeviceId() },
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Analysis failed");
      }
      const data = await response.json();
      setUploadState("done");
      queryClient.invalidateQueries({ queryKey: ["/api/scans", getDeviceId()] });
      setLocation(`/results/${data.scanId}`);
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
      setUploadState("preview");
    }
  };

  const handleReset = () => {
    setUploadState("idle");
    setPreviewUrl(null);
    setSelectedFile(null);
  };

  // ── PREVIEW / ANALYZING STATE ──────────────────────────────────────────────
  if (uploadState === "preview" || uploadState === "analyzing") {
    return (
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-6 sm:py-10 fade-up">
        <div className="relative rounded-2xl overflow-hidden border border-border bg-muted/30">
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Outfit preview"
              className="w-full max-h-[520px] sm:max-h-[640px] object-contain"
              data-testid="img-preview"
            />
          )}

          {/* Analyzing overlay */}
          {uploadState === "analyzing" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm gap-6">
              {/* Scan frame with animated corners + sweep line */}
              <div className="relative w-56 h-56">
                {[
                  "top-0 left-0 border-t-2 border-l-2 rounded-tl-lg",
                  "top-0 right-0 border-t-2 border-r-2 rounded-tr-lg",
                  "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                  "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
                ].map((cls, i) => (
                  <div key={i} className={`absolute w-7 h-7 border-primary ${cls}`} />
                ))}
                {/* Animated sweep line */}
                <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent scan-pulse" />
                {/* Pulsing dot in center */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary animate-ping opacity-75" />
                </div>
              </div>

              {/* Step card — cycles through ANALYSIS_STEPS */}
              <div className="bg-background/95 border border-border rounded-2xl px-5 py-4 text-center shadow-lg min-w-[220px]">
                <p className="text-[10px] text-primary uppercase tracking-widest font-semibold mb-1">
                  Step {stepIdx + 1} of {ANALYSIS_STEPS.length}
                </p>
                <p className="font-display text-xl text-foreground leading-tight transition-all">
                  {ANALYSIS_STEPS[stepIdx].label}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {ANALYSIS_STEPS[stepIdx].sub}
                </p>
                {/* Progress dots */}
                <div className="flex justify-center gap-1.5 mt-3">
                  {ANALYSIS_STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={`rounded-full transition-all duration-300 ${
                        i === stepIdx
                          ? "w-4 h-1.5 bg-primary"
                          : i < stepIdx
                          ? "w-1.5 h-1.5 bg-primary/40"
                          : "w-1.5 h-1.5 bg-border"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Remove button */}
          {uploadState === "preview" && (
            <button
              onClick={handleReset}
              data-testid="button-reset"
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-background/90 border border-border flex items-center justify-center"
            >
              <X size={14} className="text-muted-foreground" />
            </button>
          )}
        </div>

        {uploadState === "preview" && (
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleReset}
              data-testid="button-change"
              className="flex-1 h-11 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Change photo
            </button>
            <button
              onClick={handleAnalyze}
              data-testid="button-analyze"
              className="flex-1 h-11 rounded-xl bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles size={14} strokeWidth={1.75} />
              Analyse outfit
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── IDLE STATE — clean drop zone ──────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-5 sm:px-8 py-12 sm:py-16 fade-up">

      {/* Header */}
      <div className="mb-10 text-center">
        <p className="text-xs font-medium tracking-[0.12em] uppercase text-primary mb-3">Visual Style Recognition</p>
        <h1 className="font-display text-5xl sm:text-6xl text-foreground mb-4 leading-[1.05]">
          Discover your<br /><em>aesthetic</em>
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base max-w-xs sm:max-w-sm mx-auto leading-relaxed">
          Upload any outfit — a Pinterest find, screenshot, or your own photo. Stitch reads the visual language of the look.
        </p>
      </div>

      {/* Drop zone */}
      <div
        data-testid="upload-dropzone"
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`relative rounded-2xl p-10 sm:p-16 text-center cursor-pointer transition-all duration-200
          border-2 border-dashed
          ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40 hover:bg-muted/40"
          }`}
      >
        <div className="flex flex-col items-center gap-5">
          <div className="w-14 h-14 rounded-full border border-border bg-background flex items-center justify-center shadow-sm">
            <Upload size={20} className="text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div>
            <p className="font-medium text-foreground text-sm mb-1">Drop an outfit photo here</p>
            <p className="text-xs text-muted-foreground">or click to browse · JPG, PNG, WEBP up to 10MB</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {["Pinterest pin", "Instagram outfit", "Screenshot", "Your own photo"].map((s) => (
              <span key={s} className="tag">{s}</span>
            ))}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          data-testid="input-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {/* Tips */}
      <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
        {[
          { title: "Full outfit", desc: "Head-to-toe shots give the best results" },
          { title: "Good light", desc: "Clear, evenly lit photos read better" },
          { title: "Any source", desc: "Pinterest, Instagram, camera roll" },
        ].map((tip) => (
          <div key={tip.title} className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-xs font-semibold text-foreground mb-1 tracking-wide uppercase">{tip.title}</p>
            <p className="text-xs text-muted-foreground leading-snug">{tip.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
