// Cache listing prices arrive in many shapes depending on the scraper that
// wrote them: 25, "25", "$95.00", "£12.50", { priceAmount: "45.0" }.
// Calling .toFixed() on the string forms crashes React mid-render (black
// screen), so every price render must go through this helper.
export function formatPrice(price: unknown): string {
  if (price == null) return "";
  if (typeof price === "object") price = (price as any).priceAmount;
  const num = typeof price === "number" ? price : parseFloat(String(price).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return "";
  return `$${Math.round(num)}`;
}
