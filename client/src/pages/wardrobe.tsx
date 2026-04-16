import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Trash2, Upload, Sparkles } from "lucide-react";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import type { WardrobeItem } from "@shared/schema";

const CATEGORIES = ["All", "tops", "bottoms", "shoes", "outerwear", "accessories"];

export default function WardrobePage() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [adding, setAdding] = useState(false);
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addPreview, setAddPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("tops");
  const [brand, setBrand] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: items = [], isLoading } = useQuery<WardrobeItem[]>({
    queryKey: ["/api/wardrobe"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/wardrobe/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/wardrobe"] }),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!addFile || !name || !category) throw new Error("Missing fields");
      const formData = new FormData();
      formData.append("image", addFile);
      formData.append("name", name);
      formData.append("category", category);
      formData.append("brand", brand);
      const res = await fetch("/api/wardrobe", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Failed to add item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wardrobe"] });
      setAdding(false); setAddFile(null); setAddPreview(null); setName(""); setBrand("");
      toast({ title: "Added to wardrobe" });
    },
    onError: (err: any) => toast({ title: "Failed to add", description: err.message, variant: "destructive" }),
  });

  const filtered = activeCategory === "All" ? items : items.filter(i => i.category === activeCategory);

  // Estimate value — rough avg $80/item
  const estValue = items.length * 80;

  return (
    <div className="max-w-2xl mx-auto fade-up">

      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <h1 className="font-display text-3xl text-foreground mb-3">My Wardrobe</h1>
        {/* Stats row — matches mockup */}
        <div className="flex gap-6">
          <div>
            <p className="text-sm font-bold text-foreground">{items.length}</p>
            <p className="text-[10px] text-muted-foreground">Items</p>
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">0</p>
            <p className="text-[10px] text-muted-foreground">Outfits</p>
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">${estValue.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Est. value</p>
          </div>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-5 pb-3">
        {CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setActiveCategory(c)}
            data-testid={`filter-category-${c.toLowerCase()}`}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all ${
              activeCategory === c
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground border border-border hover:text-foreground"
            }`}
          >
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      {/* Wardrobe gap alert — only show when items exist */}
      {items.length > 3 && (
        <div className="mx-5 mb-4 rounded-xl bg-foreground p-4 flex gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Sparkles size={14} className="text-primary" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-xs font-semibold text-background mb-0.5">Wardrobe Insight</p>
            <p className="text-[10px] text-background/70 leading-snug">
              Based on your items, adding a versatile blazer would unlock {Math.floor(items.length * 0.6)} new outfit combinations.
            </p>
            <button className="text-[10px] text-primary mt-1 font-medium">Shop blazers →</button>
          </div>
        </div>
      )}

      {/* Section header */}
      <div className="px-5 flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-foreground">Recently Added</span>
        <button
          onClick={() => setAdding(true)}
          data-testid="button-add-item"
          className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center hover:bg-foreground/90 transition-colors"
        >
          <Plus size={15} className="text-background" strokeWidth={2.5} />
        </button>
      </div>

      {/* Skeletons */}
      {isLoading && (
        <div className="px-5 grid grid-cols-3 gap-2.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden aspect-square shimmer" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-20">
          <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center mx-auto mb-3">
            <Upload size={18} className="text-muted-foreground" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-muted-foreground">
            {activeCategory === "All" ? "Your wardrobe is empty." : `No ${activeCategory} yet.`}
          </p>
          {activeCategory === "All" && (
            <button onClick={() => setAdding(true)} className="text-sm text-primary mt-2 underline underline-offset-2">
              Add your first item
            </button>
          )}
        </div>
      )}

      {/* Image-only grid with overlay — matches mockup wardrobe-grid */}
      {!isLoading && (
        <div className="px-5 grid grid-cols-3 gap-2.5 pb-4">
          {filtered.map((item) => (
            <div
              key={item.id}
              data-testid={`card-wardrobe-${item.id}`}
              className="relative rounded-xl overflow-hidden aspect-square bg-muted group"
            >
              <img
                src={item.imageData}
                alt={item.name}
                className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
              />
              {/* Overlay — always visible like mockup */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <p className="text-[9px] font-semibold text-white leading-tight truncate">{item.name}</p>
                {item.brand && <p className="text-[9px] text-white/65 truncate">{item.brand}</p>}
              </div>
              {/* Delete on hover */}
              <button
                onClick={() => deleteMutation.mutate(item.id)}
                data-testid={`button-delete-${item.id}`}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-background/90 border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={10} strokeWidth={1.75} />
              </button>
            </div>
          ))}

          {/* Scan to add tile — matches wardrobe-add in mockup */}
          <button
            onClick={() => setAdding(true)}
            className="rounded-xl border-2 border-dashed border-border aspect-square flex flex-col items-center justify-center gap-1 hover:border-primary/50 hover:bg-muted/40 transition-all"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <span className="text-[9px] font-medium text-muted-foreground">Scan to add</span>
          </button>
        </div>
      )}

      {/* Add item modal */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm fade-up shadow-xl">
            <h2 className="font-display text-2xl text-foreground mb-5">Add to Wardrobe</h2>

            {!addPreview ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-xl p-10 text-center hover:border-primary/40 hover:bg-muted/30 transition-colors mb-4"
                data-testid="button-upload-photo"
              >
                <Upload size={18} className="mx-auto mb-2 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">Upload photo</p>
              </button>
            ) : (
              <div className="relative mb-4 rounded-xl overflow-hidden aspect-square shadow-sm">
                <img src={addPreview} alt="Item" className="w-full h-full object-cover" />
                <button
                  onClick={() => { setAddPreview(null); setAddFile(null); }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-background/90 border border-border flex items-center justify-center"
                >
                  <Plus size={12} className="rotate-45 text-foreground" />
                </button>
              </div>
            )}

            <input ref={fileRef} type="file" accept="image/*" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setAddFile(f); setAddPreview(URL.createObjectURL(f)); } }}
            />

            <div className="space-y-2 mb-4">
              <input placeholder="Item name *" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                data-testid="input-item-name"
              />
              <input placeholder="Brand (optional)" value={brand} onChange={(e) => setBrand(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                data-testid="input-item-brand"
              />
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors"
                data-testid="select-category"
              >
                {CATEGORIES.filter(c => c !== "All").map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setAdding(false); setAddPreview(null); setAddFile(null); }}
                className="flex-1 h-10 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending || !addFile || !name}
                data-testid="button-confirm-add"
                className="flex-1 h-10 rounded-xl bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                {addMutation.isPending ? "Adding…" : "Add item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
