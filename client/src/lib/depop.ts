// Aesthetics where Depop is a natural fit (thrift/resale/vintage energy)
export const DEPOP_AESTHETICS = new Set([
  "Y2K", "Indie", "Dark Academia", "Light Academia", "Grunge", "Cottagecore",
  "Vintage", "Retro", "Boho", "Indie Sleaze", "Punk", "E-Girl", "E-Boy",
  "Soft Girl", "Blokette", "Streetwear", "Hypebeast", "Skater", "Rave",
  "Romantic", "Whimsigoth", "Goblincore", "Fairycore", "Coastal", "Granola Girl",
]);

/**
 * Build a Depop search URL from an aesthetic + optional key pieces.
 * e.g. "Y2K" + ["low-rise jeans", "rhinestone top"] → searches "y2k low-rise jeans"
 */
export function depopUrl(aesthetic: string, keyPieces: string[] = []): string {
  // Use the first key piece as the search signal, fall back to aesthetic name
  const term = keyPieces.length > 0
    ? `${aesthetic} ${keyPieces[0]}`.toLowerCase()
    : aesthetic.toLowerCase();
  return `https://www.depop.com/search/?q=${encodeURIComponent(term)}&sort=relevance`;
}

export function isDepopAesthetic(aesthetic: string): boolean {
  return DEPOP_AESTHETICS.has(aesthetic);
}
