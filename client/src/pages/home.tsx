import React from "react";
import { useLocation } from "wouter";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { rankByVector, getTopAesthetics } from "@/lib/styleVector";
import OnboardingModal from "@/components/OnboardingModal";
import { getOrCreateUserId } from "@/lib/deviceId";

// ── Clothing SVG illustrations (same set as discover) ───────────────────────
const Icons: Record<string, JSX.Element> = {
  shirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M14 4 L8 10 L4 8 L2 18 L8 17 L8 36 L32 36 L32 17 L38 18 L36 8 L32 10 L26 4 Q23 8 20 8 Q17 8 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  pants: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M6 4 L34 4 L34 10 L26 10 L26 36 L20 36 L20 18 L20 36 L14 36 L14 10 L6 10 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  dress: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M15 4 Q20 8 25 4 L30 12 L26 14 L30 36 L10 36 L14 14 L10 12 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  shoes: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M4 28 L4 20 Q4 14 10 14 L18 14 L18 20 L28 20 Q36 20 36 26 L36 28 L16 28 Q12 28 12 32 L4 32 Q4 30 4 28Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  bag: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <rect x="6" y="14" width="28" height="22" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <path d="M14 14 Q14 6 20 6 Q26 6 26 14" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <line x1="6" y1="22" x2="34" y2="22" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  jacket: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M14 4 L8 10 L4 8 L2 20 L8 19 L8 36 L32 36 L32 19 L38 20 L36 8 L32 10 L26 4 Q23 9 20 9 Q17 9 14 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="20" y1="9" x2="20" y2="36" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  skirt: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <path d="M10 8 L30 8 L36 36 L4 36 Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="8" y1="14" x2="32" y2="14" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  accessory: (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="1.8" fill="none"/>
      <circle cx="20" cy="20" r="4" stroke="currentColor" strokeWidth="1.4" fill="none"/>
      <line x1="10" y1="10" x2="16" y2="16" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="30" y1="10" x2="24" y2="16" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="10" y1="30" x2="16" y2="24" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="30" y1="30" x2="24" y2="24" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
};

// ── Depop badge ──────────────────────────────────────────────────────────────
function DepopBadge() {
  return (
    <div className="flex items-center gap-1">
      <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FF2300" }}>
        <span className="text-white font-bold" style={{ fontSize: "9px", lineHeight: 1 }}>d</span>
      </div>
      <span className="text-[10px] text-muted-foreground">Depop</span>
    </div>
  );
}

// ── Data ─────────────────────────────────────────────────────────────────────
type IconKey = keyof typeof Icons;

interface FeedItem {
  id: number;
  label: string;
  icon: IconKey;
  query: string;
  aesthetic: string;
  gender: "male" | "female" | "both"; // used to filter by profile preference
  tag?: string; // "Match" | sale string
}

// Helper to get current gender preference
function getGenderPref(): "male" | "female" | "both" {
  try {
    const p = JSON.parse(localStorage.getItem("stitch_profile") || "{}");
    return (p.gender as "male" | "female" | "both") || "both";
  } catch { return "both"; }
}

