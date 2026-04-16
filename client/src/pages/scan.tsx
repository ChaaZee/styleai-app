import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Upload, Sparkles, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
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
        body: formData,
      });

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

  return (
    <div className="max-w-2xl mx-auto px-5 py-12 fade-up">

      {/* Header */}
      <div className="mb-10 text-center">
        <p className="text-xs font-medium tracking-[0.12em] uppercase text-primary mb-3">Visual Style Recognition</p>
        <h1 className="font-display text-5xl text-foreground mb-4 leading-[1.05]">
          Discover your<br /><em>aesthetic</em>
        </h1>
        <p className="text-muted-foreground text-sm max-w-xs mx-auto leading-relaxed">
          Upload any outfit — a Pinterest find, screenshot, or your own photo. StyleAI reads the visual language of the look.
        </p>
      </div>

      {/* Drop zone */}
      {uploadState === "idle" && (
        <div
          data-testid="upload-dropzone"
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`relative rounded-2xl p-14 text-center cursor-pointer transition-all duration-200
            border-2 border-dashed
            ${dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40 hover:bg-muted/40"
            }`}
        >
          <div className="flex flex-col items-center gap-5">
            {/* Upload icon container */}
            <div className="w-14 h-14 rounded-full border border-border bg-background flex items-center justify-center shadow-sm">
              <Upload size={20} className="text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div>
              <p className="font-medium text-foreground text-sm mb-1">Drop an outfit photo here</p>
              <p className="text-xs text-muted-foreground">or click to browse · JPG, PNG, WEBP up to 10MB</p>
            </div>
            {/* Suggestion pills */}
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
      )}

      {/* Preview + analyzing */}
      {(uploadState === "preview" || uploadState === "analyzing") && previewUrl && (
        <div className="fade-up">
          <div className="relative rounded-2xl overflow-hidden border border-border bg-muted/30">
            <img
              src={previewUrl}
              alt="Outfit preview"
              className="w-full max-h-[500px] object-contain"
              data-testid="img-preview"
            />
            {/* Analyzing overlay */}
            {uploadState === "analyzing" && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-5">
                {/* Thin spinner */}
                <div className="w-12 h-12 rounded-full border border-primary border-t-transparent animate-spin opacity-70" />
                <div className="text-center">
                  <p className="font-display text-2xl text-foreground mb-1">Reading the aesthetic…</p>
                  <p className="text-xs text-muted-foreground tracking-wide">Gemini is analysing silhouette, fabric & palette</p>
                </div>
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent scan-pulse" />
              </div>
            )}
            {/* Remove button */}
            {uploadState === "preview" && (
              <button
                onClick={handleReset}
                data-testid="button-reset"
                className="absolute top-3 right-3 w-7 h-7 rounded-full bg-background/90 border border-border flex items-center justify-center hover:bg-muted transition-colors"
              >
                <X size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>

          {uploadState === "preview" && (
            <div className="mt-4 flex gap-3">
              <Button
                variant="outline"
                onClick={handleReset}
                className="flex-1 h-11 border-border text-muted-foreground hover:text-foreground"
                data-testid="button-change"
              >
                <ImageIcon size={14} className="mr-2" strokeWidth={1.5} />
                Change photo
              </Button>
              <Button
                onClick={handleAnalyze}
                className="flex-1 h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-medium tracking-wide"
                data-testid="button-analyze"
              >
                <Sparkles size={14} className="mr-2" strokeWidth={1.5} />
                Analyse outfit
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Tips */}
      {uploadState === "idle" && (
        <div className="mt-8 grid grid-cols-3 gap-3">
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
      )}
    </div>
  );
}
