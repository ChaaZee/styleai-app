import type { Express } from "express";
import type { Server } from "http";
import { storage, initDB } from "./storage";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import multer from "multer";

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Mock product results for MVP (replace with Skimlinks affiliate API)
function generateMockResults(aesthetic: string) {
  const aestheticProducts: Record<string, any[]> = {
    "Clean Minimal": [
      { id: 1, name: "Relaxed Linen Blazer", brand: "& Other Stories", price: 149, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 94, retailer: "& Other Stories", url: "#" },
      { id: 2, name: "Wide-Leg Tailored Trousers", brand: "Arket", price: 89, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 91, retailer: "Arket", url: "#" },
      { id: 3, name: "Mango Satin Slip Dress", brand: "Mango", price: 59, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 87, retailer: "Mango", url: "#" },
      { id: 4, name: "Structured Leather Tote", brand: "Toteme", price: 320, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 85, retailer: "Toteme", url: "#" },
    ],
    "Coastal": [
      { id: 1, name: "Linen Stripe Shirt", brand: "Faherty", price: 128, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 96, retailer: "Faherty", url: "#" },
      { id: 2, name: "Relaxed Chino Shorts", brand: "J.Crew", price: 79, image: "https://images.unsplash.com/photo-1565084888279-aca607ecce0c?w=400&q=80", match: 90, retailer: "J.Crew", url: "#" },
      { id: 3, name: "Canvas Slip-On Sneakers", brand: "Vans", price: 65, image: "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=400&q=80", match: 88, retailer: "Vans", url: "#" },
      { id: 4, name: "Woven Straw Hat", brand: "Lack of Color", price: 99, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 84, retailer: "Lack of Color", url: "#" },
    ],
    "Streetwear": [
      { id: 1, name: "Air Max 95 OG", brand: "Nike", price: 185, image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80", match: 97, retailer: "Nike", url: "#" },
      { id: 2, name: "Heavyweight Graphic Tee", brand: "Palace", price: 65, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&q=80", match: 93, retailer: "Palace", url: "#" },
      { id: 3, name: "Carpenter Jeans", brand: "Carhartt WIP", price: 110, image: "https://images.unsplash.com/photo-1542574621-e088a4464a9e?w=400&q=80", match: 89, retailer: "Carhartt WIP", url: "#" },
      { id: 4, name: "Puffer Jacket", brand: "The North Face", price: 229, image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&q=80", match: 86, retailer: "The North Face", url: "#" },
    ],
    "Cottagecore": [
      { id: 1, name: "Prairie Smock Dress", brand: "Anthropologie", price: 148, image: "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400&q=80", match: 95, retailer: "Anthropologie", url: "#" },
      { id: 2, name: "Crochet Cardigan", brand: "Free People", price: 128, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 91, retailer: "Free People", url: "#" },
      { id: 3, name: "Mary Jane Flats", brand: "Dr. Martens", price: 110, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 87, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "Wicker Basket Bag", brand: "Cult Gaia", price: 188, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&q=80", match: 83, retailer: "Cult Gaia", url: "#" },
    ],
    "Dark Academia": [
      { id: 1, name: "Plaid Wool Blazer", brand: "Polo Ralph Lauren", price: 349, image: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80", match: 96, retailer: "Polo Ralph Lauren", url: "#" },
      { id: 2, name: "High-Waist Pleated Trousers", brand: "COS", price: 119, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 92, retailer: "COS", url: "#" },
      { id: 3, name: "Oxford Brogues", brand: "Thursday Boot Co", price: 199, image: "https://images.unsplash.com/photo-1614252369475-531eba835eb1?w=400&q=80", match: 89, retailer: "Thursday", url: "#" },
      { id: 4, name: "Turtleneck Knit", brand: "Uniqlo", price: 49, image: "https://images.unsplash.com/photo-1608234808654-2a8875faa7fd?w=400&q=80", match: 85, retailer: "Uniqlo", url: "#" },
    ],
    "Y2K": [
      { id: 1, name: "Low-Rise Flare Jeans", brand: "Levi's", price: 98, image: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400&q=80", match: 95, retailer: "Levi's", url: "#" },
      { id: 2, name: "Crop Baby Tee", brand: "Urban Outfitters", price: 34, image: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=400&q=80", match: 92, retailer: "Urban Outfitters", url: "#" },
      { id: 3, name: "Platform Sneakers", brand: "Buffalo London", price: 139, image: "https://images.unsplash.com/photo-1597045566677-8cf032ed6634?w=400&q=80", match: 88, retailer: "Buffalo London", url: "#" },
      { id: 4, name: "Butterfly Hair Clips Set", brand: "ASOS", price: 12, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 84, retailer: "ASOS", url: "#" },
    ],
    "Bohemian": [
      { id: 1, name: "Tiered Maxi Skirt", brand: "Free People", price: 148, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 94, retailer: "Free People", url: "#" },
      { id: 2, name: "Embroidered Linen Blouse", brand: "Zara", price: 59, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80", match: 90, retailer: "Zara", url: "#" },
      { id: 3, name: "Suede Fringe Boots", brand: "Sam Edelman", price: 140, image: "https://images.unsplash.com/photo-1512374382149-233c42b6a83b?w=400&q=80", match: 87, retailer: "Sam Edelman", url: "#" },
      { id: 4, name: "Layered Gold Necklace", brand: "Anthropologie", price: 48, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 83, retailer: "Anthropologie", url: "#" },
    ],
    "Classic Prep": [
      { id: 1, name: "Cable-Knit Crewneck", brand: "J.Crew", price: 118, image: "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=400&q=80", match: 95, retailer: "J.Crew", url: "#" },
      { id: 2, name: "Slim Chino Pants", brand: "Banana Republic", price: 89, image: "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=400&q=80", match: 91, retailer: "Banana Republic", url: "#" },
      { id: 3, name: "Penny Loafers", brand: "G.H. Bass", price: 160, image: "https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=400&q=80", match: 88, retailer: "G.H. Bass", url: "#" },
      { id: 4, name: "Quilted Vest", brand: "Barbour", price: 149, image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400&q=80", match: 84, retailer: "Barbour", url: "#" },
    ],
    "Athleisure": [
      { id: 1, name: "Seamless Leggings", brand: "Lululemon", price: 98, image: "https://images.unsplash.com/photo-1506902455-a342f2b12d93?w=400&q=80", match: 96, retailer: "Lululemon", url: "#" },
      { id: 2, name: "Oversized Hoodie", brand: "Nike", price: 75, image: "https://images.unsplash.com/photo-1556821840-3a63f15732ce?w=400&q=80", match: 91, retailer: "Nike", url: "#" },
      { id: 3, name: "Court Low Sneakers", brand: "New Balance", price: 85, image: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=80", match: 88, retailer: "New Balance", url: "#" },
      { id: 4, name: "Mini Crossbody Bag", brand: "Adidas", price: 45, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 83, retailer: "Adidas", url: "#" },
    ],
    "Vintage": [
      { id: 1, name: "Washed Denim Jacket", brand: "Levi's", price: 98, image: "https://images.unsplash.com/photo-1523205771623-e0faa4d2813d?w=400&q=80", match: 94, retailer: "Levi's", url: "#" },
      { id: 2, name: "Floral Wrap Midi Dress", brand: "& Other Stories", price: 119, image: "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400&q=80", match: 90, retailer: "& Other Stories", url: "#" },
      { id: 3, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 180, image: "https://images.unsplash.com/photo-1605812860427-4024433a70fd?w=400&q=80", match: 87, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "90s Logo Cap", brand: "Tommy Hilfiger", price: 38, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 83, retailer: "Tommy Hilfiger", url: "#" },
    ],
  };

  return aestheticProducts[aesthetic] ?? [
    { id: 1, name: "Classic White Shirt", brand: "COS", price: 79, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 88, retailer: "COS", url: "#" },
    { id: 2, name: "Slim Fit Jeans", brand: "Levi's", price: 89, image: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400&q=80", match: 85, retailer: "Levi's", url: "#" },
    { id: 3, name: "Leather Derby Shoes", brand: "Thursday Boot Co", price: 149, image: "https://images.unsplash.com/photo-1614252369475-531eba835eb1?w=400&q=80", match: 82, retailer: "Thursday", url: "#" },
    { id: 4, name: "Canvas Tote", brand: "Baggu", price: 38, image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&q=80", match: 79, retailer: "Baggu", url: "#" },
  ];
}

// ─── Gemini response schema (structured output — no regex parsing needed) ───
const ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  description: "Fashion aesthetic analysis of an outfit image",
  properties: {
    reasoning: {
      type: SchemaType.STRING,
      description:
        "Step-by-step visual analysis BEFORE classification. Cover: " +
        "(1) all visible garments and accessories by name; " +
        "(2) silhouette — boxy, oversized, fitted, flowing, or structured; " +
        "(3) fabric texture — matte/shiny/textured, natural/synthetic; " +
        "(4) color palette — list dominant colors, note warm/cool/neutral tones; " +
        "(5) fit — how garments relate to the body (cropped, relaxed, tailored); " +
        "(6) layering — how many layers and how they interact; " +
        "(7) footwear and accessories signals; " +
        "(8) which aesthetic this evidence points to and why.",
    },
    visualSignals: {
      type: SchemaType.ARRAY,
      description:
        "Specific visual cues that support the aesthetic. Be concrete — not 'casual' but 'raw-hem denim jeans'. 3–6 signals.",
      items: { type: SchemaType.STRING },
    },
    evidenceStrength: {
      type: SchemaType.INTEGER,
      description:
        "Count of CLEAR, SPECIFIC signals supporting the primary aesthetic. " +
        "0–1: very weak; 2: moderate; 3–4: strong; 5: definitive.",
    },
    aesthetic: {
      type: SchemaType.STRING,
      enum: [
        "Clean Minimal",
        "Coastal",
        "Streetwear",
        "Cottagecore",
        "Dark Academia",
        "Y2K",
        "Bohemian",
        "Classic Prep",
        "Athleisure",
        "Vintage",
      ],
      description: "The dominant aesthetic category based on visual evidence.",
    },
    secondaryAesthetic: {
      type: SchemaType.STRING,
      nullable: true,
      description:
        "A secondary aesthetic if clearly and substantially present. Null if the outfit is predominantly one style.",
    },
    confidence: {
      type: SchemaType.INTEGER,
      description:
        "Confidence score 0–100, calibrated by evidenceStrength. " +
        "1–2 signals → 55–65; 3 signals → 65–75; 4 signals → 75–85; 5 signals → 85–95. " +
        "Subtract 8–12 if a secondary aesthetic is present. " +
        "Subtract 10–15 if the image is partial, blurry, or cropped. " +
        "Never exceed 95.",
    },
    styleBreakdown: {
      type: SchemaType.ARRAY,
      description: "Top 3 matching aesthetics with scores, ordered highest to lowest.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          label: { type: SchemaType.STRING },
          score: {
            type: SchemaType.INTEGER,
            description: "Score 0–100. Primary aesthetic gets the highest score.",
          },
        },
        required: ["label", "score"],
      },
    },
    occasions: {
      type: SchemaType.ARRAY,
      description: "2–3 occasions this outfit suits (e.g. 'Weekend brunch', 'Campus', 'Night out').",
      items: { type: SchemaType.STRING },
    },
    keyPieces: {
      type: SchemaType.ARRAY,
      description: "2–4 standout pieces by specific name (e.g. 'Oversized varsity jacket', 'Wide-brim felt hat').",
      items: { type: SchemaType.STRING },
    },
    colorPalette: {
      type: SchemaType.ARRAY,
      description: "2–4 dominant colors as hex codes derived from what is visually present.",
      items: { type: SchemaType.STRING },
    },
  },
  required: [
    "reasoning",
    "visualSignals",
    "evidenceStrength",
    "aesthetic",
    "confidence",
    "styleBreakdown",
    "occasions",
    "keyPieces",
    "colorPalette",
  ],
};

// ─── System instruction — style taxonomy + calibration rules ───
const SYSTEM_INSTRUCTION = `You are StyleAI, an expert fashion stylist specialising in aesthetic classification and visual outfit analysis.

STYLE TAXONOMY — definitions for the 10 supported aesthetics:
- Clean Minimal: Neutral palette (cream, white, sand, grey, black). Matte quality fabrics. Clean silhouettes. Zero ornamentation. Structured or deliberately relaxed.
- Coastal: Natural fibres (linen, cotton, chambray). Sandy/ocean colour palette. Relaxed fit. Nautical or beach-adjacent details (stripes, canvas shoes, straw accessories).
- Streetwear: Urban athletic. Oversized or boxy silhouettes. Graphic elements, logo presence. Tech/jersey/nylon fabrics. Sneaker culture. Caps, crossbody bags.
- Cottagecore: Romantic and rural. Floral or ditsy prints. Flowing or puffed sleeves. Natural fabrics (linen, crochet, cotton). Earthy or soft pastel palette. Vintage-inspired silhouettes.
- Dark Academia: Scholarly and moody. Rich dark tones (oxblood, forest, camel, navy). Tweed, wool, corduroy. Structured tailoring. Layering. Classic leather footwear (brogues, loafers).
- Y2K: Early 2000s revival. Low-rise bottoms. Baby tees and micro silhouettes. Metallics, brights, or bubblegum pastels. Platform shoes. Shiny or iridescent fabrics.
- Bohemian: Free-spirited and artisanal. Flowing fabrics, layered textiles. Earthy or jewel tones. Natural materials (linen, suede, crochet). Ethnic or floral prints. Artisan accessories.
- Classic Prep: Collegiate and polished. Crisp tailoring. Heritage patterns (plaid, argyle, stripe). Quality wool/cotton. Heritage brand signals. Clean and composed.
- Athleisure: Performance fabrics in non-gym contexts. Technical fabrics (spandex, polyester, mesh). Sneakers worn with non-athletic pieces. Streamlined and functional silhouette.
- Vintage: Decade-specific references (60s–90s). Washed or worn textures. Period-accurate silhouettes and prints. Retro colour stories.

CALIBRATION RULES:
- Complete the reasoning field fully before any classification field.
- Name specific visible items — not impressions or vibes.
- Base confidence ONLY on what is observable. Do not guess at hidden garments.
- If the image is partial, low-resolution, or ambiguous, lower confidence accordingly.
- If signals for two aesthetics are nearly equal, set confidence below 70 and populate secondaryAesthetic.
- Do not default to the most common category — classify from evidence only.`;

export async function registerRoutes(httpServer: Server, app: Express) {
  await initDB();

  // Analyze outfit image with Gemini Flash
  app.post("/api/analyze", upload.single("image"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No image provided" });

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Gemini API key not configured" });

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA as any,
          temperature: 0.0,
        },
      });

      const imageBase64 = file.buffer.toString("base64");
      const mimeType = file.mimetype as "image/jpeg" | "image/png" | "image/webp";

      const result = await model.generateContent([
        { inlineData: { data: imageBase64, mimeType } },
        "Analyze this outfit image thoroughly and classify its aesthetic style. " +
        "Follow your system instructions: examine silhouette, fabric, color, fit, layering, " +
        "and accessories carefully before arriving at a classification.",
      ]);

      const text = result.response.text();
      // With responseMimeType=application/json the output is always valid JSON,
      // but we keep a fallback regex strip for safety
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse Gemini response");

      const analysis = JSON.parse(jsonMatch[0]);
      const products = generateMockResults(analysis.aesthetic);
      const imageDataUrl = `data:${mimeType};base64,${imageBase64}`;

      const scan = await storage.createScan({
        imageData: imageDataUrl,
        aesthetic: analysis.aesthetic,
        confidence: analysis.confidence,
        styleBreakdown: JSON.stringify(analysis.styleBreakdown),
        occasions: JSON.stringify(analysis.occasions),
        keyPieces: JSON.stringify(analysis.keyPieces),
        colorPalette: JSON.stringify(analysis.colorPalette),
        results: JSON.stringify(products),
      });

      res.json({ scanId: scan.id });
    } catch (err: any) {
      console.error("Analyze error:", err);
      res.status(500).json({ error: err.message || "Analysis failed" });
    }
  });

  // Get all scans
  app.get("/api/scans", async (req, res) => {
    const allScans = await storage.getScans();
    res.json(allScans);
  });

  // Get single scan
  app.get("/api/scans/:id", async (req, res) => {
    const scan = await storage.getScan(Number(req.params.id));
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    res.json(scan);
  });

  // Get wardrobe
  app.get("/api/wardrobe", async (req, res) => {
    const items = await storage.getWardrobeItems();
    res.json(items);
  });

  // Add wardrobe item
  app.post("/api/wardrobe", upload.single("image"), async (req, res) => {
    try {
      const file = req.file;
      const { name, category, brand, color, aesthetic } = req.body;
      if (!file || !name || !category) return res.status(400).json({ error: "Missing required fields" });

      const imageData = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const item = await storage.createWardrobeItem({ name, category, brand, color, aesthetic, imageData, source: "manual" });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete wardrobe item
  app.delete("/api/wardrobe/:id", async (req, res) => {
    await storage.deleteWardrobeItem(Number(req.params.id));
    res.json({ ok: true });
  });
}