const FEED_ITEMS: FeedItem[] = [
  // Minimalist — female-leaning but some both
  { id: 1,  label: "Linen Blazer Dress",        icon: "dress",     query: "linen blazer dress minimalist",            aesthetic: "Minimalist",       gender: "female", tag: "Match" },
  { id: 2,  label: "Wide Leg Trousers",          icon: "pants",     query: "wide leg trousers minimal beige women",    aesthetic: "Minimalist",       gender: "female" },
  { id: 3,  label: "Oversized White Tee",        icon: "shirt",     query: "oversized white t-shirt minimalist",       aesthetic: "Minimalist",       gender: "both" },
  { id: 49, label: "Slim Chino",                 icon: "pants",     query: "slim chino minimalist neutral men",        aesthetic: "Minimalist",       gender: "male" },
  { id: 50, label: "Linen Button-Down",          icon: "shirt",     query: "linen button down shirt men minimalist",   aesthetic: "Minimalist",       gender: "male" },
  // Streetwear
  { id: 4,  label: "990v6 Sneaker",              icon: "shoes",     query: "new balance 990 sneakers",                 aesthetic: "Streetwear",       gender: "both",  tag: "Match" },
  { id: 5,  label: "Graphic Hoodie",             icon: "shirt",     query: "graphic hoodie streetwear oversized men",  aesthetic: "Streetwear",       gender: "male" },
  { id: 6,  label: "Cargo Pants",                icon: "pants",     query: "cargo pants streetwear baggy men",         aesthetic: "Streetwear",       gender: "male" },
  { id: 7,  label: "Puffer Jacket",              icon: "jacket",    query: "puffer jacket streetwear",                 aesthetic: "Streetwear",       gender: "both" },
  { id: 51, label: "Cropped Hoodie",             icon: "shirt",     query: "cropped hoodie streetwear women",          aesthetic: "Streetwear",       gender: "female" },
  // Old Money
  { id: 8,  label: "Cashmere Crew Neck",         icon: "shirt",     query: "cashmere crew neck sweater men neutral",   aesthetic: "Old Money",        gender: "male",  tag: "-30%" },
  { id: 9,  label: "Pleated Wool Trousers",      icon: "pants",     query: "pleated wool trousers men old money",      aesthetic: "Old Money",        gender: "male" },
  { id: 10, label: "Leather Loafers",            icon: "shoes",     query: "leather loafers penny old money",          aesthetic: "Old Money",        gender: "both" },
  { id: 11, label: "Trench Coat",                icon: "jacket",    query: "trench coat classic camel men",            aesthetic: "Old Money",        gender: "male" },
  { id: 52, label: "Silk Blouse",                icon: "shirt",     query: "silk blouse old money women elegant",      aesthetic: "Old Money",        gender: "female" },
  // Clean Girl
  { id: 12, label: "Structured Tote",            icon: "bag",       query: "structured tote bag neutral",              aesthetic: "Clean Girl",       gender: "female" },
  { id: 13, label: "Ribbed Tank Top",            icon: "shirt",     query: "ribbed tank top clean girl neutral women", aesthetic: "Clean Girl",       gender: "female" },
  { id: 14, label: "High Waist Leggings",        icon: "pants",     query: "high waist leggings clean girl women",     aesthetic: "Clean Girl",       gender: "female" },
  // Dark Academia
  { id: 15, label: "Plaid Blazer",               icon: "jacket",    query: "plaid blazer dark academia",               aesthetic: "Dark Academia",    gender: "both" },
  { id: 16, label: "Oxford Brogues",             icon: "shoes",     query: "oxford brogues dark academia leather",     aesthetic: "Dark Academia",    gender: "both" },
  { id: 17, label: "Turtleneck Knit",            icon: "shirt",     query: "turtleneck knit dark academia brown men",  aesthetic: "Dark Academia",    gender: "male" },
  { id: 18, label: "Plaid Mini Skirt",           icon: "skirt",     query: "plaid mini skirt dark academia women",     aesthetic: "Dark Academia",    gender: "female" },
  { id: 53, label: "Wool Flat Cap",              icon: "accessory", query: "wool flat cap dark academia men",          aesthetic: "Dark Academia",    gender: "male" },
  // Cottagecore
  { id: 19, label: "Floral Midi Dress",          icon: "dress",     query: "floral midi dress cottagecore women",      aesthetic: "Cottagecore",      gender: "female" },
  { id: 20, label: "Puff Sleeve Blouse",         icon: "shirt",     query: "puff sleeve blouse cottagecore women",     aesthetic: "Cottagecore",      gender: "female" },
  { id: 21, label: "Lace-Trim Skirt",            icon: "skirt",     query: "lace trim skirt cottagecore women",        aesthetic: "Cottagecore",      gender: "female" },
  { id: 54, label: "Linen Overshirt",            icon: "shirt",     query: "linen overshirt cottagecore men natural",  aesthetic: "Cottagecore",      gender: "male" },
  // Y2K
  { id: 22, label: "Low Rise Jeans",             icon: "pants",     query: "low rise jeans y2k 2000s women",           aesthetic: "Y2K",              gender: "female" },
  { id: 23, label: "Butterfly Crop Top",         icon: "shirt",     query: "butterfly print crop top y2k women",       aesthetic: "Y2K",              gender: "female" },
  { id: 24, label: "Platform Sandals",           icon: "shoes",     query: "platform sandals y2k 2000s women",         aesthetic: "Y2K",              gender: "female" },
  { id: 25, label: "Mini Skirt & Tube Top",      icon: "skirt",     query: "tube top mini skirt y2k women",            aesthetic: "Y2K",              gender: "female", tag: "Match" },
  { id: 55, label: "Baggy Y2K Jeans",            icon: "pants",     query: "baggy jeans y2k 2000s men",                aesthetic: "Y2K",              gender: "male" },
  // Boho
  { id: 26, label: "Crochet Vest",               icon: "shirt",     query: "crochet vest boho festival women",         aesthetic: "Boho",             gender: "female" },
  { id: 27, label: "Maxi Wrap Skirt",            icon: "skirt",     query: "maxi wrap skirt boho print women",         aesthetic: "Boho",             gender: "female" },
  { id: 28, label: "Fringe Bag",                 icon: "bag",       query: "fringe crossbody bag boho",                aesthetic: "Boho",             gender: "both" },
  { id: 56, label: "Linen Drawstring Pants",     icon: "pants",     query: "linen drawstring pants boho men",          aesthetic: "Boho",             gender: "male" },
  // Romantic
  { id: 29, label: "Silk Wrap Dress",            icon: "dress",     query: "silk wrap dress elegant women",            aesthetic: "Romantic",         gender: "female" },
  { id: 30, label: "Pearl Drop Earrings",        icon: "accessory", query: "pearl drop earrings romantic women",       aesthetic: "Romantic",         gender: "female" },
  { id: 31, label: "Ruffle Midi Dress",          icon: "dress",     query: "ruffle midi dress romantic women",         aesthetic: "Romantic",         gender: "female" },
  // Grunge
  { id: 32, label: "Band Tee",                   icon: "shirt",     query: "vintage band tee grunge oversized",        aesthetic: "Grunge",           gender: "both" },
  { id: 33, label: "Distressed Jeans",           icon: "pants",     query: "distressed ripped jeans grunge",           aesthetic: "Grunge",           gender: "both" },
  { id: 34, label: "Combat Boots",               icon: "shoes",     query: "combat boots black lace up grunge",        aesthetic: "Grunge",           gender: "both" },
  { id: 35, label: "Leather Moto Jacket",        icon: "jacket",    query: "leather moto jacket grunge black",         aesthetic: "Grunge",           gender: "both",  tag: "Match" },
  // Business Casual
  { id: 36, label: "Tailored Blazer",            icon: "jacket",    query: "tailored blazer business casual men",      aesthetic: "Business Casual",  gender: "male" },
  { id: 37, label: "Straight Leg Trousers",      icon: "pants",     query: "straight leg trousers business casual men",aesthetic: "Business Casual",  gender: "male" },
  { id: 38, label: "Block Heel Mules",           icon: "shoes",     query: "block heel mules business casual women",   aesthetic: "Business Casual",  gender: "female" },
  { id: 57, label: "Oxford Button-Down",         icon: "shirt",     query: "oxford button down shirt men business",    aesthetic: "Business Casual",  gender: "male" },
  { id: 58, label: "Tailored Blazer Women",      icon: "jacket",    query: "tailored blazer women business casual",    aesthetic: "Business Casual",  gender: "female" },
  // Athleisure
  { id: 39, label: "Seamless Sports Set",        icon: "shirt",     query: "seamless sports set women athleisure",     aesthetic: "Athleisure",       gender: "female" },
  { id: 40, label: "Oversized Track Jacket",     icon: "jacket",    query: "track jacket oversized athleisure men",    aesthetic: "Athleisure",       gender: "male" },
  { id: 41, label: "Sporty Sneakers",            icon: "shoes",     query: "sporty sneakers white athleisure",         aesthetic: "Athleisure",       gender: "both" },
  { id: 59, label: "Athletic Shorts",            icon: "pants",     query: "athletic shorts men gym athleisure",       aesthetic: "Athleisure",       gender: "male" },
  // Hypebeast
  { id: 42, label: "Jordan 1 High",              icon: "shoes",     query: "jordan 1 high sneakers hypebeast",         aesthetic: "Hypebeast",        gender: "both" },
  { id: 43, label: "Logo Hoodie",                icon: "shirt",     query: "supreme off-white logo hoodie hype men",   aesthetic: "Hypebeast",        gender: "male" },
  { id: 44, label: "Techwear Pants",             icon: "pants",     query: "techwear cargo pants hypebeast men",       aesthetic: "Hypebeast",        gender: "male" },
  { id: 60, label: "Oversized Graphic Tee",      icon: "shirt",     query: "oversized graphic tee hype women",         aesthetic: "Hypebeast",        gender: "female" },
  // Coastal
  { id: 45, label: "Linen Shirt Dress",          icon: "dress",     query: "linen shirt dress coastal summer women",   aesthetic: "Coastal",          gender: "female" },
  { id: 46, label: "Wicker Tote",                icon: "bag",       query: "wicker basket tote coastal summer",        aesthetic: "Coastal",          gender: "both" },
  { id: 47, label: "Espadrille Sandals",         icon: "shoes",     query: "espadrille sandals coastal",               aesthetic: "Coastal",          gender: "both" },
  { id: 61, label: "Linen Shorts",               icon: "pants",     query: "linen shorts men coastal summer",          aesthetic: "Coastal",          gender: "male" },
  { id: 62, label: "Striped Nautical Tee",       icon: "shirt",     query: "striped nautical tee men coastal",         aesthetic: "Coastal",          gender: "male" },
  // Indie / Preppy
  { id: 48, label: "Corduroy Jacket",            icon: "jacket",    query: "corduroy jacket indie vintage men",        aesthetic: "Indie",            gender: "male" },
  { id: 63, label: "Corduroy Skirt",             icon: "skirt",     query: "corduroy mini skirt indie women",          aesthetic: "Indie",            gender: "female" },
  { id: 64, label: "Varsity Jacket",             icon: "jacket",    query: "varsity jacket preppy",                    aesthetic: "Preppy",           gender: "both" },
  { id: 65, label: "Polo Shirt",                 icon: "shirt",     query: "polo shirt preppy men",                    aesthetic: "Preppy",           gender: "male" },

  // Minimalist — expanded
  { id: 66, label: "Slip Dress",                 icon: "dress",     query: "slip dress minimalist neutral women",       aesthetic: "Minimalist",       gender: "female" },
  { id: 67, label: "Tailored Shorts",            icon: "pants",     query: "tailored shorts minimalist women",          aesthetic: "Minimalist",       gender: "female" },
  { id: 68, label: "Structured Tote",            icon: "bag",       query: "structured tote minimalist leather",        aesthetic: "Minimalist",       gender: "both" },
  { id: 69, label: "Wool Overcoat",              icon: "jacket",    query: "wool overcoat minimalist men camel",        aesthetic: "Minimalist",       gender: "male" },
  { id: 70, label: "Straight Leg Jeans",         icon: "pants",     query: "straight leg jeans minimalist white",       aesthetic: "Minimalist",       gender: "both" },

  // Streetwear — expanded
  { id: 71, label: "Balaclava",                  icon: "accessory", query: "balaclava streetwear knit",                 aesthetic: "Streetwear",       gender: "both" },
  { id: 72, label: "Baggy Jeans",                icon: "pants",     query: "baggy jeans streetwear men",                aesthetic: "Streetwear",       gender: "male" },
  { id: 73, label: "Bomber Jacket",              icon: "jacket",    query: "bomber jacket streetwear men",              aesthetic: "Streetwear",       gender: "both" },
  { id: 74, label: "Fitted Crop Tee",            icon: "shirt",     query: "fitted crop tee streetwear women",          aesthetic: "Streetwear",       gender: "female" },
  { id: 75, label: "High Top Sneakers",          icon: "shoes",     query: "high top sneakers streetwear",              aesthetic: "Streetwear",       gender: "both",  tag: "Match" },

  // Old Money — expanded
  { id: 76, label: "Equestrian Boots",           icon: "shoes",     query: "equestrian riding boots old money women",   aesthetic: "Old Money",        gender: "female" },
  { id: 77, label: "Boat Shoes",                 icon: "shoes",     query: "boat shoes leather old money men",          aesthetic: "Old Money",        gender: "male" },
  { id: 78, label: "Cable Knit Sweater",         icon: "shirt",     query: "cable knit sweater old money cream",        aesthetic: "Old Money",        gender: "both" },
  { id: 79, label: "Quilted Jacket",             icon: "jacket",    query: "quilted jacket old money women navy",       aesthetic: "Old Money",        gender: "female" },
  { id: 80, label: "Gold Chain Necklace",        icon: "accessory", query: "gold chain necklace old money",             aesthetic: "Old Money",        gender: "both" },

  // Y2K — expanded
  { id: 81, label: "Velour Tracksuit",           icon: "shirt",     query: "velour tracksuit y2k women",                aesthetic: "Y2K",              gender: "female" },
  { id: 82, label: "Rhinestone Belt",            icon: "accessory", query: "rhinestone belt y2k 2000s women",           aesthetic: "Y2K",              gender: "female" },
  { id: 83, label: "Baby Tee",                   icon: "shirt",     query: "baby tee y2k 2000s graphic women",          aesthetic: "Y2K",              gender: "female" },
  { id: 84, label: "Chunky Sneakers",            icon: "shoes",     query: "chunky platform sneakers y2k",              aesthetic: "Y2K",              gender: "both" },
  { id: 85, label: "Mini Skirt Denim",           icon: "skirt",     query: "denim mini skirt y2k women",                aesthetic: "Y2K",              gender: "female" },

  // Dark Academia — expanded
  { id: 86, label: "Knit Vest",                  icon: "shirt",     query: "knit vest dark academia argyle",            aesthetic: "Dark Academia",    gender: "both" },
  { id: 87, label: "Pleated Midi Skirt",         icon: "skirt",     query: "pleated midi skirt dark academia women",    aesthetic: "Dark Academia",    gender: "female" },
  { id: 88, label: "Wool Peacoat",               icon: "jacket",    query: "wool peacoat dark academia men",            aesthetic: "Dark Academia",    gender: "male" },
  { id: 89, label: "Satchel Bag",                icon: "bag",       query: "leather satchel bag dark academia",         aesthetic: "Dark Academia",    gender: "both" },
  { id: 90, label: "Corduroy Trousers",          icon: "pants",     query: "corduroy trousers dark academia men brown", aesthetic: "Dark Academia",    gender: "male" },

  // Boho — expanded
  { id: 91, label: "Kimono Duster",              icon: "jacket",    query: "kimono duster boho printed women",          aesthetic: "Boho",             gender: "female" },
  { id: 92, label: "Wide Brim Hat",              icon: "accessory", query: "wide brim hat boho straw",                  aesthetic: "Boho",             gender: "both" },
  { id: 93, label: "Tassel Earrings",            icon: "accessory", query: "tassel earrings boho statement",            aesthetic: "Boho",             gender: "female" },
  { id: 94, label: "Embroidered Dress",          icon: "dress",     query: "embroidered midi dress boho women",         aesthetic: "Boho",             gender: "female" },
  { id: 95, label: "Linen Pants Men",            icon: "pants",     query: "wide leg linen pants men boho neutral",     aesthetic: "Boho",             gender: "male" },

  // Coastal — expanded
  { id: 96, label: "Linen Trousers",             icon: "pants",     query: "linen trousers coastal women white",        aesthetic: "Coastal",          gender: "female" },
  { id: 97, label: "Terry Cloth Set",            icon: "shirt",     query: "terry cloth co-ord set coastal summer",     aesthetic: "Coastal",          gender: "both" },
  { id: 98, label: "Slip-On Loafer",             icon: "shoes",     query: "slip on loafer coastal leather",            aesthetic: "Coastal",          gender: "both" },
  { id: 99, label: "Linen Blazer",               icon: "jacket",    query: "linen blazer coastal men unstructured",     aesthetic: "Coastal",          gender: "male" },
  { id: 100, label: "Raffia Bag",                icon: "bag",       query: "raffia bag coastal summer women",           aesthetic: "Coastal",          gender: "female" },

  // Clean Girl — expanded
  { id: 101, label: "Satin Midi Skirt",          icon: "skirt",     query: "satin midi skirt clean girl women",         aesthetic: "Clean Girl",       gender: "female" },
  { id: 102, label: "Gold Hoop Earrings",        icon: "accessory", query: "gold hoop earrings clean girl",             aesthetic: "Clean Girl",       gender: "female" },
  { id: 103, label: "Fitted Blazer",             icon: "jacket",    query: "fitted blazer clean girl women neutral",    aesthetic: "Clean Girl",       gender: "female" },
  { id: 104, label: "White Sneakers",            icon: "shoes",     query: "white leather sneakers clean minimal",      aesthetic: "Clean Girl",       gender: "both" },

  // Grunge — expanded
  { id: 105, label: "Sheer Mesh Top",            icon: "shirt",     query: "sheer mesh top grunge women layered",       aesthetic: "Grunge",           gender: "female" },
  { id: 106, label: "Plaid Flannel Shirt",       icon: "shirt",     query: "plaid flannel shirt grunge men",            aesthetic: "Grunge",           gender: "both" },
  { id: 107, label: "Dr Martens 1460",           icon: "shoes",     query: "dr martens 1460 boots grunge",              aesthetic: "Grunge",           gender: "both",  tag: "Match" },
  { id: 108, label: "Studded Belt",              icon: "accessory", query: "studded belt grunge punk",                  aesthetic: "Grunge",           gender: "both" },
  { id: 109, label: "Ripped Fishnet Tights",     icon: "accessory", query: "fishnet tights grunge women",               aesthetic: "Grunge",           gender: "female" },

  // Athleisure — expanded
  { id: 110, label: "Yoga Flare Leggings",       icon: "pants",     query: "flare leggings yoga athleisure women",      aesthetic: "Athleisure",       gender: "female" },
  { id: 111, label: "Quarter-Zip Pullover",      icon: "shirt",     query: "quarter zip pullover men athleisure",       aesthetic: "Athleisure",       gender: "male" },
  { id: 112, label: "Running Vest",              icon: "jacket",    query: "running vest athletic lightweight",          aesthetic: "Athleisure",       gender: "both" },
  { id: 113, label: "Crossbody Gym Bag",         icon: "bag",       query: "crossbody gym bag athleisure",              aesthetic: "Athleisure",       gender: "both" },

  // Hypebeast — expanded
  { id: 114, label: "Patchwork Denim Jacket",    icon: "jacket",    query: "patchwork denim jacket hypebeast",          aesthetic: "Hypebeast",        gender: "both" },
  { id: 115, label: "Bucket Hat",                icon: "accessory", query: "bucket hat hype streetwear",                aesthetic: "Hypebeast",        gender: "both" },
  { id: 116, label: "Boxy Tee",                  icon: "shirt",     query: "boxy oversized tee hypebeast drop shoulder",aesthetic: "Hypebeast",        gender: "both" },
  { id: 117, label: "Chunky Chain",              icon: "accessory", query: "chunky chain necklace hypebeast men",       aesthetic: "Hypebeast",        gender: "male" },

  // Romantic — expanded
  { id: 118, label: "Lace Corset Top",           icon: "shirt",     query: "lace corset top romantic women",            aesthetic: "Romantic",         gender: "female" },
  { id: 119, label: "Floral Maxi Dress",         icon: "dress",     query: "floral maxi dress romantic women",          aesthetic: "Romantic",         gender: "female" },
  { id: 120, label: "Mary Jane Heels",           icon: "shoes",     query: "mary jane heels romantic women",            aesthetic: "Romantic",         gender: "female" },

  // Preppy — expanded
  { id: 121, label: "Cable Knit Cardigan",       icon: "shirt",     query: "cable knit cardigan preppy women",          aesthetic: "Preppy",           gender: "female" },
  { id: 122, label: "Plaid Trousers",            icon: "pants",     query: "plaid trousers preppy men",                 aesthetic: "Preppy",           gender: "male" },
  { id: 123, label: "Boat Neck Sweater",         icon: "shirt",     query: "boat neck sweater preppy women",            aesthetic: "Preppy",           gender: "female" },
  { id: 124, label: "Loafer Flats",              icon: "shoes",     query: "loafer flats preppy women",                 aesthetic: "Preppy",           gender: "female" },

  // Indie — expanded
  { id: 125, label: "Thrifted Denim Vest",       icon: "jacket",    query: "denim vest indie thrifted vintage",          aesthetic: "Indie",            gender: "both" },
  { id: 126, label: "Flared Jeans",              icon: "pants",     query: "flared jeans indie 70s women",              aesthetic: "Indie",            gender: "female" },
  { id: 127, label: "Graphic Crewneck",          icon: "shirt",     query: "vintage graphic crewneck indie men",        aesthetic: "Indie",            gender: "male" },
  { id: 128, label: "Platform Boots",            icon: "shoes",     query: "platform boots indie women",                aesthetic: "Indie",            gender: "female" },
  { id: 129, label: "Beaded Bag",                icon: "bag",       query: "beaded mini bag indie women",               aesthetic: "Indie",            gender: "female" },
  { id: 130, label: "Cottagecore Cardigan",      icon: "shirt",     query: "floral embroidered cardigan cottagecore women", aesthetic: "Cottagecore",   gender: "female" },
  { id: 131, label: "Lace Midi Dress",           icon: "dress",     query: "lace midi dress cottagecore women white",   aesthetic: "Cottagecore",      gender: "female" },
  { id: 132, label: "Straw Boater Hat",          icon: "accessory", query: "straw boater hat cottagecore women",        aesthetic: "Cottagecore",      gender: "female" },
  { id: 133, label: "Business Casual Dress",     icon: "dress",     query: "sheath dress business casual women",        aesthetic: "Business Casual",  gender: "female" },
  { id: 134, label: "Chelsea Boots",             icon: "shoes",     query: "chelsea boots business casual men",         aesthetic: "Business Casual",  gender: "male",  tag: "Match" },
  { id: 135, label: "Slim Fit Suit",             icon: "jacket",    query: "slim fit suit business casual men",         aesthetic: "Business Casual",  gender: "male" },
];


