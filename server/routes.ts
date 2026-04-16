import type { Express } from "express";
import type { Server } from "http";
import { storage, initDB } from "./storage";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import multer from "multer";

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Mock product results for MVP (replace with Skimlinks affiliate API)
function generateMockResults(aesthetic: string) {
  const aestheticProducts: Record<string, any[]> = {
    // ── MINIMALIST & CLEAN ──
    "Quiet Luxury": [
      { id: 1, name: "Merino Crewneck Sweater", brand: "Brunello Cucinelli", price: 695, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 97, retailer: "Brunello Cucinelli", url: "#" },
      { id: 2, name: "Tailored Camel Overcoat", brand: "Toteme", price: 895, image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400&q=80", match: 94, retailer: "Toteme", url: "#" },
      { id: 3, name: "Straight-Leg Wool Trousers", brand: "Arket", price: 139, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 91, retailer: "Arket", url: "#" },
      { id: 4, name: "Suede Penny Loafers", brand: "Grenson", price: 285, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 89, retailer: "Grenson", url: "#" },
      { id: 5, name: "Cashmere Turtleneck", brand: "The Row", price: 590, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 86, retailer: "The Row", url: "#" },
      { id: 6, name: "Structured Leather Tote", brand: "Polene", price: 320, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 82, retailer: "Polene", url: "#" },
    ],

    "Clean Fit": [
      { id: 1, name: "Fitted Linen Shirt", brand: "Uniqlo", price: 39, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 96, retailer: "Uniqlo", url: "#" },
      { id: 2, name: "Slim Chino Trousers", brand: "COS", price: 89, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 93, retailer: "COS", url: "#" },
      { id: 3, name: "White Low-Top Sneakers", brand: "Adidas", price: 90, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 90, retailer: "Adidas", url: "#" },
      { id: 4, name: "Fitted White Tank", brand: "SKIMS", price: 38, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 87, retailer: "SKIMS", url: "#" },
      { id: 5, name: "Wide-Leg Tailored Trousers", brand: "Zara", price: 59, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 84, retailer: "Zara", url: "#" },
      { id: 6, name: "Minimal Watch", brand: "Skagen", price: 99, image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80", match: 81, retailer: "Skagen", url: "#" },
    ],

    // Legacy alias
    "Clean Girl": [
      { id: 1, name: "Fitted Linen Shirt", brand: "Uniqlo", price: 39, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 96, retailer: "Uniqlo", url: "#" },
      { id: 2, name: "Slim Chino Trousers", brand: "COS", price: 89, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 93, retailer: "COS", url: "#" },
      { id: 3, name: "White Low-Top Sneakers", brand: "Adidas", price: 90, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 90, retailer: "Adidas", url: "#" },
      { id: 4, name: "Fitted White Tank", brand: "SKIMS", price: 38, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 87, retailer: "SKIMS", url: "#" },
      { id: 5, name: "Wide-Leg Tailored Trousers", brand: "Zara", price: 59, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 84, retailer: "Zara", url: "#" },
      { id: 6, name: "Minimal Watch", brand: "Skagen", price: 99, image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80", match: 81, retailer: "Skagen", url: "#" },
    ],


    "Classic / Timeless": [
      { id: 1, name: "Oxford Button-Down Shirt", brand: "Brooks Brothers", price: 98, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 96, retailer: "Brooks Brothers", url: "#" },
      { id: 2, name: "Slim Trench Coat", brand: "A.P.C.", price: 595, image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400&q=80", match: 93, retailer: "A.P.C.", url: "#" },
      { id: 3, name: "Tailored Navy Blazer", brand: "Reiss", price: 345, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 90, retailer: "Reiss", url: "#" },
      { id: 4, name: "Slim Chino Trousers", brand: "Banana Republic", price: 89, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 87, retailer: "Banana Republic", url: "#" },
      { id: 5, name: "Leather Oxford Shoes", brand: "Thursday Boot Co", price: 199, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 84, retailer: "Thursday Boot Co", url: "#" },
      { id: 6, name: "Wool Crewneck Knit", brand: "Uniqlo", price: 59, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 81, retailer: "Uniqlo", url: "#" },
    ],

    // ── SOFT & FEMININE ──
    "Coquette": [
      { id: 1, name: "Lace Trim Slip Dress", brand: "Reformation", price: 198, image: "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400&q=80", match: 97, retailer: "Reformation", url: "#" },
      { id: 2, name: "Pearl Embellished Headband", brand: "Jennifer Behr", price: 98, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 93, retailer: "Jennifer Behr", url: "#" },
      { id: 3, name: "Satin Bow Ballet Flats", brand: "Repetto", price: 245, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 90, retailer: "Repetto", url: "#" },
      { id: 4, name: "Corset Top", brand: "Bustier", price: 79, image: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=400&q=80", match: 87, retailer: "ASOS", url: "#" },
      { id: 5, name: "Pearl Stud Earrings", brand: "Mejuri", price: 68, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 84, retailer: "Mejuri", url: "#" },
      { id: 6, name: "Mini Bow Bag", brand: "Miu Miu", price: 1490, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&q=80", match: 81, retailer: "Miu Miu", url: "#" },
    ],
    "Soft Girl / Kawaii": [
      { id: 1, name: "Fluffy Pastel Cardigan", brand: "Urban Outfitters", price: 59, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 95, retailer: "Urban Outfitters", url: "#" },
      { id: 2, name: "Pleated Mini Skirt", brand: "Princess Polly", price: 49, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 92, retailer: "Princess Polly", url: "#" },
      { id: 3, name: "Heart Hair Clips Set", brand: "ASOS", price: 15, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 89, retailer: "ASOS", url: "#" },
      { id: 4, name: "Platform Mary Janes", brand: "Steve Madden", price: 89, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 86, retailer: "Steve Madden", url: "#" },
      { id: 5, name: "Layered Charm Necklace", brand: "Anthropologie", price: 38, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 83, retailer: "Anthropologie", url: "#" },
      { id: 6, name: "Pastel Mini Backpack", brand: "Eastpak", price: 65, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 80, retailer: "Eastpak", url: "#" },
    ],
    "Pink Pilates / Wellness": [
      { id: 1, name: "Ribbed Seamless Leggings", brand: "Lululemon", price: 98, image: "https://images.unsplash.com/photo-1506902455-a342f2b12d93?w=400&q=80", match: 96, retailer: "Lululemon", url: "#" },
      { id: 2, name: "Ballet Wrap Cardigan", brand: "Reformation", price: 148, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 93, retailer: "Reformation", url: "#" },
      { id: 3, name: "Tennis Mini Skirt", brand: "Varley", price: 79, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 90, retailer: "Varley", url: "#" },
      { id: 4, name: "Satin Scrunchie Set", brand: "Slip", price: 45, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 87, retailer: "Slip", url: "#" },
      { id: 5, name: "Cloud Sneakers", brand: "On Running", price: 150, image: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=80", match: 84, retailer: "On Running", url: "#" },
      { id: 6, name: "Mini Pilates Bag", brand: "Lululemon", price: 68, image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&q=80", match: 81, retailer: "Lululemon", url: "#" },
    ],
    "Dark Feminine": [
      { id: 1, name: "Velvet Corset Dress", brand: "House of CB", price: 189, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 96, retailer: "House of CB", url: "#" },
      { id: 2, name: "Lace Trim Midi Skirt", brand: "Free People", price: 128, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 93, retailer: "Free People", url: "#" },
      { id: 3, name: "Leather Knee Boots", brand: "Stuart Weitzman", price: 695, image: "https://images.unsplash.com/photo-1512374382149-233c42b6a83b?w=400&q=80", match: 90, retailer: "Stuart Weitzman", url: "#" },
      { id: 4, name: "Satin Slip Cami", brand: "Reformation", price: 98, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80", match: 87, retailer: "Reformation", url: "#" },
      { id: 5, name: "Statement Drop Earrings", brand: "Completedworks", price: 145, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 84, retailer: "Completedworks", url: "#" },
      { id: 6, name: "Dark Berry Lip", brand: "Charlotte Tilbury", price: 34, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 81, retailer: "Charlotte Tilbury", url: "#" },
    ],
    // ── PREPPY & COLLEGIATE ──
    "Old School Preppy": [
      { id: 1, name: "Cable-Knit Crewneck", brand: "J.Crew", price: 118, image: "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=400&q=80", match: 95, retailer: "J.Crew", url: "#" },
      { id: 2, name: "Oxford Button-Down", brand: "Brooks Brothers", price: 89, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 92, retailer: "Brooks Brothers", url: "#" },
      { id: 3, name: "Slim Chino Pants", brand: "Banana Republic", price: 89, image: "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=400&q=80", match: 89, retailer: "Banana Republic", url: "#" },
      { id: 4, name: "Penny Loafers", brand: "G.H. Bass", price: 160, image: "https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=400&q=80", match: 86, retailer: "G.H. Bass", url: "#" },
      { id: 5, name: "Quilted Vest", brand: "Barbour", price: 149, image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400&q=80", match: 83, retailer: "Barbour", url: "#" },
      { id: 6, name: "Plaid Wool Scarf", brand: "Burberry", price: 290, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 80, retailer: "Burberry", url: "#" },
    ],
    "Modern Preppy": [
      { id: 1, name: "Puffer Vest", brand: "Patagonia", price: 149, image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400&q=80", match: 95, retailer: "Patagonia", url: "#" },
      { id: 2, name: "Classic Polo Shirt", brand: "Lacoste", price: 99, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 92, retailer: "Lacoste", url: "#" },
      { id: 3, name: "Colourblock Sneakers", brand: "New Balance", price: 119, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 89, retailer: "New Balance", url: "#" },
      { id: 4, name: "Chino Shorts", brand: "J.Crew", price: 69, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 86, retailer: "J.Crew", url: "#" },
      { id: 5, name: "Pleated Mini Skirt", brand: "Princess Polly", price: 59, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 83, retailer: "Princess Polly", url: "#" },
      { id: 6, name: "Mini Canvas Tote", brand: "L.L. Bean", price: 29, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 80, retailer: "L.L. Bean", url: "#" },
    ],

    // ── STREETWEAR & URBAN ──
    "Streetwear / Hypebeast": [
      { id: 1, name: "Air Max 95 OG", brand: "Nike", price: 185, image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80", match: 97, retailer: "Nike", url: "#" },
      { id: 2, name: "Heavyweight Graphic Tee", brand: "Palace", price: 65, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&q=80", match: 93, retailer: "Palace", url: "#" },
      { id: 3, name: "Cargo Pants", brand: "Carhartt WIP", price: 110, image: "https://images.unsplash.com/photo-1542574621-e088a4464a9e?w=400&q=80", match: 90, retailer: "Carhartt WIP", url: "#" },
      { id: 4, name: "Puffer Jacket", brand: "The North Face", price: 229, image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&q=80", match: 87, retailer: "The North Face", url: "#" },
      { id: 5, name: "Crossbody Shoulder Bag", brand: "Supreme", price: 148, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 84, retailer: "Supreme", url: "#" },
      { id: 6, name: "Camo Cap", brand: "Palace", price: 45, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 81, retailer: "Palace", url: "#" },
    ],
    "Skatecore": [
      { id: 1, name: "Sk8-Hi Sneakers", brand: "Vans", price: 90, image: "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=400&q=80", match: 96, retailer: "Vans", url: "#" },
      { id: 2, name: "Wide-Leg Denim", brand: "Dickies", price: 49, image: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400&q=80", match: 93, retailer: "Dickies", url: "#" },
      { id: 3, name: "Logo Overshirt", brand: "Carhartt WIP", price: 89, image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&q=80", match: 89, retailer: "Carhartt WIP", url: "#" },
      { id: 4, name: "Graphic Skate Tee", brand: "Thrasher", price: 35, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&q=80", match: 86, retailer: "Thrasher", url: "#" },
      { id: 5, name: "Beanie Hat", brand: "New Era", price: 28, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 83, retailer: "New Era", url: "#" },
      { id: 6, name: "Canvas Belt Bag", brand: "Dickies", price: 32, image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&q=80", match: 80, retailer: "Dickies", url: "#" },
    ],
    "Techwear": [
      { id: 1, name: "Waterproof Shell Jacket", brand: "Arc'teryx", price: 625, image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&q=80", match: 97, retailer: "Arc'teryx", url: "#" },
      { id: 2, name: "Ripstop Cargo Trousers", brand: "Veilance", price: 450, image: "https://images.unsplash.com/photo-1542574621-e088a4464a9e?w=400&q=80", match: 94, retailer: "Veilance", url: "#" },
      { id: 3, name: "Trail Running Shoes", brand: "Salomon", price: 160, image: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=80", match: 90, retailer: "Salomon", url: "#" },
      { id: 4, name: "Tactical Vest", brand: "Stone Island", price: 399, image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400&q=80", match: 87, retailer: "Stone Island", url: "#" },
      { id: 5, name: "Balaclava", brand: "C.P. Company", price: 75, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 84, retailer: "C.P. Company", url: "#" },
      { id: 6, name: "Sling Chest Bag", brand: "Cotopaxi", price: 85, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 81, retailer: "Cotopaxi", url: "#" },
    ],
    "Baddie": [
      { id: 1, name: "Sculpted Bodycon Dress", brand: "House of CB", price: 139, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 96, retailer: "House of CB", url: "#" },
      { id: 2, name: "Clear Heel Mules", brand: "Steve Madden", price: 79, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 93, retailer: "Steve Madden", url: "#" },
      { id: 3, name: "Faux Fur Coat", brand: "SHEIN", price: 89, image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400&q=80", match: 89, retailer: "SHEIN", url: "#" },
      { id: 4, name: "Quilted Chain Bag", brand: "Zara", price: 69, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&q=80", match: 86, retailer: "Zara", url: "#" },
      { id: 5, name: "Lash Mascara Set", brand: "Fenty Beauty", price: 28, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 83, retailer: "Fenty Beauty", url: "#" },
      { id: 6, name: "Sleek Sunglasses", brand: "Quay", price: 65, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 80, retailer: "Quay", url: "#" },
    ],
    // ── NATURE & FANTASY ──
    "Fairycore": [
      { id: 1, name: "Chiffon Floral Dress", brand: "Free People", price: 148, image: "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400&q=80", match: 96, retailer: "Free People", url: "#" },
      { id: 2, name: "Floral Crown", brand: "Anthropologie", price: 48, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 93, retailer: "Anthropologie", url: "#" },
      { id: 3, name: "Lace Tights", brand: "Wolford", price: 68, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 90, retailer: "Wolford", url: "#" },
      { id: 4, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 180, image: "https://images.unsplash.com/photo-1605812860427-4024433a70fd?w=400&q=80", match: 87, retailer: "Dr. Martens", url: "#" },
      { id: 5, name: "Mushroom Charm Necklace", brand: "Mejuri", price: 58, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 84, retailer: "Mejuri", url: "#" },
      { id: 6, name: "Velvet Ribbon Hair Bow", brand: "Urban Outfitters", price: 18, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 81, retailer: "Urban Outfitters", url: "#" },
    ],
    "Gorpcore": [
      { id: 1, name: "Beta AR Jacket", brand: "Arc'teryx", price: 750, image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&q=80", match: 97, retailer: "Arc'teryx", url: "#" },
      { id: 2, name: "Fleece Vest", brand: "Patagonia", price: 139, image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400&q=80", match: 94, retailer: "Patagonia", url: "#" },
      { id: 3, name: "Trail Shoes", brand: "Salomon", price: 160, image: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=80", match: 91, retailer: "Salomon", url: "#" },
      { id: 4, name: "Utility Cargo Pants", brand: "The North Face", price: 130, image: "https://images.unsplash.com/photo-1542574621-e088a4464a9e?w=400&q=80", match: 88, retailer: "The North Face", url: "#" },
      { id: 5, name: "Beanie Hat", brand: "Patagonia", price: 35, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 85, retailer: "Patagonia", url: "#" },
      { id: 6, name: "Hip Pack", brand: "Cotopaxi", price: 75, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 82, retailer: "Cotopaxi", url: "#" },
    ],
    // ── VINTAGE & RETRO ──
    "90s Grunge": [
      { id: 1, name: "Flannel Overshirt", brand: "Levi's", price: 79, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 96, retailer: "Levi's", url: "#" },
      { id: 2, name: "Band Graphic Tee", brand: "Urban Outfitters", price: 35, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 93, retailer: "Urban Outfitters", url: "#" },
      { id: 3, name: "1460 Mono Boots", brand: "Dr. Martens", price: 170, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 90, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "Ripped Slim Jeans", brand: "Levi's", price: 98, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 87, retailer: "Levi's", url: "#" },
      { id: 5, name: "Oversized Cardigan", brand: "Mango", price: 69, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 84, retailer: "Mango", url: "#" },
      { id: 6, name: "Leather Crossbody Bag", brand: "Urban Outfitters", price: 45, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 81, retailer: "Urban Outfitters", url: "#" },
    ],

    "70s-80s Retro": [
      { id: 1, name: "Flared Denim Jeans", brand: "Levi's", price: 109, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 96, retailer: "Levi's", url: "#" },
      { id: 2, name: "Open-Collar Printed Shirt", brand: "Urban Outfitters", price: 59, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 93, retailer: "Urban Outfitters", url: "#" },
      { id: 3, name: "Platform Chelsea Boots", brand: "Dr. Martens", price: 179, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 90, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "Suede Jacket", brand: "ASOS", price: 149, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 87, retailer: "ASOS", url: "#" },
      { id: 5, name: "Oversized Tortoiseshell Sunglasses", brand: "Le Specs", price: 69, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 84, retailer: "Le Specs", url: "#" },
      { id: 6, name: "Gold Layered Chains", brand: "Anthropologie", price: 48, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 81, retailer: "Anthropologie", url: "#" },
    ],

    "Vintage / Thrift": [
      { id: 1, name: "Washed Denim Jacket", brand: "Levi's", price: 89, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 95, retailer: "Levi's", url: "#" },
      { id: 2, name: "Vintage Band Graphic Tee", brand: "Urban Outfitters", price: 35, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 92, retailer: "Urban Outfitters", url: "#" },
      { id: 3, name: "Thrifted Corduroy Overshirt", brand: "ASOS", price: 55, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 89, retailer: "ASOS", url: "#" },
      { id: 4, name: "90s Logo Cap", brand: "Tommy Hilfiger", price: 38, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 86, retailer: "Tommy Hilfiger", url: "#" },
      { id: 5, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 179, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 83, retailer: "Dr. Martens", url: "#" },
      { id: 6, name: "Deadstock Floral Shirt", brand: "Depop", price: 28, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 80, retailer: "Depop", url: "#" },
    ],

    // ── BOLD & EXPRESSIVE ──
    "Maximalist": [
      { id: 1, name: "Printed Statement Shirt", brand: "Zara", price: 69, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 96, retailer: "Zara", url: "#" },
      { id: 2, name: "Mixed Print Blazer", brand: "ASOS", price: 99, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 93, retailer: "ASOS", url: "#" },
      { id: 3, name: "Chunky Layered Chain Necklace", brand: "Anthropologie", price: 48, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 90, retailer: "Anthropologie", url: "#" },
      { id: 4, name: "Colourful Chunky Sneakers", brand: "New Balance", price: 139, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 87, retailer: "New Balance", url: "#" },
      { id: 5, name: "Mixed Print Dress", brand: "Farm Rio", price: 195, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 84, retailer: "Farm Rio", url: "#" },
      { id: 6, name: "Animal Print Coat", brand: "ASOS", price: 129, image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400&q=80", match: 81, retailer: "ASOS", url: "#" },
    ],

    "Glam / Party": [
      { id: 1, name: "Velvet Blazer", brand: "ASOS", price: 89, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 96, retailer: "ASOS", url: "#" },
      { id: 2, name: "Sequin Mini Dress", brand: "House of CB", price: 149, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 93, retailer: "House of CB", url: "#" },
      { id: 3, name: "Satin Dress Shirt", brand: "Zara", price: 69, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 90, retailer: "Zara", url: "#" },
      { id: 4, name: "Metallic Clutch Bag", brand: "ASOS", price: 35, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 87, retailer: "ASOS", url: "#" },
      { id: 5, name: "Crystal Drop Earrings", brand: "Completedworks", price: 95, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 84, retailer: "Completedworks", url: "#" },
      { id: 6, name: "Pointed Dress Shoes", brand: "Aldo", price: 119, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 81, retailer: "Aldo", url: "#" },
    ],

    "E-Girl / Alt": [
      { id: 1, name: "Striped Long-Sleeve Tee", brand: "Urban Outfitters", price: 35, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 96, retailer: "Urban Outfitters", url: "#" },
      { id: 2, name: "Chain Link Choker", brand: "ASOS", price: 12, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 93, retailer: "ASOS", url: "#" },
      { id: 3, name: "Platform Combat Boots", brand: "Dr. Martens", price: 179, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 90, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "Graphic Alt Hoodie", brand: "Killstar", price: 79, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 87, retailer: "Killstar", url: "#" },
      { id: 5, name: "Straight-Leg Black Jeans", brand: "Topman", price: 55, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 84, retailer: "Topman", url: "#" },
      { id: 6, name: "Plaid Mini Skirt", brand: "UNIF", price: 78, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 81, retailer: "UNIF", url: "#" },
    ],

    // ── FORMAL & POWER ──
    "Office Siren": [
      { id: 1, name: "Power Shoulder Blazer", brand: "Zara", price: 129, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 96, retailer: "Zara", url: "#" },
      { id: 2, name: "Slim-Fit Dress Trousers", brand: "Reiss", price: 149, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 93, retailer: "Reiss", url: "#" },
      { id: 3, name: "Silk Blouse", brand: "Equipment", price: 198, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 90, retailer: "Equipment", url: "#" },
      { id: 4, name: "Leather Oxford Shoes", brand: "Thursday Boot Co", price: 199, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 87, retailer: "Thursday Boot Co", url: "#" },
      { id: 5, name: "Structured Work Tote", brand: "Polene", price: 295, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 84, retailer: "Polene", url: "#" },
      { id: 6, name: "Minimal Gold Watch", brand: "Skagen", price: 129, image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80", match: 81, retailer: "Skagen", url: "#" },
    ],

    "Occasion Wear": [
      { id: 1, name: "Tailored Two-Piece Suit", brand: "Reiss", price: 595, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 96, retailer: "Reiss", url: "#" },
      { id: 2, name: "Midi Wrap Dress", brand: "Reformation", price: 198, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 93, retailer: "Reformation", url: "#" },
      { id: 3, name: "Oxford Dress Shoes", brand: "Thursday Boot Co", price: 199, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 90, retailer: "Thursday Boot Co", url: "#" },
      { id: 4, name: "Pocket Square", brand: "Drake's", price: 55, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 87, retailer: "Drake's", url: "#" },
      { id: 5, name: "Satin Evening Clutch", brand: "Cult Gaia", price: 195, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 84, retailer: "Cult Gaia", url: "#" },
      { id: 6, name: "Pearl Hoop Earrings", brand: "Completedworks", price: 85, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 81, retailer: "Completedworks", url: "#" },
    ],

    // ── SPORT & ACTIVE ──
    "Blokecore": [
      { id: 1, name: "Football Jersey", brand: "Adidas", price: 85, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&q=80", match: 96, retailer: "Adidas", url: "#" },
      { id: 2, name: "Wide-Leg Jorts", brand: "Levi's", price: 65, image: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400&q=80", match: 93, retailer: "Levi's", url: "#" },
      { id: 3, name: "Classic Trainer Sneakers", brand: "Adidas", price: 90, image: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=80", match: 90, retailer: "Adidas", url: "#" },
      { id: 4, name: "Bucket Hat", brand: "New Era", price: 35, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 87, retailer: "New Era", url: "#" },
      { id: 5, name: "Zip-Up Track Jacket", brand: "Umbro", price: 65, image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&q=80", match: 84, retailer: "Umbro", url: "#" },
      { id: 6, name: "Terry Cloth Wristband", brand: "Nike", price: 18, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 81, retailer: "Nike", url: "#" },
    ],
    // ── COUNTERCULTURAL ──
    "Goth": [
      { id: 1, name: "Platform Chelsea Boots", brand: "Dr. Martens", price: 179, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 96, retailer: "Dr. Martens", url: "#" },
      { id: 2, name: "Oversized Black Trench Coat", brand: "ASOS", price: 119, image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400&q=80", match: 93, retailer: "ASOS", url: "#" },
      { id: 3, name: "Layered Chain Choker", brand: "ASOS", price: 18, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 90, retailer: "ASOS", url: "#" },
      { id: 4, name: "All-Black Skinny Jeans", brand: "Topman", price: 55, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 87, retailer: "Topman", url: "#" },
      { id: 5, name: "Velvet Blazer", brand: "ASOS", price: 89, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 84, retailer: "ASOS", url: "#" },
      { id: 6, name: "Fishnet Layering Top", brand: "Wolford", price: 45, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 81, retailer: "Wolford", url: "#" },
    ],

    "Grunge / Punk": [
      { id: 1, name: "Studded Leather Jacket", brand: "ASOS", price: 110, image: "https://images.unsplash.com/photo-1523205771623-e0faa4d2813d?w=400&q=80", match: 96, retailer: "ASOS", url: "#" },
      { id: 2, name: "Band Graphic Tee", brand: "Urban Outfitters", price: 34, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&q=80", match: 93, retailer: "Urban Outfitters", url: "#" },
      { id: 3, name: "1460 Mono Boots", brand: "Dr. Martens", price: 180, image: "https://images.unsplash.com/photo-1605812860427-4024433a70fd?w=400&q=80", match: 90, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "Distressed Jeans", brand: "Levi's", price: 88, image: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400&q=80", match: 87, retailer: "Levi's", url: "#" },
      { id: 5, name: "Plaid Flannel Shirt", brand: "Carhartt", price: 59, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 84, retailer: "Carhartt", url: "#" },
      { id: 6, name: "Safety Pin Set", brand: "ASOS", price: 8, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 81, retailer: "ASOS", url: "#" },
    ],
    // ── CULTURAL / REGIONAL ──
    "Western / Americana": [
      { id: 1, name: "Cowboy Boots", brand: "Ariat", price: 199, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 96, retailer: "Ariat", url: "#" },
      { id: 2, name: "Wide-Brim Felt Hat", brand: "Lack of Color", price: 129, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 93, retailer: "Lack of Color", url: "#" },
      { id: 3, name: "Embroidered Western Shirt", brand: "Wrangler", price: 79, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 90, retailer: "Wrangler", url: "#" },
      { id: 4, name: "Bootcut Denim Jeans", brand: "Levi's", price: 99, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 87, retailer: "Levi's", url: "#" },
      { id: 5, name: "Leather Belt with Buckle", brand: "Ariat", price: 55, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 84, retailer: "Ariat", url: "#" },
      { id: 6, name: "Denim Fringe Jacket", brand: "Levi's", price: 149, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 81, retailer: "Levi's", url: "#" },
    ],

    "K-Fashion": [
      { id: 1, name: "Oversized Varsity Jacket", brand: "Ader Error", price: 289, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 96, retailer: "Ader Error", url: "#" },
      { id: 2, name: "Cropped Wide-Leg Trousers", brand: "COS", price: 109, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 93, retailer: "COS", url: "#" },
      { id: 3, name: "Platform Dad Sneakers", brand: "New Balance", price: 139, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 90, retailer: "New Balance", url: "#" },
      { id: 4, name: "Pastel Oversized Cardigan", brand: "COS", price: 89, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 87, retailer: "COS", url: "#" },
      { id: 5, name: "Bucket Hat", brand: "Maje", price: 65, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 84, retailer: "Maje", url: "#" },
      { id: 6, name: "Mini Shoulder Bag", brand: "Marc Jacobs", price: 175, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 81, retailer: "Marc Jacobs", url: "#" },
    ],

    // ── EMERGING ──
    "Retro-Futurism": [
      { id: 1, name: "Metallic Bomber Jacket", brand: "ASOS", price: 129, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 96, retailer: "ASOS", url: "#" },
      { id: 2, name: "Reflective Cargo Trousers", brand: "Zara", price: 79, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 93, retailer: "Zara", url: "#" },
      { id: 3, name: "Futuristic Running Shoes", brand: "Salomon", price: 149, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 90, retailer: "Salomon", url: "#" },
      { id: 4, name: "Silver Mirror Sunglasses", brand: "Le Specs", price: 69, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 87, retailer: "Le Specs", url: "#" },
      { id: 5, name: "Chrome Crossbody Bag", brand: "Coperni", price: 395, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 84, retailer: "Coperni", url: "#" },
      { id: 6, name: "Asymmetric Knit Top", brand: "Mango", price: 59, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 81, retailer: "Mango", url: "#" },
    ],

    "Historical Romanticism": [
      { id: 1, name: "Ruffled Poet Shirt", brand: "ASOS", price: 45, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 96, retailer: "ASOS", url: "#" },
      { id: 2, name: "Velvet Blazer", brand: "Vivienne Westwood", price: 395, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 93, retailer: "Vivienne Westwood", url: "#" },
      { id: 3, name: "Puffed Sleeve Blouse", brand: "& Other Stories", price: 69, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 90, retailer: "& Other Stories", url: "#" },
      { id: 4, name: "Velvet Midi Skirt", brand: "Free People", price: 128, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 87, retailer: "Free People", url: "#" },
      { id: 5, name: "Pearl Headband", brand: "Jennifer Behr", price: 95, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 84, retailer: "Jennifer Behr", url: "#" },
      { id: 6, name: "Buckled Dress Shoes", brand: "Dr. Martens", price: 159, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 81, retailer: "Dr. Martens", url: "#" },
    ],

    // ── LEGACY KEYS (map old names → closest new category) ──
    "Clean Minimal": [
      { id: 1, name: "Relaxed Linen Blazer", brand: "& Other Stories", price: 149, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 95, retailer: "& Other Stories", url: "#" },
      { id: 2, name: "Wide-Leg Tailored Trousers", brand: "Arket", price: 119, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 92, retailer: "Arket", url: "#" },
      { id: 3, name: "White Low-Top Sneakers", brand: "Adidas", price: 90, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 89, retailer: "Adidas", url: "#" },
      { id: 4, name: "Structured Leather Tote", brand: "Toteme", price: 395, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 86, retailer: "Toteme", url: "#" },
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
      { id: 1, name: "Floral Linen Shirt", brand: "Uniqlo", price: 39, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 95, retailer: "Uniqlo", url: "#" },
      { id: 2, name: "Crochet Cardigan", brand: "Free People", price: 148, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 92, retailer: "Free People", url: "#" },
      { id: 3, name: "Prairie Smock Dress", brand: "Anthropologie", price: 168, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 89, retailer: "Anthropologie", url: "#" },
      { id: 4, name: "Wicker Basket Bag", brand: "Cult Gaia", price: 195, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 86, retailer: "Cult Gaia", url: "#" },
    ],

    "Dark Academia": [
      { id: 1, name: "Plaid Wool Blazer", brand: "Polo Ralph Lauren", price: 349, image: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80", match: 96, retailer: "Polo Ralph Lauren", url: "#" },
      { id: 2, name: "High-Waist Pleated Trousers", brand: "COS", price: 119, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 92, retailer: "COS", url: "#" },
      { id: 3, name: "Oxford Brogues", brand: "Thursday Boot Co", price: 199, image: "https://images.unsplash.com/photo-1614252369475-531eba835eb1?w=400&q=80", match: 89, retailer: "Thursday", url: "#" },
      { id: 4, name: "Turtleneck Knit", brand: "Uniqlo", price: 49, image: "https://images.unsplash.com/photo-1608234808654-2a8875faa7fd?w=400&q=80", match: 85, retailer: "Uniqlo", url: "#" },
    ],
    "Y2K": [
      { id: 1, name: "Low-Rise Flare Jeans", brand: "Levi's", price: 99, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 95, retailer: "Levi's", url: "#" },
      { id: 2, name: "Baggy Graphic Jersey Tee", brand: "Urban Outfitters", price: 45, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 92, retailer: "Urban Outfitters", url: "#" },
      { id: 3, name: "Platform Sneakers", brand: "Buffalo London", price: 149, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 89, retailer: "Buffalo London", url: "#" },
      { id: 4, name: "Von Dutch Trucker Cap", brand: "Von Dutch", price: 45, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 86, retailer: "Von Dutch", url: "#" },
    ],

    "Bohemian": [
      { id: 1, name: "Wide-Brim Straw Hat", brand: "Lack of Color", price: 119, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 95, retailer: "Lack of Color", url: "#" },
      { id: 2, name: "Linen Button-Down Shirt", brand: "Zara", price: 49, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 92, retailer: "Zara", url: "#" },
      { id: 3, name: "Suede Fringe Boots", brand: "Sam Edelman", price: 149, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 89, retailer: "Sam Edelman", url: "#" },
      { id: 4, name: "Layered Gold Necklace", brand: "Anthropologie", price: 48, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 86, retailer: "Anthropologie", url: "#" },
    ],

    "Classic Prep": [
      { id: 1, name: "Cable-Knit Crewneck", brand: "J.Crew", price: 118, image: "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=400&q=80", match: 95, retailer: "J.Crew", url: "#" },
      { id: 2, name: "Slim Chino Pants", brand: "Banana Republic", price: 89, image: "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=400&q=80", match: 91, retailer: "Banana Republic", url: "#" },
      { id: 3, name: "Penny Loafers", brand: "G.H. Bass", price: 160, image: "https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=400&q=80", match: 88, retailer: "G.H. Bass", url: "#" },
      { id: 4, name: "Quilted Vest", brand: "Barbour", price: 149, image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400&q=80", match: 84, retailer: "Barbour", url: "#" },
    ],
    "Athleisure": [
      { id: 1, name: "Seamless Jogger Set", brand: "Gymshark", price: 89, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 96, retailer: "Gymshark", url: "#" },
      { id: 2, name: "Oversized Hoodie", brand: "Nike", price: 75, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 93, retailer: "Nike", url: "#" },
      { id: 3, name: "Court Low Sneakers", brand: "New Balance", price: 89, image: "https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80", match: 90, retailer: "New Balance", url: "#" },
      { id: 4, name: "Track Pants", brand: "Adidas", price: 65, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 87, retailer: "Adidas", url: "#" },
      { id: 5, name: "Seamless Leggings", brand: "Lululemon", price: 98, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 84, retailer: "Lululemon", url: "#" },
      { id: 6, name: "Quarter-Zip Pullover", brand: "Lululemon", price: 118, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 81, retailer: "Lululemon", url: "#" },
    ],

    "Vintage": [
      { id: 1, name: "Washed Denim Jacket", brand: "Levi's", price: 89, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 95, retailer: "Levi's", url: "#" },
      { id: 2, name: "Vintage Band Graphic Tee", brand: "Urban Outfitters", price: 35, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 92, retailer: "Urban Outfitters", url: "#" },
      { id: 3, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 179, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 89, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "90s Logo Cap", brand: "Tommy Hilfiger", price: 38, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 86, retailer: "Tommy Hilfiger", url: "#" },
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
        // Minimalist & Clean
        "Quiet Luxury",
        "Clean Fit",
        "Classic / Timeless",
        // Soft & Feminine
        "Coquette",
        "Soft Girl / Kawaii",
        "Pink Pilates / Wellness",
        "Dark Feminine",
        // Preppy & Collegiate
        "Old School Preppy",
        "Modern Preppy",
        // Streetwear & Urban
        "Streetwear / Hypebeast",
        "Skatecore",
        "Techwear",
        "Baddie",
        // Nature & Fantasy
        "Cottagecore",
        "Dark Academia",
        "Fairycore",
        "Gorpcore",
        // Vintage & Retro
        "Y2K",
        "90s Grunge",
        "70s-80s Retro",
        "Vintage / Thrift",
        // Bold & Expressive
        "Maximalist",
        "Glam / Party",
        "E-Girl / Alt",
        // Formal & Power
        "Office Siren",
        "Occasion Wear",
        // Sport & Active
        "Athleisure",
        "Blokecore",
        // Countercultural
        "Goth",
        "Grunge / Punk",
        "Bohemian",
        // Cultural / Regional
        "Western / Americana",
        "K-Fashion",
        // Emerging
        "Retro-Futurism",
        "Historical Romanticism",
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

// ─── System instruction — 35-category style taxonomy + calibration rules ───
const SYSTEM_INSTRUCTION = `You are StyleAI, an expert fashion stylist and aesthetic analyst specialising in visual outfit classification.

GENDER-INCLUSIVE CLASSIFICATION:
- Fashion aesthetics apply to ALL genders. Classify based on visual garments, silhouettes, and styling — never assume gender from body type alone.
- Every aesthetic below lists both masculine and feminine expressions of that style. Identify whichever expression is visible.
- A man wearing quiet luxury tailoring is Quiet Luxury. A man in ballet flats and pearls is Coquette. A woman in cargo pants and Jordans is Streetwear. Classify what you SEE.
- When unsure of gender from the image, describe the clothing items neutrally and classify by aesthetic — not by assumed gender.

STYLE TAXONOMY — definitions for all 35 supported aesthetics:

── MINIMALIST & CLEAN ──
- Quiet Luxury: Understated wealth signalling. Neutral palette (camel, cream, black, ivory, navy). Quality fabrics — cashmere, wool, silk, fine leather. No visible logos. MASC: tailored trousers, merino crewnecks, suede loafers, unstructured blazers, clean white shirts. FEM: wide-leg trousers, cashmere turtlenecks, ballet flats, structured totes. Brands: The Row, Totême, Loro Piana, Brunello Cucinelli, Auralee.
- Clean Fit: Effortless polished minimalism — basics executed with precision, zero effort visible. Off-white/black/beige/grey palette. MASC: fitted linen shirt, slim chinos or trousers, white low-top sneakers, minimal watch, clean silhouette with no logos or fuss. FEM: white tanks, wide-leg trousers, gold hoops, slicked bun, oversized blazer. KEY DISTINCTION: Clean Fit is about effortless casual minimalism. If the outfit has structured tailoring, a blazer, Oxford shirt, or leather shoes → use Classic / Timeless. If it signals wealth through fabric quality and heritage brands → use Quiet Luxury. Clean Fit = clean, casual, unfussy basics on anyone.
- Classic / Timeless: Structured, heritage-quality, investment dressing. Navy/black/white/grey/camel. MASC: Oxford shirts, slim chinos, leather Oxford shoes, tailored navy blazers, trench coats. FEM: pencil skirts, silk blouses, pointed pumps, structured handbags. Endlessly polished, never trendy.

── SOFT & FEMININE ──
- Coquette: Hyperfeminine romanticism. Bows, lace, pearls, satin slips, corset tops, Mary Janes. Dusty pink, cream, lilac, powder blue. Lana del Rey / Bridgerton energy. Also seen in male fashion as Femboy / soft masc — satin blouses, lace trim, bows. Evolving into Rococo Revival.
- Soft Girl / Kawaii: Pastel-cute, K-pop influenced. Cardigans, pleated mini skirts, heart clips, layered necklaces, cute sneakers. Baby pink, lavender, mint, peach. Also on men as pastel fits, cute prints, feminine silhouettes worn without irony. Gentle and playful.
- Pink Pilates / Wellness: Aspirational wellness aesthetic. Ballet-inspired athleisure, ribbed sets, tennis skirts/shorts, satin scrunchies. Blush pink, cream, mauve, dusty rose. Also on men: blush-toned activewear, pastel zip-ups, clean white training shoes. Fitness meets fashion.
- Dark Feminine: Femme fatale confidence. Corsets, lace midi dresses, satin slips, black boots, statement earrings. Black, deep burgundy, forest green, dark navy. Predominantly feminine expression — villain-era energy.

── PREPPY & COLLEGIATE ──
- Old School Preppy: East Coast elite heritage. Oxford shirts, blazers, chinos, loafers, cable knits. Navy, white, green, red, burgundy, khaki. MASC: quarter-zip sweaters, boat shoes, khaki chinos, club ties, navy blazers. FEM: pearl bracelets, plaid skirts, headbands, polo dresses. Country club / Ivy League.
- Modern Preppy: Gen Z preppy reinvention. Brighter, more playful than classic prep. Vibrant pastels + white. MASC: polo shirts, colourful shorts, clean sneakers, caps worn backwards. FEM: pleated minis, puffer vests, grosgrain headbands, mini totes.

── STREETWEAR & URBAN ──
- Streetwear / Hypebeast: Urban culture, sneaker drops, brand-forward. Graphic hoodies, cargo pants, oversized tees, rare sneakers, crossbody bags. Supreme, Off-White, Corteiz, Jordan Brand. Bold graphics and logos. Worn across all genders — key signals are the BRANDS and SILHOUETTES, not the wearer.
- Skatecore: Baggy and anti-fashion. Wide-leg jeans, graphic tees, Vans/DC shoes, caps, overshirts. Washed denim, black, white, earth tones. Skate brand logos. MASC dominant but gender-fluid. Relaxed and deliberate.
- Techwear: Utilitarian futurism. Technical jackets, cargo trousers, tactical vests, trail shoes, dark palette. ACRONYM, Veilance, Stone Island, Arc'teryx Veilance. Modular, functional, all-weather. Predominantly masculine expression but worn by all.
- Baddie: Glamorous urban confidence. Bodycon silhouettes, form-fitting co-ords, high heels, statement bags, fur-trim coats. Black, nude, gold, animal print. Polished, confident, bold. Predominantly feminine expression.

── NATURE & FANTASY ──
- Cottagecore: Pastoral romance. Prairie dresses, floral blouses, linen, crochet, aprons, straw hats. Sage, cream, dusty rose, terracotta. MASC expression: linen shirts, suspenders, knit vests, wicker hats, floral prints. Slow-living, handmade-feeling.
- Dark Academia: Scholarly and moody. Tweed blazers, turtlenecks, plaid, oxfords, trench coats. Dark brown, forest green, burgundy, camel, charcoal. MASC: tweed blazer + turtleneck + Oxford brogues + leather satchel. FEM: plaid skirts, knee socks, structured bags. Library-core layering — very wearable across all genders.
- Fairycore: Mystical and ethereal. Chiffon, floral crowns, lace, platform boots, delicate layered jewellery. Forest green, mushroom brown, dusty purple, cream. Predominantly feminine, but seen on all genders in alt/whimsical fashion.
- Gorpcore: Outdoor technical as everyday wear. Puffer jackets, fleece vests, cargo pants, trail shoes, beanies, fanny packs. Arc'teryx, Patagonia, The North Face. Earth tones + functional details. Very gender-neutral — classify by technical garments, not wearer.

── VINTAGE & RETRO ERAS ──
- Y2K: Early 2000s pop-culture nostalgia. KEY SIGNALS: low-rise waistbands, rhinestone/bedazzled details, velour tracksuits, butterfly clips, tiny micro bags, baby tees, tube tops. Palette: hot pink, metallics, neon pastels, ice blue, denim-on-denim. MASC Y2K: baggy denim, Von Dutch caps, graphic jersey tees, tinted sunglasses. FEM Y2K: tube tops, low-rise mini skirts, bedazzled belts, velour co-ords. IMPORTANT: Y2K is NOT just "has platform boots" — platforms appear in 70s-80s Retro too. Y2K requires synthetic fabrics, low-rise silhouettes, or rhinestone/logo-heavy details. Earth tones + wide-leg corduroy + platform boots = 70s-80s Retro, NOT Y2K.
- 90s Grunge: Dishevelled rebellion. Flannel shirts, band tees, ripped jeans, Doc Martens. Black, plaid earth tones, faded denim, burgundy. MASC: flannel overshirt + band tee + ripped jeans + Docs. FEM: slip dresses + flannel + chunky boots. Kurt Cobain / Courtney Love energy — equally masculine and feminine.
- 70s-80s Retro: 1970s–1980s decade nostalgia. KEY SIGNALS: wide-leg or flared silhouettes, corduroy fabric, suede, warm earth tone palette (mustard, rust, camel, tan, brown, olive), platform boots or wedges, aviator sunglasses, open-collar printed shirts, gold chains, disco-era details. MASC: flared denim, printed open shirts, suede jackets, platform boots, gold chains, aviator shades, corduroy trousers. FEM: wrap dresses, wide-leg corduroys, corset or bustier tops layered over earth tones, platform boots, suede bags. DISTINCTION: if the outfit has corduroy, warm earth tones (tan/camel/rust/brown), and wide-leg silhouettes → 70s-80s Retro. If it has rhinestones, low-rise waistbands, velour, neon pastels, or baby tees → Y2K.
- Vintage / Thrift: Curated secondhand across any era. Heritage pieces, mixed-era layering, one-of-a-kind details. Washed/worn textures. MASC: vintage band tees, deadstock denim, old-logo caps, thrifted blazers. FEM: floral wrap dresses, vintage blazers, 90s slip dresses. Depop energy. Earth tones, muted brights.

── BOLD & EXPRESSIVE ──
- Maximalist: More is more. Clashing prints, bold layers, statement coats, loud accessories. Animal print, jewel tones, all brights. MASC maximalism: bold printed shirts, layered jewellery, patterned suits, colourful trainers. FEM: ruffled dresses, statement coats, stacked accessories. Dopamine dressing — equally expressive across genders.
- Glam / Party: Evening and club wear. Sequins, satin, feather trim, metallic fabrics. Gold, silver, deep red, rich jewel tones. MASC: satin shirts, embellished jackets, velvet blazers, pointed dress shoes. FEM: sequin dresses, strappy heels, metallic bags. Shine and occasion.
- E-Girl / Alt: Internet alt culture. Striped layering tees, plaid, chunky boots, chains, alt accessories. Black, red, pastel accents. MASC expression: E-Boy — striped long-sleeve under graphic tee, chains, straight-leg jeans, skate shoes. FEM: heart clips, plaid skirts, thigh-highs. Anime meets emo.

── FORMAL & POWER DRESSING ──
- Office Siren: Polished work dressing with a confident edge. Pencil skirts, structured blazers, silk blouses, heels. Black, white, grey, navy, red. MASC: slim-fit suit, open-collar dress shirt, oxford shoes, structured briefcase. FEM: power suits, pointed mules, corset tops. Corpcore / power dressing with intentional sex appeal.
- Occasion Wear: Elegant event dressing. Structured pieces, elevated fabrics, sophisticated silhouettes. Classic navy, black, ivory, rich colours. MASC: suit, dress shirt, tailored trousers, Oxford shoes, pocket square. FEM: midi dresses, structured coats, heels, clutch bags. Semi-formal to formal.

── SPORT & ACTIVE ──
- Athleisure: Athletic pieces as everyday fashion. Performance fabrics in lifestyle context. Black, grey, white, bright accents. MASC: jogger sets, quarter-zips, track pants, running shoes, performance polos. FEM: leggings, sports bras, bombers, sneakers. Unisex aesthetic — classify by activewear silhouettes and brands (Nike, Adidas, Lululemon, Gymshark).
- Blokecore: Football culture as fashion. Football jerseys, wide-leg jorts, trainers, bucket hats, zip hoodies. Team colours, navy, black, white. British casual meets streetwear. Predominantly masculine but increasingly worn by all genders.

── COUNTERCULTURAL ──
- Goth: Dark subculture. All black, PVC/vinyl, chokers, platform boots, dark makeup, Victorian lace details, chains. Black, deep purple, blood red. MASC goth: all-black fits, trench coats, combat boots, fishnet tops, silver jewellery, black nail polish. FEM goth: velvet dresses, corsets, platform boots, dark makeup. 40+ year subculture.
- Grunge / Punk: Anti-fashion DIY spirit. Flannel, band tees, ripped denim, combat boots, leather jackets, safety pins, studded details. Black, plaid, faded denim. MASC dominant but gender-neutral in practice — classify by the DIY, rebellious garment signals.
- Bohemian: Free-spirited and artisanal. Flowy silhouettes, crochet, fringe, layered jewellery, wide-brim hats, sandals. Rust, olive, warm brown, terracotta. MASC boho: linen shirts, wide-brim hats, fringe vests, layered necklaces, leather sandals. FEM: maxi dresses, crochet tops, fringe bags. Festival and travel energy.

── CULTURAL / REGIONAL ──
- Western / Americana: American West. Cowboy boots, wide-brim hats, denim jackets, fringe, plaid, leather belts. Denim blue, tan, red, brown, cream. MASC: cowboy boots + bootcut jeans + western shirt + belt buckle. FEM: fringe jackets, cowboy boots, denim mini. Country music / Cowboycore — equally worn across genders.
- K-Fashion: Korean street fashion influence. Oversized varsity jackets, coordinated sets, platform shoes, cardigans. Pastel coordinates, black + white, school-uniform tones. MASC K-fashion: oversized blazers, cropped trousers, platform sneakers, soft-colour co-ords, bucket hats. FEM: mini skirts, platform shoes, pastel sets. K-pop / Ulzzang — very common across all genders.

── EMERGING ──
- Retro-Futurism: Future-nostalgia. Metallic, vinyl, bold asymmetric pieces, futuristic silhouettes. Silver, holographic, white, neon, chrome. MASC: metallic bomber, utility cargo in silver/white, futuristic sneakers, chrome accessories. FEM: metallic moto jacket, vinyl flared trousers, holographic boots. Y3K energy, sci-fi inspired.
- Historical Romanticism: Wearable historical fantasy. Corsets, lace blouses, velvet midis, puffed sleeves, pearl headbands. Dusty pink, deep blue, ivory, gold, jewel tones. MASC: ruffled poet shirts, velvet blazers, slim breeches, buckled shoes, lace cuffs. FEM: corsets, puffed sleeves, floral midis. Regencycore / Castlecore.

CALIBRATION RULES:
- Complete the reasoning field fully before any classification field.
- Name specific visible items — not impressions or vibes.
- Base confidence ONLY on what is observable. Do not guess at hidden garments.
- If the image is partial, low-resolution, or ambiguous, lower confidence accordingly.
- If signals for two aesthetics are nearly equal, set confidence below 70 and populate secondaryAesthetic.
- Do not default to the most common category — classify from evidence only.
- Choose the MOST SPECIFIC matching category. Do not default to "Vintage / Thrift" when a more specific era (Y2K, 90s Grunge, 70s-80s Retro) fits better.
- Y2K vs 70s-80s Retro: platform boots alone do NOT confirm Y2K. Y2K requires at least one of: low-rise waistband, rhinestones/bedazzle, velour, neon pastels, baby tee, tube top, or micro bag. Corduroy + earth tones + wide-leg + platforms = 70s-80s Retro.
- Corset/bustier tops appear across multiple aesthetics: in Y2K (paired with low-rise mini, metallics), in 70s-80s Retro (paired with wide-leg earth tones), in Coquette (paired with bows/lace/pastels), in Dark Feminine (paired with all-black). Always look at the full outfit, not just one item.
- Minimalist outfits: distinguish carefully between the three minimalist categories:
  • Quiet Luxury = expensive fabrics, heritage brands, refined but not casual (The Row, Loro Piana energy)
  • Clean Fit = effortless casual basics, any gender — linen shirts, chinos, white sneakers, simple tees. No logos, no fuss.
  • Classic / Timeless = structured tailoring — blazers, Oxford shoes, dress trousers, trench coats. More formal than Clean Fit.
  A man in a white linen shirt + slim trousers + white sneakers = Clean Fit. Add Oxford shoes + blazer = Classic / Timeless. Add cashmere + suede loafers + no branding = Quiet Luxury.
- GENDER: Do not let perceived gender of the wearer bias classification. Classify the GARMENTS and STYLING, not the person.`;

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
