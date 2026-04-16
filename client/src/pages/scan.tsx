import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Upload, Sparkles, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type UploadState = "idle" | "preview" | "analyzing" | "done";

export default function ScanPage() {
  const [, setLocation] = useLocation();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

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
      const response = await fetch("/api/analyze", { method: "POST", body: formData });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Analysis failed");
      }
      const data = await response.json();
      setUploadState("done");
      queryClient.invalidateQueries({ queryKey: ["/api/scans"] });
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
      <div className="max-w-2xl mx-auto px-5 py-6 fade-up">
        <div className="relative rounded-2xl overflow-hidden border border-border bg-muted/30">
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Outfit preview"
              className="w-full max-h-[520px] object-contain"
              data-testid="img-preview"
            />
          )}

          {/* Scan corners — matches camera mockup */}
          {uploadState === "analyzing" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/75 backdrop-blur-sm gap-5">
              {/* Scan frame */}
              <div className="relative w-52 h-52">
                {/* corners */}
                {[
                  "top-0 left-0 border-t-2 border-l-2 rounded-tl-lg",
                  "top-0 right-0 border-t-2 border-r-2 rounded-tr-lg",
                  "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                  "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
                ].map((cls, i) => (
                  <div key={i} className={`absolute w-6 h-6 border-primary ${cls}`} />
                ))}
                {/* scan line */}
                <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent scan-pulse" />
              </div>
              {/* Detected style pill — matches camera aesthetic-tag */}
              <div className="bg-background/90 border border-border rounded-xl px-4 py-3 text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Detecting Style</p>
                <p className="font-display text-lg text-foreground">Analysing aesthetic…</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Gemini is reading silhouette, fabric & palette</p>
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

  // ── IDLE STATE — camera-style upload ──────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-5 py-6 fade-up">
      {/* Camera viewfinder */}
      <div
        data-testid="upload-dropzone"
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`relative rounded-2xl overflow-hidden cursor-pointer transition-all bg-muted
          ${dragOver ? "ring-2 ring-primary" : ""}`}
        style={{ aspectRatio: "3/4", maxHeight: 480 }}
      >
        {/* Background image — placeholder */}
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&q=80')" }}
        />

        {/* Live tag */}
        <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-foreground/80 rounded-full px-3 py-1">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-bold tracking-widest text-background">READY</span>
        </div>

        {/* Scan frame */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-56 h-72">
            {[
              "top-0 left-0 border-t-2 border-l-2 rounded-tl-lg",
              "top-0 right-0 border-t-2 border-r-2 rounded-tr-lg",
              "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
              "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
            ].map((cls, i) => (
              <div key={i} className={`absolute w-6 h-6 border-primary/70 ${cls}`} />
            ))}
            <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
          </div>
        </div>

        {/* Hint */}
        <div className="absolute bottom-4 left-0 right-0 text-center">
          <p className="text-xs text-foreground/60 tracking-wide">Point at any outfit — street, screen, or camera roll</p>
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

      {/* Camera controls row — matches mockup exactly */}
      <div className="flex items-center justify-around mt-6 px-4">
        {/* Gallery button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-12 h-12 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>

        {/* Shutter — big upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          data-testid="button-shutter"
          className="w-16 h-16 rounded-full bg-foreground border-4 border-background shadow-lg flex items-center justify-center hover:bg-foreground/90 transition-all active:scale-95"
        >
          <div className="w-12 h-12 rounded-full border-2 border-background/30" />
        </button>

        {/* Upload icon */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-12 h-12 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <Upload size={20} strokeWidth={1.75} />
        </button>
      </div>

      {/* Source suggestions */}
      <div className="flex items-center gap-2 flex-wrap justify-center mt-5">
        {["Pinterest pin", "Instagram outfit", "Screenshot", "Your camera roll"].map((s) => (
          <span key={s} className="tag">{s}</span>
        ))}
      </div>
    </div>
  );
}