const CHIPS = ["Fits", "Minimal", "Coastal", "Dark Academia", "Streetwear", "Trending"];

// Map chip label → aesthetic value(s) in FEED_ITEMS
const CHIP_AESTHETIC_MAP: Record<string, string[]> = {
  "Minimal":    ["Minimalist"],
  "Coastal":    ["Coastal"],
  "Dark Academia": ["Dark Academia"],
  "Streetwear": ["Streetwear"],
  "Old Money":  ["Old Money"],
  "Y2K":        ["Y2K"],
  "Boho":       ["Boho"],
  "Grunge":     ["Grunge"],
  "Clean Girl": ["Clean Girl"],
  "Romantic":   ["Romantic"],
  "Hypebeast":  ["Hypebeast"],
  "Athleisure": ["Athleisure"],
  "Business Casual": ["Business Casual"],
  "Preppy":     ["Preppy"],
  "Indie":      ["Indie"],
  "Cottagecore":["Cottagecore"],
};

export default function HomePage() {
  const [, setLocation] = useLocation();
  const [activeChip, setActiveChip] = useState("Fits");

  // Gender-filter + vector-rank (used for initial state only; updates go via setRankedItems)
  const rerank = useCallback(() => {
    const g = getGenderPref();
    const filtered = g === "both"
      ? FEED_ITEMS
      : FEED_ITEMS.filter(item => item.gender === g || item.gender === "both");
    return rankByVector(filtered);
  }, []);

  // Track gender pref as state so depop-feed useEffect re-runs when it changes
  const [genderPref, setGenderPref] = useState<"male" | "female" | "both">(getGenderPref);
  const [rankedItems, setRankedItems] = useState<FeedItem[]>(rerank);
  const [depopCards, setDepopCards] = useState<any[]>([]);
  const [forYouCards, setForYouCards] = useState<any[]>([]);
  const [forYouLoading, setForYouLoading] = useState(false);
  const [forYouOnboarded, setForYouOnboarded] = useState<boolean | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const PULL_THRESHOLD = 72; // px needed to trigger refresh

  // Re-rank on mount
  useEffect(() => {
    setRankedItems(rerank());
  }, [rerank]);

  // Re-rank on vector updates
  useEffect(() => {
    const handler = () => setRankedItems(rerank());
    window.addEventListener("stitch_vector_updated", handler);
    return () => window.removeEventListener("stitch_vector_updated", handler);
  }, [rerank]);

  // Local-vector aesthetic names → depop cache names (normalise before sending)
  const VECTOR_TO_CACHE: Record<string, string> = {
    "Coastal": "Minimalist",       // no "Coastal" cache — use Minimalist
    "Clean Girl": "Minimalist",    // female-only → remap
    "Hypebeast": "Streetwear",
    "Indie": "Grunge",
    "Athleisure": "Streetwear",
    "Business Casual": "Old Money",
    "Romantic": "Vintage",
  };
  // Female-only aesthetics — strip from depop-feed request for male users
  const FEMALE_ONLY_CLIENT = new Set(["Coquette","Soft Girl","Cottagecore","Coastal Grandmother","E-Girl","Clean Girl","Balletcore","Romantic","Fairycore"]);

  // When profile updates (gender change), re-read gender pref into state → triggers re-fetch
  useEffect(() => {
    const onProfileUpdated = () => {
      const newGender = getGenderPref();
      setGenderPref(newGender);
      // Also re-rank the FEED_ITEMS chips with new gender
      const filtered = newGender === "both"
        ? FEED_ITEMS
        : FEED_ITEMS.filter(item => item.gender === newGender || item.gender === "both");
      setRankedItems(rankByVector(filtered));
    };
    window.addEventListener("stitch_profile_updated", onProfileUpdated);
    return () => window.removeEventListener("stitch_profile_updated", onProfileUpdated);
  }, []);

  // Fetch cached Depop cards for home feed
  // Re-runs whenever genderPref changes (via state above)
  useEffect(() => {
    const rawTops = getTopAesthetics(3);
    // Normalise local vector aesthetic names to depop cache names, then gender-filter
    const tops = rawTops
      .map(a => VECTOR_TO_CACHE[a] ?? a)
      .filter(a => genderPref !== "male" || !FEMALE_ONLY_CLIENT.has(a))
      .filter((a, i, arr) => arr.indexOf(a) === i); // dedupe after remap
    const params = new URLSearchParams();
    if (tops.length) params.set("aesthetics", JSON.stringify(tops));
    params.set("userId", userId);
    params.set("gender", genderPref);
    const url = `/api/depop-feed?${params.toString()}`;

    let retryTimer: ReturnType<typeof setTimeout>;

    const fetchCards = (attempt = 0) => {
      fetch(url)
        .then(r => r.json())
        .then(data => {
          const listings: any[] = data.listings || [];
          // Images + price is enough — titles get derived server-side from slug or query
          const hasRealData = listings.some((l: any) => l.image && l.price > 0);
          if (hasRealData) {
            setDepopCards(listings);
          } else if (attempt < 6) {
            // Either seeding or stale cache — retry every 20s (up to 2 minutes)
            retryTimer = setTimeout(() => fetchCards(attempt + 1), 20_000);
          }
        })
        .catch(() => {});
    };

    fetchCards();

    // Re-fetch when a new analysis completes (pre-warm may have added new cards)
    const onDepopUpdated = () => {
      clearTimeout(retryTimer);
      // Wait 90s for pre-warm to finish, then refresh
      retryTimer = setTimeout(() => fetchCards(0), 90_000);
    };
    window.addEventListener("stitch_depop_updated", onDepopUpdated);

    return () => {
      clearTimeout(retryTimer);
      window.removeEventListener("stitch_depop_updated", onDepopUpdated);
    };
  }, [genderPref]); // re-run whenever gender changes

  // ── For You: check onboarding + load personalized cards ─────────────────
  const userId = getOrCreateUserId();
  useEffect(() => {
    fetch(`/api/user-profile/${userId}`)
      .then(r => r.json())
      .then(data => {
        setForYouOnboarded(data.onboarded ?? false);
        if (data.onboarded) {
          // Sync gender to server so both home + fits feeds filter correctly
          try {
            const profile = JSON.parse(localStorage.getItem("stitch_profile") || "{}");
            const gender: string = (profile as any).gender || "both";
            fetch(`/api/user-gender/${userId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ gender }),
            }).catch(() => {});
          } catch {}
          // Load personalized cards
          setForYouLoading(true);
          return fetch(`/api/for-you/${userId}?offset=0`)
            .then(r => r.json())
            .then(d => {
              setForYouCards(d.items || []);
              setForYouLoading(false);
            });
        }
      })
      .catch(() => setForYouOnboarded(false));
  }, [userId]);

  // When user completes onboarding, reload For You cards
  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setForYouOnboarded(true);
    setForYouLoading(true);
    fetch(`/api/for-you/${userId}?offset=0`)
      .then(r => r.json())
      .then(d => { setForYouCards(d.items || []); setForYouLoading(false); })
      .catch(() => setForYouLoading(false));
  };

  // Derive visible feed from active chip
  const feedItems = useMemo(() => {
    if (activeChip === "Fits") return rankedItems;
    if (activeChip === "Trending") {
      // Match-tagged items first, then top-scored items, capped at 20
      const matches = rankedItems.filter(i => i.tag === "Match");
      const rest = rankedItems.filter(i => i.tag !== "Match");
      return [...matches, ...rest].slice(0, 20);
    }
    const aesthetics = CHIP_AESTHETIC_MAP[activeChip] ?? [activeChip];
    const filtered = rankedItems.filter(i => aesthetics.includes(i.aesthetic));
    // Fall back to full list if nothing matches
    return filtered.length > 0 ? filtered : rankedItems;
  }, [activeChip, rankedItems]);

  // Personalised greeting — filter female-only aesthetics for male users
  const [topAesthetic] = useState<string | null>(() => {
    if (!localStorage.getItem("stitch_quiz_done")) return null;
    const gender = getGenderPref();
    const tops = getTopAesthetics(5); // get more so we have fallbacks
    for (const a of tops) {
      if (gender !== "male" || !FEMALE_ONLY_CLIENT.has(a)) return a;
      const remapped = VECTOR_TO_CACHE[a]; // use remap if available
      if (remapped) return remapped;
    }
    return tops[0] ?? null;
  });

  // Pull-to-refresh: reload the For You feed + re-rank
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRankedItems(rerank());
    if (forYouOnboarded) {
      try {
        const d = await fetch(`/api/for-you/${userId}?offset=0`).then(r => r.json());
        setForYouCards(d.items || []);
      } catch {}
    }
    setIsRefreshing(false);
    setPullDistance(0);
  }, [isRefreshing, rerank, forYouOnboarded, userId]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return;
    // Only trigger if at the very top of the page
    if (window.scrollY > 0) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) setPullDistance(Math.min(dy * 0.45, PULL_THRESHOLD + 20));
  }, [isRefreshing]);

  const onTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD) {
      handleRefresh();
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, handleRefresh]);

  // User's name from profile
  const userName = (() => {
    try {
      const profile = JSON.parse(localStorage.getItem("stitch_profile") || "{}");
      return profile.name as string | undefined;
    } catch { return undefined; }
  })();

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const greetingLine = userName ? `${greeting}, ${userName}` : greeting;

  // Dynamic chips — put user's top aesthetic first if available
  const chips = topAesthetic
    ? ["Fits", topAesthetic, ...CHIPS.filter(c => c !== "Fits" && c !== topAesthetic).slice(0, 4)]
    : CHIPS;

  // Section label under chips
  const sectionLabel = activeChip === "Fits" ? "Fits"
    : activeChip === "Trending" ? "Trending Now"
    : activeChip;

  return (
    <div
      className="fade-up"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div
        style={{
          height: pullDistance > 0 ? `${pullDistance}px` : isRefreshing ? "48px" : "0px",
          overflow: "hidden",
          transition: pullDistance === 0 ? "height 0.25s ease" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{
          opacity: isRefreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD, 1),
          transform: isRefreshing ? "none" : `rotate(${(pullDistance / PULL_THRESHOLD) * 180}deg)`,
          transition: isRefreshing ? "none" : "transform 0.1s",
          color: "hsl(var(--primary))",
        }}>
          {isRefreshing ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 0.8s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7-7 7 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Greeting + chips — contained */}
      <div className="max-w-4xl mx-auto">
        <div className="px-5 sm:px-8 pt-5 sm:pt-7 pb-3">
          <h1 className="font-display text-3xl sm:text-4xl text-foreground leading-tight">
            {greetingLine}
          </h1>
        </div>

        {/* Aesthetic chips */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-5 sm:px-8 pb-3">
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => setActiveChip(c)}
              className={`px-3.5 py-1.5 rounded-full flex-shrink-0 transition-all font-ui text-[10px] tracking-widest uppercase ${
                activeChip === c
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground border border-border hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Section label */}
        <div className="px-5 sm:px-8 flex items-center justify-between mb-0 pb-3">
          <span className="font-label text-[10px] text-foreground">{sectionLabel}</span>
          {activeChip === "Fits" && forYouOnboarded && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">Personalized</span>
          )}
          {activeChip === "Fits" && forYouOnboarded === false && (
            <button
              onClick={() => setShowOnboarding(true)}
              className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-white font-medium"
            >
              Set up →
            </button>
          )}
          {activeChip !== "Fits" && feedItems.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{feedItems.length} item{feedItems.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>

      {/* ── Fits Grid (vector-personalized) ── */}
      {activeChip === "Fits" && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-px" style={{ background: "hsl(var(--border))" }}>
          {/* Not onboarded yet — show setup CTA + trending teaser */}
          {forYouOnboarded === false && (
            <>
              <div className="col-span-2 md:col-span-3 bg-background px-5 py-4 flex items-center justify-between border-b border-border/40">
                <p className="text-muted-foreground text-xs" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                  Personalise your feed
                </p>
                <button
                  onClick={() => setShowOnboarding(true)}
                  className="px-4 py-1.5 rounded-full text-xs font-medium text-white flex-shrink-0"
                  style={{ background: "#5088B8", fontFamily: "'Jost', sans-serif", letterSpacing: "0.06em" }}
                >
                  Set up taste →
                </button>
              </div>
              {/* Teaser: use real depop cards so links go to actual products */}
              {depopCards.slice(0, 6).map((card: any, idx: number) => (
                <a
                  key={card.url || idx}
                  href={card.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative bg-background hover:bg-muted/30 transition-colors cursor-pointer block group overflow-hidden"
                >
                  <div className="absolute top-2.5 left-2.5 z-10 text-[9px] px-2 py-0.5 rounded-full bg-foreground/80 text-background font-medium backdrop-blur-sm">Shop</div>
                  <div
                    className="w-full aspect-[3/4] bg-cover bg-center bg-muted group-hover:scale-[1.02] transition-transform duration-500"
                    style={{ backgroundImage: `url('${card.image}')` }}
                  />
                  <div className="px-2.5 pb-2.5 pt-1.5 bg-background">
                    <p className="text-[11px] font-medium text-foreground leading-tight line-clamp-2">{card.title}</p>
                    {card.price > 0 && <p className="text-[11px] text-primary font-semibold mt-0.5">${card.price.toFixed(0)}</p>}
                  </div>
                </a>
              ))}
            </>
          )}

          {/* Loading */}
          {forYouOnboarded === true && forYouLoading && (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-background animate-pulse">
                <div className="w-full aspect-[3/4] bg-muted" />
                <div className="px-3 pb-3 pt-2 space-y-1.5">
                  <div className="h-2 w-12 bg-muted rounded" />
                  <div className="h-3 w-3/4 bg-muted rounded" />
                  <div className="h-3 w-1/3 bg-muted rounded" />
                </div>
              </div>
            ))
          )}

          {/* ── Affiliate card — always first ─────────────────────────────── */}
          {forYouOnboarded === true && !forYouLoading && (
            <a
              href="https://sovrn.co/ccalx03"
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="relative bg-background hover:bg-muted/30 transition-colors cursor-pointer block group overflow-hidden"
            >
              <div className="absolute top-2.5 left-2.5 z-10 text-[9px] px-2 py-0.5 rounded-full bg-foreground/80 text-background font-medium backdrop-blur-sm">Sponsored</div>
              <div className="w-full aspect-[3/4] bg-muted flex items-center justify-center overflow-hidden">
                <img
                  src="https://images.unsplash.com/photo-1483985988355-763728e1935b?w=400&q=80"
                  alt="Shop fashion"
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                />
              </div>
              <div className="px-3 pb-3 pt-2">
                <p className="font-label text-[9px] text-muted-foreground mb-0.5 uppercase tracking-widest" style={{ fontSize: "9px" }}>Featured</p>
                <p className="text-xs text-foreground font-medium leading-snug mb-1 line-clamp-2">Discover more styles on Depop</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-primary font-semibold">Shop Now</p>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0 ml-auto">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </div>
              </div>
            </a>
          )}

          {/* Personalized cards */}
          {forYouOnboarded === true && !forYouLoading && forYouCards.map((item: any, idx: number) => {
            const showAffiliate = false; // handled above now
            const imageUrl = item.image || "";
            const price = item.price?.priceAmount ?? item.price ?? null;
            // Prefer the stored product URL, then slug fallback, never the search fallback
            const depopUrl = item.url?.startsWith("https://www.depop.com/products/")
              ? item.url
              : item.slug
              ? `https://www.depop.com/products/${item.slug}/`
              : `https://www.depop.com/search/?q=${encodeURIComponent(item.title || "")}`;

            return (
              <a
                key={item.id || idx}
                href={depopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative bg-background hover:bg-muted/30 transition-colors cursor-pointer block group overflow-hidden"
              >
                <div className="absolute top-2.5 left-2.5 z-10 text-[9px] px-2 py-0.5 rounded-full bg-foreground/80 text-background font-medium backdrop-blur-sm">Shop</div>
                {imageUrl ? (
                  <div
                    className="w-full aspect-[3/4] bg-cover bg-center bg-muted group-hover:scale-[1.02] transition-transform duration-500"
                    style={{ backgroundImage: `url('${imageUrl}')` }}
                  />
                ) : (
                  <div className="w-full aspect-[3/4] bg-muted flex items-center justify-center text-muted-foreground/30">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  </div>
                )}
                <div className="px-3 pb-3 pt-2">
                  <p className="font-label text-[9px] text-muted-foreground mb-0.5 uppercase tracking-widest" style={{ fontSize: "9px" }}>
                    {item._aesthetic || "Depop"}
                  </p>
                  <p className="text-xs text-foreground font-medium leading-snug mb-1 line-clamp-2">{item.title}</p>
                  <div className="flex items-center justify-between">
                    {price && <p className="text-xs text-primary font-semibold">${parseFloat(price).toFixed(0)}</p>}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0 ml-auto">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </div>
                </div>
              </a>
            );
          })}

          {/* Empty state after load */}
          {forYouOnboarded === true && !forYouLoading && forYouCards.length === 0 && (
            <div className="col-span-2 md:col-span-3 flex flex-col items-center justify-center py-16 gap-3 bg-background">
              <p className="text-muted-foreground text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>No results yet.</p>
              <button onClick={() => setShowOnboarding(true)} className="text-primary text-sm underline" style={{ fontFamily: "'Jost', sans-serif" }}>Retune taste</button>
            </div>
          )}
        </div>
      )}

      {/* ── Default Grid (non-For You chips) ── */}
      {activeChip !== "Fits" && (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px" style={{ background: "hsl(var(--border))" }}>
        {feedItems.map((item, idx) => {
          // 1-to-1 mapping: never cycle/repeat — just show as many cards as we have
          const card = depopCards.length > idx ? depopCards[idx] : null;

          if (!card) {
            return (
              <div key={item.id} className="bg-background animate-pulse">
                <div className="w-full aspect-[3/4] bg-muted" />
                <div className="px-3 pb-3 pt-2 space-y-1.5">
                  <div className="h-2 w-12 bg-muted rounded" />
                  <div className="h-3 w-3/4 bg-muted rounded" />
                  <div className="h-3 w-1/3 bg-muted rounded" />
                </div>
              </div>
            );
          }

          return (
            <a
              key={item.id}
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              className="relative bg-background hover:bg-muted/30 transition-colors cursor-pointer block group overflow-hidden"
            >
              <div className="absolute top-2.5 left-2.5 z-10 text-[9px] px-2 py-0.5 rounded-full bg-foreground/80 text-background font-medium backdrop-blur-sm">Shop</div>
              <div
                className="w-full aspect-[3/4] bg-cover bg-center bg-muted group-hover:scale-[1.02] transition-transform duration-500"
                style={{ backgroundImage: `url('${card.image}')` }}
              />
              <div className="px-3 pb-3 pt-2">
                <p className="font-label text-[9px] text-muted-foreground mb-0.5" style={{ letterSpacing: '0.14em' }}>{card.brand || item.aesthetic}</p>
                <p className="text-xs text-foreground font-medium leading-snug mb-1 line-clamp-2">{card.title || item.label}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-primary font-semibold">${card.price?.toFixed(0)}</p>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </div>
              </div>
            </a>
          );
        })}
      </div>
      )}
      {/* Onboarding Modal */}
      {showOnboarding && (
        <OnboardingModal
          userId={userId}
          onComplete={handleOnboardingComplete}
          onClose={() => setShowOnboarding(false)}
        />
      )}
    </div>
  );
}