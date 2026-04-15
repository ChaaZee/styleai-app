import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Upload, Camera, Sparkles, X, Image as ImageIcon } from "lucide-react";
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
      // Invalidate history cache so new scan appears immediately
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
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-10 text-center">
        <h1 className="font-display text-4xl mb-3 gold-gradient">Scan Your Style</h1>
        <p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
          Upload any outfit photo — a Pinterest find, screenshot, or your own photo — and StyleAI will identify the aesthetic and find matching pieces.
        </p>
      </div>

      {uploadState === "idle" && (
        <div
          data-testid="upload-dropzone"
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all duration-200 fade-up
            ${dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Upload size={24} className="text-primary" />
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Drop an outfit photo here</p>
              <p className="text-sm text-muted-foreground">or click to browse · JPG, PNG, WEBP up to 10MB</p>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <div className="h-px w-12 bg-border" />
              <span className="text-xs text-muted-foreground">Try with</span>
              <div className="h-px w-12 bg-border" />
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {["Pinterest pin", "Instagram outfit", "Screenshot", "Your own photo"].map((s) => (
                <span key={s} className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border">{s}</span>
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

      {(uploadState === "preview" || uploadState === "analyzing") && previewUrl && (
        <div className="fade-up">
          <div className="relative rounded-2xl overflow-hidden bg-card border border-border">
            <img
              src={previewUrl}
              alt="Outfit preview"
              className="w-full max-h-[480px] object-contain"
              data-testid="img-preview"
            />
            {uploadState === "analyzing" && (
              <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                <div className="w-16 h-16 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <div className="text-center">
                  <p className="font-display text-xl mb-1">Analyzing aesthetic...</p>
                  <p className="text-sm text-muted-foreground">Gemini Flash is reading your outfit</p>
                </div>
                {/* Scan line effect */}
                <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent scan-pulse" />
              </div>
            )}
            {uploadState === "preview" && (
              <button
                onClick={handleReset}
                data-testid="button-reset"
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition-colors"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {uploadState === "preview" && (
            <div className="mt-4 flex gap-3">
              <Button
                variant="outline"
                onClick={handleReset}
                className="flex-1"
                data-testid="button-change"
              >
                <ImageIcon size={16} className="mr-2" />
                Change photo
              </Button>
              <Button
                onClick={handleAnalyze}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                data-testid="button-analyze"
              >
                <Sparkles size={16} className="mr-2" />
                Analyze outfit
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Tips */}
      {uploadState === "idle" && (
        <div className="mt-8 grid grid-cols-3 gap-3 fade-up">
          {[
            { icon: "🎯", title: "Full outfit", desc: "Head-to-toe shots work best" },
            { icon: "💡", title: "Good lighting", desc: "Clear, well-lit photos" },
            { icon: "🖼️", title: "Any source", desc: "Pinterest, Instagram, or your camera roll" },
          ].map((tip) => (
            <div key={tip.title} className="rounded-xl bg-card border border-border p-4 text-center">
              <div className="text-2xl mb-2">{tip.icon}</div>
              <p className="text-xs font-medium text-foreground mb-0.5">{tip.title}</p>
              <p className="text-xs text-muted-foreground leading-snug">{tip.desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
