# 2. Research: Finding New Data Sources

Use when I ask "find more fashion sites we could scrape" or "what other secondhand platforms exist".

### What to research
1. **Secondhand / resale platforms** — any site where individual sellers list clothing
   - Key question: does it have a public API or search endpoint?
   - Key question: does it ship to the US?
   - Examples to benchmark against: Depop, Grailed, Poshmark, Vinted, ThredUp, Mercari

2. **Brand Shopify stores** — independent fashion brands with public `/products.json`
   - Ideal: streetwear, minimalist, workwear, Y2K, vintage aesthetics
   - Already have: Civil Regime, MNML, Union LA, Carhartt WIP
   - Already know work: Volcom, Champion, RIPNDIP, Brixton, Cactus Plant Flea Market, Ksubi, Wax London

3. **Wholesale / fast fashion** — ASOS-style marketplaces with JSON APIs
   - Already have: ASOS, Pacsun
   - Candidates: SSENSE, Farfetch (luxury), Revolve, Urban Outfitters

### Research checklist for each candidate
- [ ] Shipping to US?
- [ ] Has a usable API or structured HTML?
- [ ] Can it be scraped without a paid account?
- [ ] Does it have a Shopify store? (test `site.com/products.json`)
- [ ] What aesthetics does it cover? (map to our 41-aesthetic taxonomy)
- [ ] Bot protection level? (None / basic / heavy Cloudflare / DataDome)
- [ ] Terms of service — does it prohibit scraping?

### Output format
Present findings as a table:
| Site | Type | API | Cookies needed | Aesthetics | Notes |
|------|------|-----|---------------|------------|-------|
