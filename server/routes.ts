import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { GoogleGenerativeAI } from "@google/generative-ai";
import multer from "multer";

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Mock product results for MVP (replace with real affiliate API later)
function generateMockResults(aesthetic: string, keyPieces: string[]) {
  const aestheticProducts: Record<string, any[]> = {
    "Clean Minimal": [
      { id: 1, name: "Relaxed Linen Blazer", brand: "& Other Stories", price: 149, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 94, retailer: "& Other Stories", url: "#", owned: false },
      { id: 2, name: "Wide-Leg Tailored Trousers", brand: "Arket", price: 89, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 91, retailer: "Arket", url: "#", owned: false },
      { id: 3, name: "Mango Satin Slip Dress", brand: "Mango", price: 59, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 87, retailer: "Mango", url: "#", owned: false },
      { id: 4, name: "Structured Leather Tote", brand: "Toteme", price: 320, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 85, retailer: "Toteme", url: "#", owned: false },
    ],
    "Coastal": [
      { id: 1, name: "Linen Stripe Shirt", brand: "Faherty", price: 128, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 96, retailer: "Faherty", url: "#", owned: false },
      { id: 2, name: "Relaxed Chino Shorts", brand: "J.Crew", price: 79, image: "https://images.unsplash.com/photo-1565084888279-aca607ecce0c?w=400&q=80", match: 90, retailer: "J.Crew", url: "#", owned: false },
      { id: 3, name: "Canvas Slip-On Sneakers", brand: "Vans", price: 65, image: "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=400&q=80", match: 88, retailer: "Vans", url: "#", owned: false },
      { id: 4, name: "Woven Straw Hat", brand: "Lack of Color", price: 99, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 84, retailer: "Lack of Color", url: "#", owned: false },
    ],
    "Streetwear": [
      { id: 1, name: "Air Max 95 OG", brand: "Nike", price: 185, image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80", match: 97, retailer: "Nike", url: "#", owned: false },
      { id: 2, name: "Heavyweight Graphic Tee", brand: "Palace", price: 65, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&q=80", match: 93, retailer: "Palace", url: "#", owned: false },
      { id: 3, name: "Carpenter Jeans", brand: "Carhartt WIP", price: 110, image: "https://images.unsplash.com/photo-1542574621-e088a4464a9e?w=400&q=80", match: 89, retailer: "Carhartt WIP", url: "#", owned: false },
      { id: 4, name: "Puffer Jacket", brand: "The North Face", price: 229, image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&q=80", match: 86, retailer: "The North Face", url: "#", owned: false },
    ],
  };

  // Default fallback
  const defaultProducts = [
    { id: 1, name: "Classic White Shirt", brand: "COS", price: 79, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 88, retailer: "COS", url: "#", owned: false },
    { id: 2, name: "Slim Fit Jeans", brand: "Levi's", price: 89, image: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400&q=80", match: 85, retailer: "Levi's", url: "#", owned: false },
    { id: 3, name: "Leather Derby Shoes", brand: "Thursday Boot Co", price: 149, image: "https://images.unsplash.com/photo-1614252369475-531eba835eb1?w=400&q=80", match: 82, retailer: "Thursday", url: "#", owned: false },
    { id: 4, name: "Canvas Tote", brand: "Baggu", price: 38, image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&q=80", match: 79, retailer: "Baggu", url: "#", owned: false },
  ];

  return aestheticProducts[aesthetic] || defaultProducts;
}

export function registerRoutes(httpServer: Server, app: Express) {
  // Analyze outfit image with Gemini Flash
  app.post("/api/analyze", upload.single("image"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No image provided" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API key not configured" });
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });

      const imageBase64 = file.buffer.toString("base64");
      const mimeType = file.mimetype as "image/jpeg" | "image/png" | "image/webp";

      const prompt = `You are a fashion AI for StyleAI. Analyze this outfit image and return ONLY valid JSON with this exact structure:
{
  "aesthetic": "one of: Clean Minimal, Coastal, Streetwear, Cottagecore, Dark Academia, Y2K, Bohemian, Classic Prep, Athleisure, Vintage",
  "confidence": <integer 70-99>,
  "styleBreakdown": [
    {"label": "style name", "score": <integer 60-100>},
    {"label": "style name", "score": <integer 40-80>},
    {"label": "style name", "score": <integer 20-60>}
  ],
  "occasions": ["occasion1", "occasion2", "occasion3"],
  "keyPieces": ["piece1", "piece2", "piece3"],
  "colorPalette": ["#hexcolor1", "#hexcolor2", "#hexcolor3", "#hexcolor4"]
}

Identify the dominant aesthetic, 3 style attributes with percentage scores, 3 occasions this outfit suits, 3 key pieces visible, and 4 dominant colors as hex codes. Be specific and accurate.`;

      const result = await model.generateContent([
        {
          inlineData: {
            data: imageBase64,
            mimeType,
          },
        },
        prompt,
      ]);

      const text = result.response.text();
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not parse Gemini response");
      }
      
      const analysis = JSON.parse(jsonMatch[0]);
      const products = generateMockResults(analysis.aesthetic, analysis.keyPieces);

      // Save to DB
      const imageDataUrl = `data:${mimeType};base64,${imageBase64}`;
      const scan = storage.createScan({
        imageData: imageDataUrl,
        aesthetic: analysis.aesthetic,
        confidence: analysis.confidence,
        styleBreakdown: JSON.stringify(analysis.styleBreakdown),
        occasions: JSON.stringify(analysis.occasions),
        keyPieces: JSON.stringify(analysis.keyPieces),
        colorPalette: JSON.stringify(analysis.colorPalette),
        results: JSON.stringify(products),
      });

      res.json({
        scanId: scan.id,
        aesthetic: analysis.aesthetic,
        confidence: analysis.confidence,
        styleBreakdown: analysis.styleBreakdown,
        occasions: analysis.occasions,
        keyPieces: analysis.keyPieces,
        colorPalette: analysis.colorPalette,
        results: products,
        imageData: imageDataUrl,
      });
    } catch (err: any) {
      console.error("Analyze error:", err);
      res.status(500).json({ error: err.message || "Analysis failed" });
    }
  });

  // Get scan history
  app.get("/api/scans", (req, res) => {
    const allScans = storage.getScans();
    res.json(allScans);
  });

  // Get single scan
  app.get("/api/scans/:id", (req, res) => {
    const scan = storage.getScan(Number(req.params.id));
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    res.json(scan);
  });

  // Get wardrobe
  app.get("/api/wardrobe", (req, res) => {
    const items = storage.getWardrobeItems();
    res.json(items);
  });

  // Add to wardrobe
  app.post("/api/wardrobe", upload.single("image"), (req, res) => {
    try {
      const file = req.file;
      const { name, category, brand, color, aesthetic } = req.body;

      if (!file || !name || !category) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const imageData = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const item = storage.createWardrobeItem({ name, category, brand, color, aesthetic, imageData, source: "manual" });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete wardrobe item
  app.delete("/api/wardrobe/:id", (req, res) => {
    storage.deleteWardrobeItem(Number(req.params.id));
    res.json({ ok: true });
  });
}
