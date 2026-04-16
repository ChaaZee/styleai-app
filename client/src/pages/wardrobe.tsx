import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Shirt, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      setAdding(false);
      setAddFile(null);
      setAddPreview(null);
      setName("");
      setBrand("");
      toast({ title: "Added to wardrobe" });
    },
    onError: (err: any) => toast({ title: "Failed to add", description: err.message, variant: "destructive" }),
  });

  const filtered = activeCategory === "All" ? items : items.filter(i => i.category === activeCategory);

  return (
    <div className="max-w-2xl mx-auto px-5 py-8 fade-up">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-xs font-medium tracking-[0.12em] uppercase text-primary mb-2">Your Collection</p>
          <h1 className="font-display text-4xl text-foreground">Wardrobe</h1>
          <p className="text-sm text-muted-foreground mt-1.5">{items.length} item{items.length !== 1 ? "s" : ""} tracked</p>
        </div>
        <Button
          onClick={() => setAdding(true)}
          className="bg-foreground text-background hover:bg-foreground/90 h-9 px-4 text-sm font-medium"
          data-testid="button-add-item"
        >
          <Plus size={14} strokeWidth={2} className="mr-1.5" />
          Add item
        </Button>
      </div>

      {/* Add item sheet */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm fade-up shadow-xl">
            <h2 className="font-display text-2xl text-foreground mb-5">Add to Wardrobe</h2>

            {/* Photo upload */}
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
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setAddFile(f); setAddPreview(URL.createObjectURL(f)); }
              }}
            />

            {/* Fields */}
            <div className="space-y-2 mb-4">
              <input
                placeholder="Item name *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                data-testid="input-item-name"
              />
              <input
                placeholder="Brand (optional)"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                data-testid="input-item-brand"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors"
                data-testid="select-category"
              >
                {CATEGORIES.filter(c => c !== "All").map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10 border-border text-muted-foreground"
                onClick={() => { setAdding(false); setAddPreview(null); setAddFile(null); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-10 bg-foreground text-background hover:bg-foreground/90"
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending || !addFile || !name}
                data-testid="button-confirm-add"
              >
                {addMutation.isPending ? "Adding…" : "Add item"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-6 no-scrollbar">
        {CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setActiveCategory(c)}
            data-testid={`filter-category-${c.toLowerCase()}`}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all duration-150 ${
              activeCategory === c
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground border border-border"
            }`}
          >
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      {/* Skeletons */}
      {isLoading && (
        <div className="grid grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="aspect-square shimmer" />
              <div className="p-2.5">
                <div className="h-3 shimmer rounded-full w-3/4 mb-1.5" />
                <div className="h-2.5 shimmer rounded-full w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-24">
          <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center mx-auto mb-4">
            <Shirt size={20} className="text-muted-foreground" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-muted-foreground">
            {activeCategory === "All" ? "Your wardrobe is empty." : `No ${activeCategory} added yet.`}
          </p>
          {activeCategory === "All" && (
            <button
              onClick={() => setAdding(true)}
              className="text-sm text-primary mt-2 underline underline-offset-2"
            >
              Add your first item
            </button>
          )}
        </div>
      )}

      {/* Item grid */}
      <div className="grid grid-cols-3 gap-3">
        {filtered.map((item, i) => (
          <div
            key={item.id}
            data-testid={`card-wardrobe-${item.id}`}
            style={{ animationDelay: `${i * 30}ms` }}
            className="rounded-xl border border-border bg-card overflow-hidden group fade-up hover:border-primary/30 transition-colors duration-150"
          >
            <div className="relative aspect-square overflow-hidden bg-muted">
              <img src={item.imageData} alt={item.name} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
              <button
                onClick={() => deleteMutation.mutate(item.id)}
                data-testid={`button-delete-${item.id}`}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-background/90 border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
              >
                <Trash2 size={11} strokeWidth={1.5} />
              </button>
            </div>
            <div className="p-2.5">
              <p className="text-xs font-medium text-foreground truncate">{item.name}</p>
              {item.brand && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{item.brand}</p>}
              <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-medium uppercase tracking-wide">
                {item.category}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
