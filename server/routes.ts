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
      { id: 1, name: "Cashmere Turtleneck", brand: "The Row", price: 590, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 97, retailer: "The Row", url: "#" },
      { id: 2, name: "Tailored Camel Coat", brand: "Toteme", price: 895, image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400&q=80", match: 94, retailer: "Toteme", url: "#" },
      { id: 3, name: "Straight-Leg Trousers", brand: "Arket", price: 119, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 91, retailer: "Arket", url: "#" },
      { id: 4, name: "Leather Ballet Flats", brand: "Reformation", price: 248, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 88, retailer: "Reformation", url: "#" },
      { id: 5, name: "Structured Leather Tote", brand: "Polene", price: 320, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 85, retailer: "Polene", url: "#" },
      { id: 6, name: "Gold Hoop Earrings", brand: "Mejuri", price: 78, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 82, retailer: "Mejuri", url: "#" },
    ],
    "Clean Girl": [
      { id: 1, name: "Fitted White Tank", brand: "SKIMS", price: 38, image: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&q=80", match: 96, retailer: "SKIMS", url: "#" },
      { id: 2, name: "Wide-Leg Tailored Trousers", brand: "Zara", price: 59, image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&q=80", match: 93, retailer: "Zara", url: "#" },
      { id: 3, name: "Oversized Blazer", brand: "& Other Stories", price: 149, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 89, retailer: "& Other Stories", url: "#" },
      { id: 4, name: "Gold Hoop Earrings", brand: "Mejuri", price: 78, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 86, retailer: "Mejuri", url: "#" },
      { id: 5, name: "Adidas Samba", brand: "Adidas", price: 100, image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80", match: 83, retailer: "Adidas", url: "#" },
      { id: 6, name: "Satin Slip Midi Skirt", brand: "Mango", price: 49, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 80, retailer: "Mango", url: "#" },
    ],
    "Classic / Timeless": [
      { id: 1, name: "Relaxed Linen Blazer", brand: "& Other Stories", price: 149, image: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80", match: 95, retailer: "& Other Stories", url: "#" },
      { id: 2, name: "Silk Blouse", brand: "Equipment", price: 228, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80", match: 92, retailer: "Equipment", url: "#" },
      { id: 3, name: "Slim Trench Coat", brand: "A.P.C.", price: 550, image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400&q=80", match: 89, retailer: "A.P.C.", url: "#" },
      { id: 4, name: "Pointed-Toe Pumps", brand: "Stuart Weitzman", price: 395, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 86, retailer: "Stuart Weitzman", url: "#" },
      { id: 5, name: "Classic Oxford Shirt", brand: "Brooks Brothers", price: 89, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 83, retailer: "Brooks Brothers", url: "#" },
      { id: 6, name: "Structured Crossbody", brand: "Mansur Gavriel", price: 395, image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&q=80", match: 80, retailer: "Mansur Gavriel", url: "#" },
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
      { id: 1, name: "Puffer Vest", brand: "Patagonia", price: 149, image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&q=80", match: 94, retailer: "Patagonia", url: "#" },
      { id: 2, name: "Polo Shirt", brand: "Lacoste", price: 95, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 91, retailer: "Lacoste", url: "#" },
      { id: 3, name: "Pleated Mini Skirt", brand: "Princess Polly", price: 49, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 88, retailer: "Princess Polly", url: "#" },
      { id: 4, name: "Colorblock Sneakers", brand: "New Balance", price: 110, image: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=80", match: 85, retailer: "New Balance", url: "#" },
      { id: 5, name: "Grosgrain Ribbon Headband", brand: "J.Crew", price: 28, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 82, retailer: "J.Crew", url: "#" },
      { id: 6, name: "Mini Tote Bag", brand: "L.L. Bean", price: 39, image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&q=80", match: 79, retailer: "L.L. Bean", url: "#" },
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
      { id: 1, name: "Flannel Overshirt", brand: "Levi's", price: 79, image: "https://images.unsplash.com/photo-1523205771623-e0faa4d2813d?w=400&q=80", match: 96, retailer: "Levi's", url: "#" },
      { id: 2, name: "Band Graphic Tee", brand: "Urban Outfitters", price: 34, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&q=80", match: 93, retailer: "Urban Outfitters", url: "#" },
      { id: 3, name: "1460 Mono Boots", brand: "Dr. Martens", price: 180, image: "https://images.unsplash.com/photo-1605812860427-4024433a70fd?w=400&q=80", match: 90, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "Ripped Slim Jeans", brand: "Levi's", price: 88, image: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400&q=80", match: 87, retailer: "Levi's", url: "#" },
      { id: 5, name: "Satin Slip Dress", brand: "& Other Stories", price: 99, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 84, retailer: "& Other Stories", url: "#" },
      { id: 6, name: "Oversized Plaid Cardigan", brand: "Mango", price: 69, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 81, retailer: "Mango", url: "#" },
    ],
    "70s-80s Retro": [
      { id: 1, name: "High-Waist Flared Trousers", brand: "& Other Stories", price: 109, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 95, retailer: "& Other Stories", url: "#" },
      { id: 2, name: "Wrap Midi Dress", brand: "Reformation", price: 178, image: "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400&q=80", match: 92, retailer: "Reformation", url: "#" },
      { id: 3, name: "Platform Wedge Sandals", brand: "Sam Edelman", price: 110, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 89, retailer: "Sam Edelman", url: "#" },
      { id: 4, name: "Oversized Tortoiseshell Sunglasses", brand: "Le Specs", price: 79, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 86, retailer: "Le Specs", url: "#" },
      { id: 5, name: "Vintage Logo Tee", brand: "Urban Outfitters", price: 38, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&q=80", match: 83, retailer: "Urban Outfitters", url: "#" },
      { id: 6, name: "Gold Layered Chains", brand: "Anthropologie", price: 48, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 80, retailer: "Anthropologie", url: "#" },
    ],
    "Vintage / Thrift": [
      { id: 1, name: "Washed Denim Jacket", brand: "Levi's", price: 98, image: "https://images.unsplash.com/photo-1523205771623-e0faa4d2813d?w=400&q=80", match: 94, retailer: "Levi's", url: "#" },
      { id: 2, name: "Floral Wrap Midi Dress", brand: "& Other Stories", price: 119, image: "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400&q=80", match: 90, retailer: "& Other Stories", url: "#" },
      { id: 3, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 180, image: "https://images.unsplash.com/photo-1605812860427-4024433a70fd?w=400&q=80", match: 87, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "90s Logo Cap", brand: "Tommy Hilfiger", price: 38, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 84, retailer: "Tommy Hilfiger", url: "#" },
      { id: 5, name: "Oversized Blazer", brand: "ASOS", price: 55, image: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80", match: 81, retailer: "ASOS", url: "#" },
      { id: 6, name: "Velvet Scrunchie Set", brand: "Urban Outfitters", price: 18, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 78, retailer: "Urban Outfitters", url: "#" },
    ],
    // ── BOLD & EXPRESSIVE ──
    "Maximalist": [
      { id: 1, name: "Printed Statement Coat", brand: "Zara", price: 159, image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400&q=80", match: 96, retailer: "Zara", url: "#" },
      { id: 2, name: "Mixed Print Dress", brand: "Farm Rio", price: 198, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 93, retailer: "Farm Rio", url: "#" },
      { id: 3, name: "Chunky Layered Necklace", brand: "Anthropologie", price: 68, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 90, retailer: "Anthropologie", url: "#" },
      { id: 4, name: "Colorful Platform Heels", brand: "Steve Madden", price: 110, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 87, retailer: "Steve Madden", url: "#" },
      { id: 5, name: "Beaded Statement Bag", brand: "Cult Gaia", price: 295, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&q=80", match: 84, retailer: "Cult Gaia", url: "#" },
      { id: 6, name: "Animal Print Blazer", brand: "ASOS", price: 75, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 81, retailer: "ASOS", url: "#" },
    ],
    "Glam / Party": [
      { id: 1, name: "Sequin Mini Dress", brand: "House of CB", price: 189, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 97, retailer: "House of CB", url: "#" },
      { id: 2, name: "Strappy Heeled Sandals", brand: "Stuart Weitzman", price: 395, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 94, retailer: "Stuart Weitzman", url: "#" },
      { id: 3, name: "Feather Trim Top", brand: "Zara", price: 79, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80", match: 90, retailer: "Zara", url: "#" },
      { id: 4, name: "Metallic Clutch Bag", brand: "ASOS", price: 45, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&q=80", match: 87, retailer: "ASOS", url: "#" },
      { id: 5, name: "Crystal Drop Earrings", brand: "Completedworks", price: 145, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 84, retailer: "Completedworks", url: "#" },
      { id: 6, name: "Satin Wide-Leg Trousers", brand: "Mango", price: 59, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 81, retailer: "Mango", url: "#" },
    ],
    "E-Girl / Alt": [
      { id: 1, name: "Striped Long-Sleeve Tee", brand: "Urban Outfitters", price: 38, image: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400&q=80", match: 95, retailer: "Urban Outfitters", url: "#" },
      { id: 2, name: "Plaid Mini Skirt", brand: "UNIF", price: 89, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 92, retailer: "UNIF", url: "#" },
      { id: 3, name: "Platform Combat Boots", brand: "Dr. Martens", price: 180, image: "https://images.unsplash.com/photo-1605812860427-4024433a70fd?w=400&q=80", match: 89, retailer: "Dr. Martens", url: "#" },
      { id: 4, name: "Chain Link Choker", brand: "ASOS", price: 15, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 86, retailer: "ASOS", url: "#" },
      { id: 5, name: "Black Fishnet Tights", brand: "Wolford", price: 35, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 83, retailer: "Wolford", url: "#" },
      { id: 6, name: "Graphic Alt Hoodie", brand: "Killstar", price: 65, image: "https://images.unsplash.com/photo-1556821840-3a63f15732ce?w=400&q=80", match: 80, retailer: "Killstar", url: "#" },
    ],
    // ── FORMAL & POWER ──
    "Office Siren": [
      { id: 1, name: "Power Shoulder Blazer", brand: "Zara", price: 99, image: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80", match: 96, retailer: "Zara", url: "#" },
      { id: 2, name: "Pencil Midi Skirt", brand: "Banana Republic", price: 89, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 93, retailer: "Banana Republic", url: "#" },
      { id: 3, name: "Silk Blouse", brand: "Equipment", price: 228, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80", match: 89, retailer: "Equipment", url: "#" },
      { id: 4, name: "Pointed-Toe Block Heels", brand: "Steve Madden", price: 99, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 86, retailer: "Steve Madden", url: "#" },
      { id: 5, name: "Structured Work Tote", brand: "Polene", price: 295, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 83, retailer: "Polene", url: "#" },
      { id: 6, name: "Minimal Gold Watch", brand: "Skagen", price: 145, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 80, retailer: "Skagen", url: "#" },
    ],
    "Occasion Wear": [
      { id: 1, name: "Midi Wrap Dress", brand: "Reformation", price: 218, image: "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400&q=80", match: 95, retailer: "Reformation", url: "#" },
      { id: 2, name: "Strappy Block Heels", brand: "Stuart Weitzman", price: 395, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 92, retailer: "Stuart Weitzman", url: "#" },
      { id: 3, name: "Satin Evening Clutch", brand: "Cult Gaia", price: 195, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&q=80", match: 89, retailer: "Cult Gaia", url: "#" },
      { id: 4, name: "Pearl Hoop Earrings", brand: "Completedworks", price: 195, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 86, retailer: "Completedworks", url: "#" },
      { id: 5, name: "Structured Blazer Dress", brand: "& Other Stories", price: 179, image: "https://images.unsplash.com/photo-1594938298603-c8148e4f4a24?w=400&q=80", match: 83, retailer: "& Other Stories", url: "#" },
      { id: 6, name: "Sheer Overlay Skirt", brand: "Mango", price: 69, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 80, retailer: "Mango", url: "#" },
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
      { id: 1, name: "Platform Chelsea Boots", brand: "Dr. Martens", price: 220, image: "https://images.unsplash.com/photo-1605812860427-4024433a70fd?w=400&q=80", match: 97, retailer: "Dr. Martens", url: "#" },
      { id: 2, name: "Velvet Mini Dress", brand: "Killstar", price: 89, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 94, retailer: "Killstar", url: "#" },
      { id: 3, name: "Layered Chain Choker", brand: "ASOS", price: 20, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 90, retailer: "ASOS", url: "#" },
      { id: 4, name: "PVC Structured Corset", brand: "Fenty", price: 120, image: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=400&q=80", match: 87, retailer: "Fenty", url: "#" },
      { id: 5, name: "Fishnet Layering Top", brand: "Wolford", price: 55, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80", match: 84, retailer: "Wolford", url: "#" },
      { id: 6, name: "Skull Print Tote", brand: "Alexander McQueen", price: 495, image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&q=80", match: 81, retailer: "Alexander McQueen", url: "#" },
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
      { id: 1, name: "Cowboy Boots", brand: "Ariat", price: 190, image: "https://images.unsplash.com/photo-1512374382149-233c42b6a83b?w=400&q=80", match: 97, retailer: "Ariat", url: "#" },
      { id: 2, name: "Wide-Brim Felt Hat", brand: "Lack of Color", price: 129, image: "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=400&q=80", match: 94, retailer: "Lack of Color", url: "#" },
      { id: 3, name: "Denim Fringe Jacket", brand: "Levi's", price: 148, image: "https://images.unsplash.com/photo-1523205771623-e0faa4d2813d?w=400&q=80", match: 91, retailer: "Levi's", url: "#" },
      { id: 4, name: "Embroidered Western Shirt", brand: "Wrangler", price: 79, image: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&q=80", match: 88, retailer: "Wrangler", url: "#" },
      { id: 5, name: "Leather Belt with Buckle", brand: "Ariat", price: 65, image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&q=80", match: 85, retailer: "Ariat", url: "#" },
      { id: 6, name: "Suede Fringe Bag", brand: "Free People", price: 128, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&q=80", match: 82, retailer: "Free People", url: "#" },
    ],
    "K-Fashion": [
      { id: 1, name: "Oversized Varsity Jacket", brand: "Maje", price: 349, image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&q=80", match: 95, retailer: "Maje", url: "#" },
      { id: 2, name: "Coordinated Mini Set", brand: "Ader Error", price: 280, image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80", match: 92, retailer: "Ader Error", url: "#" },
      { id: 3, name: "Platform Dad Sneakers", brand: "New Balance", price: 110, image: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=80", match: 89, retailer: "New Balance", url: "#" },
      { id: 4, name: "Pastel Cardigan", brand: "COS", price: 89, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&q=80", match: 86, retailer: "COS", url: "#" },
      { id: 5, name: "Mini Shoulder Bag", brand: "Marc Jacobs", price: 295, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=80", match: 83, retailer: "Marc Jacobs", url: "#" },
      { id: 6, name: "Pleated Midi Skirt", brand: "Reformation", price: 148, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 80, retailer: "Reformation", url: "#" },
    ],
    // ── EMERGING ──
    "Retro-Futurism": [
      { id: 1, name: "Metallic Moto Jacket", brand: "ASOS", price: 120, image: "https://images.unsplash.com/photo-1523205771623-e0faa4d2813d?w=400&q=80", match: 96, retailer: "ASOS", url: "#" },
      { id: 2, name: "Vinyl Flared Trousers", brand: "Zara", price: 69, image: "https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&q=80", match: 93, retailer: "Zara", url: "#" },
      { id: 3, name: "Holographic Platform Boots", brand: "Steve Madden", price: 130, image: "https://images.unsplash.com/photo-1605812860427-4024433a70fd?w=400&q=80", match: 90, retailer: "Steve Madden", url: "#" },
      { id: 4, name: "Silver Mirror Sunglasses", brand: "Le Specs", price: 69, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 87, retailer: "Le Specs", url: "#" },
      { id: 5, name: "Chrome Mini Bag", brand: "Coperni", price: 395, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&q=80", match: 84, retailer: "Coperni", url: "#" },
      { id: 6, name: "Asymmetric Top", brand: "Mango", price: 49, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80", match: 81, retailer: "Mango", url: "#" },
    ],
    "Historical Romanticism": [
      { id: 1, name: "Boned Corset Top", brand: "Vivienne Westwood", price: 395, image: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=400&q=80", match: 96, retailer: "Vivienne Westwood", url: "#" },
      { id: 2, name: "Velvet Midi Skirt", brand: "Free People", price: 148, image: "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=400&q=80", match: 93, retailer: "Free People", url: "#" },
      { id: 3, name: "Puffed Sleeve Blouse", brand: "& Other Stories", price: 89, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80", match: 90, retailer: "& Other Stories", url: "#" },
      { id: 4, name: "Victorian Lace Gloves", brand: "ASOS", price: 22, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 87, retailer: "ASOS", url: "#" },
      { id: 5, name: "Pearl Headband", brand: "Jennifer Behr", price: 95, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80", match: 84, retailer: "Jennifer Behr", url: "#" },
      { id: 6, name: "Mary Jane Block Heels", brand: "Reformation", price: 248, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80", match: 81, retailer: "Reformation", url: "#" },
    ],
    // ── LEGACY KEYS (map old names → closest new category) ──
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
        // Minimalist & Clean
        "Quiet Luxury",
        "Clean Girl",
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

STYLE TAXONOMY — definitions for all 35 supported aesthetics:

── MINIMALIST & CLEAN ──
- Quiet Luxury: Understated wealth signalling. Neutral palette (camel, cream, black, ivory, navy). Cashmere, quality wool, silk. No visible logos. Tailored or relaxed but always refined. Brands: The Row, Totême, Loro Piana.
- Clean Girl: Effortless polished minimalism. White tanks, wide-leg trousers, hoops, slicked buns, blazers. Off-white/black/beige palette. "No-makeup makeup" energy. Basics done flawlessly.
- Classic / Timeless: Structured, heritage-quality, investment dressing. Blazers, Oxford shirts, pencil skirts, trench coats, pumps. Navy/black/white/grey/camel. Endlessly polished.

── SOFT & FEMININE ──
- Coquette: Hyperfeminine romanticism. Bows, lace, pearls, satin slips, corset tops, Mary Janes. Dusty pink, cream, lilac, powder blue. Lana del Rey / Bridgerton energy. Evolving into Rococo Revival.
- Soft Girl / Kawaii: Pastel-cute, K-pop influenced. Cardigans, pleated mini skirts, heart clips, layered necklaces, cute sneakers. Baby pink, lavender, mint, peach. Gentle and playful.
- Pink Pilates / Wellness: Aspirational wellness aesthetic. Ballet-inspired athleisure, ribbed sets, tennis skirts, satin scrunchies. Blush pink, cream, mauve, dusty rose. Fitness meets fashion.
- Dark Feminine: Femme fatale confidence. Corsets, lace midi dresses, satin slips, black boots, statement earrings. Black, deep burgundy, forest green, dark navy. Villain-era energy.

── PREPPY & COLLEGIATE ──
- Old School Preppy: East Coast elite heritage. Oxford shirts, blazers, chinos, loafers, cable knits, pearl bracelets. Navy, white, green, red, burgundy, khaki. Country club / Ivy League.
- Modern Preppy: Gen Z preppy reinvention. Puffer vests, polo shirts, pleated minis, colourful accessories. Brighter, more playful than classic prep. Vibrant pastels + white.

── STREETWEAR & URBAN ──
- Streetwear / Hypebeast: Urban culture, sneaker drops, brand-forward. Graphic hoodies, cargo pants, oversized tees, rare sneakers, crossbody bags. Supreme, Off-White, Corteiz. Bold graphics and logos.
- Skatecore: Baggy and anti-fashion. Wide-leg jeans, graphic tees, Vans/DC shoes, caps, overshirts. Washed denim, black, white, earth tones. Skate brand logos. Relaxed and deliberate.
- Techwear: Utilitarian futurism. Technical jackets, cargo trousers, tactical vests, trail shoes, dark palette. ACRONYM, Veilance, Stone Island. Modular, functional, all-weather.
- Baddie: Glamorous urban confidence. Bodycon dresses, bodysuits, high heels, statement bags, fur coats. Black, nude, gold, animal print. Polished, form-fitting, bold makeup signals.

── NATURE & FANTASY ──
- Cottagecore: Pastoral romance. Prairie dresses, floral blouses, linen, crochet, aprons, straw hats. Sage, cream, dusty rose, terracotta. Slow-living, handmade-feeling.
- Dark Academia: Scholarly and moody. Tweed blazers, turtlenecks, plaid skirts, oxfords, knee socks, trench coats. Dark brown, forest green, burgundy, camel, charcoal. Library-core layering.
- Fairycore: Mystical and ethereal. Chiffon dresses, floral crowns, lace tights, platform boots, layered delicate jewellery. Forest green, mushroom brown, dusty purple, cream. Fantasy nature spirit.
- Gorpcore: Outdoor technical as everyday wear. Puffer jackets, fleece vests, cargo pants, trail shoes, beanies, fanny packs. Arc'teryx, Patagonia, The North Face. Earth tones + functional details.

── VINTAGE & RETRO ERAS ──
- Y2K: Early 2000s nostalgia. Low-rise jeans, tube tops, rhinestone belts, platform sandals, velour tracksuits, tiny bags. Hot pink, metallics, denim, neon pastels. Bedazzled and carefree.
- 90s Grunge: Dishevelled rebellion. Flannel shirts, band tees, ripped jeans, Doc Martens, slip dresses, cardigans. Black, plaid earth tones, faded denim, burgundy. Kurt Cobain energy.
- 70s-80s Retro: Decade nostalgia. Flared trousers, wrap dresses, platform shoes, vintage blazers, gold jewellery. Mustard, rust, olive, navy, metallics, warm earth tones. Disco to power dressing.
- Vintage / Thrift: Curated secondhand across any era. Heritage pieces, mixed-era layering, one-of-a-kind details. Washed/worn textures. Depop energy. Earth tones, muted brights.

── BOLD & EXPRESSIVE ──
- Maximalist: More is more. Clashing prints, bold layers, statement coats, loud accessories, eye-catching palette. Animal print, jewel tones, all brights. Dopamine dressing energy.
- Glam / Party: Evening and club wear. Sequin dresses, satin slips, feather trim, strappy heels, metallic bags. Gold, silver, deep red, rich jewel tones. Sequins and shine.
- E-Girl / Alt: Internet alt culture. Striped layering tees, plaid skirts, chunky boots, chains, heart makeup, alt accessories. Black, red, pastel accents. Anime meets emo.

── FORMAL & POWER DRESSING ──
- Office Siren: Polished work dressing with feminine edge. Pencil skirts, structured blazers, silk blouses, heels. Black, white, grey, navy, red. Corpcore / power dressing with sex appeal.
- Occasion Wear: Elegant event dressing. Midi dresses, structured coats, heels, clutch bags, statement earrings. Classic navy, black, ivory, rich colours. Semi-formal to formal.

── SPORT & ACTIVE ──
- Athleisure: Athletic pieces as everyday fashion. Leggings, sports bras, bombers, sneakers, track pants, zip-ups. Black, grey, white, bright accents. Performance fabrics in lifestyle context.
- Blokecore: Football culture as fashion. Football jerseys, wide-leg jorts, trainers, bucket hats, zip hoodies. Team colours, navy, black, white. British casual meets streetwear.

── COUNTERCULTURAL ──
- Goth: Dark subculture. All black, PVC/vinyl, chokers, platform boots, dark makeup, Victorian lace details, chains. Black, deep purple, blood red. 40+ year subculture.
- Grunge / Punk: Anti-fashion DIY spirit. Flannel, band tees, ripped denim, combat boots, leather jackets, safety pins, studded details. Black, plaid, faded denim. Rebellious and intentional.
- Bohemian: Free-spirited and artisanal. Flowy maxi dresses, crochet, fringe, layered jewellery, wide-brim hats, sandals. Rust, olive, warm brown, terracotta. Festival and travel energy.

── CULTURAL / REGIONAL ──
- Western / Americana: American West. Cowboy boots, wide-brim hats, denim jackets, fringe, plaid, leather belts. Denim blue, tan, red, brown, cream. Country music / Cowboycore.
- K-Fashion: Korean street fashion influence. Oversized varsity jackets, mini skirts, platform shoes, coordinated sets, cardigans. Pastel coordinates, black + white, school-uniform tones. K-pop / Ulzzang.

── EMERGING ──
- Retro-Futurism: Future-nostalgia. Metallic jackets, vinyl pants, bold asymmetric pieces, futuristic shoes. Silver, holographic, white, neon, chrome. Y3K energy, sci-fi inspired.
- Historical Romanticism: Wearable historical fantasy. Corsets, lace blouses, velvet midis, puffed sleeves, pearl headbands. Dusty pink, deep blue, ivory, gold, jewel tones. Regencycore / Castlecore.

CALIBRATION RULES:
- Complete the reasoning field fully before any classification field.
- Name specific visible items — not impressions or vibes.
- Base confidence ONLY on what is observable. Do not guess at hidden garments.
- If the image is partial, low-resolution, or ambiguous, lower confidence accordingly.
- If signals for two aesthetics are nearly equal, set confidence below 70 and populate secondaryAesthetic.
- Do not default to the most common category — classify from evidence only.
- Choose the MOST SPECIFIC matching category. Do not default to "Vintage / Thrift" when a more specific era (Y2K, 90s Grunge, 70s-80s Retro) fits better.
- Minimalist outfits: distinguish between Quiet Luxury (quality/heritage signals), Clean Girl (polished basics), and Classic / Timeless (structured tailoring).`;

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
