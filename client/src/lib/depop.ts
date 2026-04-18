// Aesthetics where Depop is a natural fit (thrift/resale/vintage energy)
export const DEPOP_AESTHETICS = new Set([
  "Y2K", "Indie", "Dark Academia", "Light Academia", "Grunge", "Cottagecore",
  "Vintage", "Retro", "Boho", "Indie Sleaze", "Punk", "E-Girl", "E-Boy",
  "Soft Girl", "Blokette", "Streetwear", "Hypebeast", "Skater", "Rave",
  "Romantic", "Whimsigoth", "Goblincore", "Fairycore", "Coastal", "Granola Girl",
]);

/**
 * Strip brand names from a product string so search focuses on the garment type.
 * e.g. "Reformation Satin Slip Cami" → "satin slip cami"
 */
const KNOWN_BRANDS = [
  "reformation", "uniqlo", "zara", "cos", "asos", "arket", "toteme", "the row",
  "lululemon", "skims", "patagonia", "carhartt", "dickies", "vans", "thrasher",
  "nike", "adidas", "new balance", "on running", "arc'teryx", "salomon",
  "stone island", "c.p. company", "free people", "urban outfitters", "anthropologie",
  "j.crew", "banana republic", "brooks brothers", "barbour", "burberry", "lacoste",
  "miu miu", "polene", "grenson", "skagen", "varley", "slip", "mejuri",
  "completedworks", "house of cb", "stuart weitzman", "repetto", "jennifer behr",
  "princess polly", "eastpak", "cotopaxi", "veilance", "brunello cucinelli",
  "g.h. bass", "thursday boot co", "charlotte tilbury", "steve madden",
];

function stripBrand(productName: string): string {
  let name = productName.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    name = name.replace(brand, "").trim();
  }
  // Remove leading/trailing dashes or spaces
  return name.replace(/^[-\s]+|[-\s]+$/g, "").trim();
}

/**
 * Build a Depop search URL.
 * For product-level searches: strip the brand, keep the garment type + aesthetic.
 * Depop search works best with 2–3 broad aesthetic/garment keywords.
 * e.g. "Y2K" + "Reformation Satin Slip Cami" → "y2k satin slip cami"
 */
export function depopUrl(aesthetic: string, keyPieces: string[] = []): string {
  if (keyPieces.length === 0) {
    return `https://www.depop.com/search/?q=${encodeURIComponent(aesthetic.toLowerCase())}&sort=relevance`;
  }
  const garment = stripBrand(keyPieces[0]);
  // Combine aesthetic + garment type, keep it short (Depop rewards concise queries)
  const term = garment ? `${aesthetic.toLowerCase()} ${garment}` : aesthetic.toLowerCase();
  return `https://www.depop.com/search/?q=${encodeURIComponent(term)}&sort=relevance`;
}

export function isDepopAesthetic(aesthetic: string): boolean {
  return DEPOP_AESTHETICS.has(aesthetic);
}
