import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Shirt, Plus, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl gold-gradient">My Wardrobe</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{items.length} items tracked</p>
        </div>
        <Button
          onClick={() => setAdding(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          data-testid="button-add-item"
        >
          <Plus size={16} className="mr-2" />
          Add item
        </Button>
      </div>

      {/* Add item modal */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/70 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm fade-up">
            <h2 className="font-display text-xl mb-4">Add to Wardrobe</h2>

            {!addPreview ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors mb-4"
                data-testid="button-upload-photo"
              >
                <Upload size={20} className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Upload photo</p>
              </button>
            ) : (
              <div className="relative mb-4 rounded-xl overflow-hidden aspect-square">
                <img src={addPreview} alt="Item" className="w-full h-full object-cover" />
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

            <input
              placeholder="Item name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground mb-2 focus:outline-none focus:border-primary"
              data-testid="input-item-name"
            />
            <input
              placeholder="Brand (optional)"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground mb-2 focus:outline-none focus:border-primary"
              data-testid="input-item-brand"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground mb-4 focus:outline-none focus:border-primary"
              data-testid="select-category"
            >
              {CATEGORIES.filter(c => c !== "All").map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setAdding(false); setAddPreview(null); setAddFile(null); }}>Cancel</Button>
              <Button
                className="flex-1 bg-primary text-primary-foreground"
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending || !addFile || !name}
                data-testid="button-confirm-add"
              >
                {addMutation.isPending ? "Adding..." : "Add item"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5">
        {CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setActiveCategory(c)}
            data-testid={`filter-category-${c.toLowerCase()}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-all ${
              activeCategory === c
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground border border-border"
            }`}
          >
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="grid grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="aspect-square shimmer" />
              <div className="p-2"><div className="h-3 shimmer rounded w-3/4 mb-1" /><div className="h-3 shimmer rounded w-1/2" /></div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-20">
          <Shirt size={40} className="mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">
            {activeCategory === "All" ? "Your wardrobe is empty. Add your first item." : `No ${activeCategory} added yet.`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {filtered.map(item => (
          <div key={item.id} data-testid={`card-wardrobe-${item.id}`} className="rounded-xl bg-card border border-border overflow-hidden group">
            <div className="relative aspect-square overflow-hidden bg-muted">
              <img src={item.imageData} alt={item.name} className="w-full h-full object-cover" />
              <button
                onClick={() => deleteMutation.mutate(item.id)}
                data-testid={`button-delete-${item.id}`}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-background/80 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <div className="p-2">
              <p className="text-xs font-medium text-foreground truncate">{item.name}</p>
              {item.brand && <p className="text-xs text-muted-foreground truncate">{item.brand}</p>}
              <Badge variant="secondary" className="text-xs mt-1 px-1.5 py-0">{item.category}</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
