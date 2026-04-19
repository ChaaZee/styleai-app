import type { Express } from "express";
import type { Server } from "http";
import { storage, initDB } from "./storage";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import multer from "multer";

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Mock product results for MVP (replace with Skimlinks affiliate API)

// Maps a product name to relevant Unsplash search keywords
function buildImageKeywords(name: string): string {
  const n = name.toLowerCase();
  const map: [string[], string][] = [
    [["sneaker", "trainer", "air force", "stan smith", "vans", "converse", "jordan"], "photo-1542291026-7eec264c27ff"],
    [["boot", "chelsea", "combat", "lug-sole", "doc marten"], "photo-1543163521-1bf539c55dd2"],
    [["loafer", "oxford shoe", "derby", "dress shoe", "mule", "pump", "heel"], "photo-1582588678413-dbf45f4823e9"],
    [["sandal", "slide", "flip flop"], "photo-1603808033176-9d134e6f4b71"],
    [["hoodie", "sweatshirt"], "photo-1556821840-3a63f15732ce"],
    [["cardigan", "knitwear", "knit", "sweater", "pullover", "crewneck", "turtleneck"], "photo-1576566588028-4147f3842f27"],
    [["blazer", "suit jacket", "sport coat"], "photo-1594938298603-c8148e4f4a24"],
    [["jacket", "coat", "trench", "parka", "anorak", "bomber", "puffer", "windbreaker", "vest"], "photo-1539533018447-63fcce2678e3"],
    [["shirt", "button-down", "oxford shirt", "flannel", "polo", "henley", "overshirt"], "photo-1596755094514-f87e34085b2c"],
    [["tee", "t-shirt", "tank", "crop top", "tube top", "blouse", "camisole"], "photo-1598300042247-d088f8ab3a91"],
    [["corset", "bustier"], "photo-1515372039744-b8f02a3ae446"],
    [["jean", "denim"], "photo-1624378439575-d8705ad7ae80"],
    [["trouser", "chino", "pant", "cargo", "jogger", "slack", "wide-leg", "flare"], "photo-1506629082955-511b1aa562c8"],
    [["skirt", "mini skirt", "midi skirt", "maxi skirt"], "photo-1515372039744-b8f02a3ae446"],
    [["short", "bermuda"], "photo-1506629082955-511b1aa562c8"],
    [["dress", "midi", "maxi", "wrap dress", "slip dress"], "photo-1515372039744-b8f02a3ae446"],
    [["bag", "tote", "clutch", "crossbody", "backpack", "purse", "satchel", "pouch"], "photo-1548036328-c9fa89d128fa"],
    [["watch"], "photo-1523275335684-37898b6baf30"],
    [["necklace", "chain", "choker", "pendant"], "photo-1515562141207-7a88fb7ce338"],
    [["earring", "hoop", "stud", "drop earring"], "photo-1515562141207-7a88fb7ce338"],
    [["bracelet", "bangle", "cuff"], "photo-1515562141207-7a88fb7ce338"],
    [["ring"], "photo-1515562141207-7a88fb7ce338"],
    [["sunglasses", "shades", "glasses"], "photo-1511499767150-a48a237f0083"],
    [["hat", "cap", "beanie", "bucket hat", "beret", "balaclava"], "photo-1521369909029-2afed882baee"],
    [["belt"], "photo-1596755094514-f87e34085b2c"],
    [["scarf"], "photo-1576566588028-4147f3842f27"],
    [["sock", "tight", "fishnet", "stocking"], "photo-1542291026-7eec264c27ff"],
  ];
  for (const [terms, photoId] of map) {
    if (terms.some(t => n.includes(t))) return `https://images.unsplash.com/${photoId}?w=400&q=80`;
  }
  return "";  // no placeholder — frontend shows clothing illustration instead
}

// Generates an Amazon affiliate search URL for a product
function amazonUrl(productName: string, brand: string): string {
  const query = encodeURIComponent(`${brand} ${productName}`);
  return `https://www.amazon.com/s?k=${query}&tag=styleaiapp-20`;
}

function generateMockResults(aesthetic: string) {
  const aestheticProducts: Record<string, any[]> = {
    // ── MINIMALIST & CLEAN ──
    "Quiet Luxury": [
      { id: 1, name: "Merino Crewneck Sweater", brand: "Brunello Cucinelli", price: 695, image: "", match: 97, retailer: "Brunello Cucinelli", url: "https://www.amazon.com/s?k=Brunello+Cucinelli+Merino+Crewneck+Sweater&tag=styleaiapp-20" },
      { id: 2, name: "Tailored Camel Overcoat", brand: "Toteme", price: 895, image: "", match: 94, retailer: "Toteme", url: "https://www.amazon.com/s?k=Toteme+Tailored+Camel+Overcoat&tag=styleaiapp-20" },
      { id: 3, name: "Straight-Leg Wool Trousers", brand: "Arket", price: 139, image: "", match: 91, retailer: "Arket", url: "https://www.amazon.com/s?k=Arket+Straight-Leg+Wool+Trousers&tag=styleaiapp-20" },
      { id: 4, name: "Suede Penny Loafers", brand: "Grenson", price: 285, image: "", match: 89, retailer: "Grenson", url: "https://www.amazon.com/s?k=Grenson+Suede+Penny+Loafers&tag=styleaiapp-20" },
      { id: 5, name: "Cashmere Turtleneck", brand: "The Row", price: 590, image: "", match: 86, retailer: "The Row", url: "https://www.amazon.com/s?k=The+Row+Cashmere+Turtleneck&tag=styleaiapp-20" },
      { id: 6, name: "Structured Leather Tote", brand: "Polene", price: 320, image: "", match: 82, retailer: "Polene", url: "https://www.amazon.com/s?k=Polene+Structured+Leather+Tote&tag=styleaiapp-20" },
    ],

    "Clean Fit": [
      { id: 1, name: "Fitted Linen Shirt", brand: "Uniqlo", price: 39, image: "", match: 96, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Fitted+Linen+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Slim Chino Trousers", brand: "COS", price: 89, image: "", match: 93, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Slim+Chino+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "White Low-Top Sneakers", brand: "Adidas", price: 90, image: "", match: 90, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+White+Low-Top+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Fitted White Tank", brand: "SKIMS", price: 38, image: "", match: 87, retailer: "SKIMS", url: "https://www.amazon.com/s?k=SKIMS+Fitted+White+Tank&tag=styleaiapp-20" },
      { id: 5, name: "Wide-Leg Tailored Trousers", brand: "Zara", price: 59, image: "", match: 84, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Wide-Leg+Tailored+Trousers&tag=styleaiapp-20" },
      { id: 6, name: "Minimal Watch", brand: "Skagen", price: 99, image: "", match: 81, retailer: "Skagen", url: "https://www.amazon.com/s?k=Skagen+Minimal+Watch&tag=styleaiapp-20" },
    ],

    // Legacy alias
    "Clean Girl": [
      { id: 1, name: "Fitted Linen Shirt", brand: "Uniqlo", price: 39, image: "", match: 96, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Fitted+Linen+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Slim Chino Trousers", brand: "COS", price: 89, image: "", match: 93, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Slim+Chino+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "White Low-Top Sneakers", brand: "Adidas", price: 90, image: "", match: 90, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+White+Low-Top+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Fitted White Tank", brand: "SKIMS", price: 38, image: "", match: 87, retailer: "SKIMS", url: "https://www.amazon.com/s?k=SKIMS+Fitted+White+Tank&tag=styleaiapp-20" },
      { id: 5, name: "Wide-Leg Tailored Trousers", brand: "Zara", price: 59, image: "", match: 84, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Wide-Leg+Tailored+Trousers&tag=styleaiapp-20" },
      { id: 6, name: "Minimal Watch", brand: "Skagen", price: 99, image: "", match: 81, retailer: "Skagen", url: "https://www.amazon.com/s?k=Skagen+Minimal+Watch&tag=styleaiapp-20" },
    ],


    "Classic / Timeless": [
      { id: 1, name: "Oxford Button-Down Shirt", brand: "Brooks Brothers", price: 98, image: "", match: 96, retailer: "Brooks Brothers", url: "https://www.amazon.com/s?k=Brooks+Brothers+Oxford+Button-Down+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Slim Trench Coat", brand: "A.P.C.", price: 595, image: "", match: 93, retailer: "A.P.C.", url: "https://www.amazon.com/s?k=A.P.C.+Slim+Trench+Coat&tag=styleaiapp-20" },
      { id: 3, name: "Tailored Navy Blazer", brand: "Reiss", price: 345, image: "", match: 90, retailer: "Reiss", url: "https://www.amazon.com/s?k=Reiss+Tailored+Navy+Blazer&tag=styleaiapp-20" },
      { id: 4, name: "Slim Chino Trousers", brand: "Banana Republic", price: 89, image: "", match: 87, retailer: "Banana Republic", url: "https://www.amazon.com/s?k=Banana+Republic+Slim+Chino+Trousers&tag=styleaiapp-20" },
      { id: 5, name: "Leather Oxford Shoes", brand: "Thursday Boot Co", price: 199, image: "", match: 84, retailer: "Thursday Boot Co", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Leather+Oxford+Shoes&tag=styleaiapp-20" },
      { id: 6, name: "Wool Crewneck Knit", brand: "Uniqlo", price: 59, image: "", match: 81, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Wool+Crewneck+Knit&tag=styleaiapp-20" },
    ],

    // ── SOFT & FEMININE ──
    "Coquette": [
      { id: 1, name: "Lace Trim Slip Dress", brand: "Reformation", price: 198, image: "", match: 97, retailer: "Reformation", url: "https://www.amazon.com/s?k=Reformation+Lace+Trim+Slip+Dress&tag=styleaiapp-20" },
      { id: 2, name: "Pearl Embellished Headband", brand: "Jennifer Behr", price: 98, image: "", match: 93, retailer: "Jennifer Behr", url: "https://www.amazon.com/s?k=Jennifer+Behr+Pearl+Embellished+Headband&tag=styleaiapp-20" },
      { id: 3, name: "Satin Bow Ballet Flats", brand: "Repetto", price: 245, image: "", match: 90, retailer: "Repetto", url: "https://www.amazon.com/s?k=Repetto+Satin+Bow+Ballet+Flats&tag=styleaiapp-20" },
      { id: 4, name: "Corset Top", brand: "Bustier", price: 79, image: "", match: 87, retailer: "ASOS", url: "https://www.amazon.com/s?k=Bustier+Corset+Top&tag=styleaiapp-20" },
      { id: 5, name: "Pearl Stud Earrings", brand: "Mejuri", price: 68, image: "", match: 84, retailer: "Mejuri", url: "https://www.amazon.com/s?k=Mejuri+Pearl+Stud+Earrings&tag=styleaiapp-20" },
      { id: 6, name: "Mini Bow Bag", brand: "Miu Miu", price: 1490, image: "", match: 81, retailer: "Miu Miu", url: "https://www.amazon.com/s?k=Miu+Miu+Mini+Bow+Bag&tag=styleaiapp-20" },
    ],
    "Soft Girl / Kawaii": [
      { id: 1, name: "Fluffy Pastel Cardigan", brand: "Urban Outfitters", price: 59, image: "", match: 95, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Fluffy+Pastel+Cardigan&tag=styleaiapp-20" },
      { id: 2, name: "Pleated Mini Skirt", brand: "Princess Polly", price: 49, image: "", match: 92, retailer: "Princess Polly", url: "https://www.amazon.com/s?k=Princess+Polly+Pleated+Mini+Skirt&tag=styleaiapp-20" },
      { id: 3, name: "Heart Hair Clips Set", brand: "ASOS", price: 15, image: "", match: 89, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Heart+Hair+Clips+Set&tag=styleaiapp-20" },
      { id: 4, name: "Platform Mary Janes", brand: "Steve Madden", price: 89, image: "", match: 86, retailer: "Steve Madden", url: "https://www.amazon.com/s?k=Steve+Madden+Platform+Mary+Janes&tag=styleaiapp-20" },
      { id: 5, name: "Layered Charm Necklace", brand: "Anthropologie", price: 38, image: "", match: 83, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Layered+Charm+Necklace&tag=styleaiapp-20" },
      { id: 6, name: "Pastel Mini Backpack", brand: "Eastpak", price: 65, image: "", match: 80, retailer: "Eastpak", url: "https://www.amazon.com/s?k=Eastpak+Pastel+Mini+Backpack&tag=styleaiapp-20" },
    ],
    "Pink Pilates / Wellness": [
      { id: 1, name: "Ribbed Seamless Leggings", brand: "Lululemon", price: 98, image: "", match: 96, retailer: "Lululemon", url: "https://www.amazon.com/s?k=Lululemon+Ribbed+Seamless+Leggings&tag=styleaiapp-20" },
      { id: 2, name: "Ballet Wrap Cardigan", brand: "Reformation", price: 148, image: "", match: 93, retailer: "Reformation", url: "https://www.amazon.com/s?k=Reformation+Ballet+Wrap+Cardigan&tag=styleaiapp-20" },
      { id: 3, name: "Tennis Mini Skirt", brand: "Varley", price: 79, image: "", match: 90, retailer: "Varley", url: "https://www.amazon.com/s?k=Varley+Tennis+Mini+Skirt&tag=styleaiapp-20" },
      { id: 4, name: "Satin Scrunchie Set", brand: "Slip", price: 45, image: "", match: 87, retailer: "Slip", url: "https://www.amazon.com/s?k=Slip+Satin+Scrunchie+Set&tag=styleaiapp-20" },
      { id: 5, name: "Cloud Sneakers", brand: "On Running", price: 150, image: "", match: 84, retailer: "On Running", url: "https://www.amazon.com/s?k=On+Running+Cloud+Sneakers&tag=styleaiapp-20" },
      { id: 6, name: "Mini Pilates Bag", brand: "Lululemon", price: 68, image: "", match: 81, retailer: "Lululemon", url: "https://www.amazon.com/s?k=Lululemon+Mini+Pilates+Bag&tag=styleaiapp-20" },
    ],
    "Dark Feminine": [
      { id: 1, name: "Velvet Corset Dress", brand: "House of CB", price: 189, image: "", match: 96, retailer: "House of CB", url: "https://www.amazon.com/s?k=House+of+CB+Velvet+Corset+Dress&tag=styleaiapp-20" },
      { id: 2, name: "Lace Trim Midi Skirt", brand: "Free People", price: 128, image: "", match: 93, retailer: "Free People", url: "https://www.amazon.com/s?k=Free+People+Lace+Trim+Midi+Skirt&tag=styleaiapp-20" },
      { id: 3, name: "Leather Knee Boots", brand: "Stuart Weitzman", price: 695, image: "", match: 90, retailer: "Stuart Weitzman", url: "https://www.amazon.com/s?k=Stuart+Weitzman+Leather+Knee+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Satin Slip Cami", brand: "Reformation", price: 98, image: "", match: 87, retailer: "Reformation", url: "https://www.amazon.com/s?k=Reformation+Satin+Slip+Cami&tag=styleaiapp-20" },
      { id: 5, name: "Statement Drop Earrings", brand: "Completedworks", price: 145, image: "", match: 84, retailer: "Completedworks", url: "https://www.amazon.com/s?k=Completedworks+Statement+Drop+Earrings&tag=styleaiapp-20" },
      { id: 6, name: "Dark Berry Lip", brand: "Charlotte Tilbury", price: 34, image: "", match: 81, retailer: "Charlotte Tilbury", url: "https://www.amazon.com/s?k=Charlotte+Tilbury+Dark+Berry+Lip&tag=styleaiapp-20" },
    ],
    // ── PREPPY & COLLEGIATE ──
    "Old School Preppy": [
      { id: 1, name: "Cable-Knit Crewneck", brand: "J.Crew", price: 118, image: "", match: 95, retailer: "J.Crew", url: "https://www.amazon.com/s?k=J.Crew+Cable-Knit+Crewneck&tag=styleaiapp-20" },
      { id: 2, name: "Oxford Button-Down", brand: "Brooks Brothers", price: 89, image: "", match: 92, retailer: "Brooks Brothers", url: "https://www.amazon.com/s?k=Brooks+Brothers+Oxford+Button-Down&tag=styleaiapp-20" },
      { id: 3, name: "Slim Chino Pants", brand: "Banana Republic", price: 89, image: "", match: 89, retailer: "Banana Republic", url: "https://www.amazon.com/s?k=Banana+Republic+Slim+Chino+Pants&tag=styleaiapp-20" },
      { id: 4, name: "Penny Loafers", brand: "G.H. Bass", price: 160, image: "", match: 86, retailer: "G.H. Bass", url: "https://www.amazon.com/s?k=G.H.+Bass+Penny+Loafers&tag=styleaiapp-20" },
      { id: 5, name: "Quilted Vest", brand: "Barbour", price: 149, image: "", match: 83, retailer: "Barbour", url: "https://www.amazon.com/s?k=Barbour+Quilted+Vest&tag=styleaiapp-20" },
      { id: 6, name: "Plaid Wool Scarf", brand: "Burberry", price: 290, image: "", match: 80, retailer: "Burberry", url: "https://www.amazon.com/s?k=Burberry+Plaid+Wool+Scarf&tag=styleaiapp-20" },
    ],
    "Modern Preppy": [
      { id: 1, name: "Puffer Vest", brand: "Patagonia", price: 149, image: "", match: 95, retailer: "Patagonia", url: "https://www.amazon.com/s?k=Patagonia+Puffer+Vest&tag=styleaiapp-20" },
      { id: 2, name: "Classic Polo Shirt", brand: "Lacoste", price: 99, image: "", match: 92, retailer: "Lacoste", url: "https://www.amazon.com/s?k=Lacoste+Classic+Polo+Shirt&tag=styleaiapp-20" },
      { id: 3, name: "Colourblock Sneakers", brand: "New Balance", price: 119, image: "", match: 89, retailer: "New Balance", url: "https://www.amazon.com/s?k=New+Balance+Colourblock+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Chino Shorts", brand: "J.Crew", price: 69, image: "", match: 86, retailer: "J.Crew", url: "https://www.amazon.com/s?k=J.Crew+Chino+Shorts&tag=styleaiapp-20" },
      { id: 5, name: "Pleated Mini Skirt", brand: "Princess Polly", price: 59, image: "", match: 83, retailer: "Princess Polly", url: "https://www.amazon.com/s?k=Princess+Polly+Pleated+Mini+Skirt&tag=styleaiapp-20" },
      { id: 6, name: "Mini Canvas Tote", brand: "L.L. Bean", price: 29, image: "", match: 80, retailer: "L.L. Bean", url: "https://www.amazon.com/s?k=L.L.+Bean+Mini+Canvas+Tote&tag=styleaiapp-20" },
    ],

    // ── STREETWEAR & URBAN ──
    "Skatecore": [
      { id: 1, name: "Sk8-Hi Sneakers", brand: "Vans", price: 90, image: "", match: 96, retailer: "Vans", url: "https://www.amazon.com/s?k=Vans+Sk8-Hi+Sneakers&tag=styleaiapp-20" },
      { id: 2, name: "Wide-Leg Denim", brand: "Dickies", price: 49, image: "", match: 93, retailer: "Dickies", url: "https://www.amazon.com/s?k=Dickies+Wide-Leg+Denim&tag=styleaiapp-20" },
      { id: 3, name: "Logo Overshirt", brand: "Carhartt WIP", price: 89, image: "", match: 89, retailer: "Carhartt WIP", url: "https://www.amazon.com/s?k=Carhartt+WIP+Logo+Overshirt&tag=styleaiapp-20" },
      { id: 4, name: "Graphic Skate Tee", brand: "Thrasher", price: 35, image: "", match: 86, retailer: "Thrasher", url: "https://www.amazon.com/s?k=Thrasher+Graphic+Skate+Tee&tag=styleaiapp-20" },
      { id: 5, name: "Beanie Hat", brand: "New Era", price: 28, image: "", match: 83, retailer: "New Era", url: "https://www.amazon.com/s?k=New+Era+Beanie+Hat&tag=styleaiapp-20" },
      { id: 6, name: "Canvas Belt Bag", brand: "Dickies", price: 32, image: "", match: 80, retailer: "Dickies", url: "https://www.amazon.com/s?k=Dickies+Canvas+Belt+Bag&tag=styleaiapp-20" },
    ],
    "Techwear": [
      { id: 1, name: "Waterproof Shell Jacket", brand: "Arc'teryx", price: 625, image: "", match: 97, retailer: "Arc'teryx", url: "https://www.amazon.com/s?k=Arc'teryx+Waterproof+Shell+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Ripstop Cargo Trousers", brand: "Veilance", price: 450, image: "", match: 94, retailer: "Veilance", url: "https://www.amazon.com/s?k=Veilance+Ripstop+Cargo+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Trail Running Shoes", brand: "Salomon", price: 160, image: "", match: 90, retailer: "Salomon", url: "https://www.amazon.com/s?k=Salomon+Trail+Running+Shoes&tag=styleaiapp-20" },
      { id: 4, name: "Tactical Vest", brand: "Stone Island", price: 399, image: "", match: 87, retailer: "Stone Island", url: "https://www.amazon.com/s?k=Stone+Island+Tactical+Vest&tag=styleaiapp-20" },
      { id: 5, name: "Balaclava", brand: "C.P. Company", price: 75, image: "", match: 84, retailer: "C.P. Company", url: "https://www.amazon.com/s?k=C.P.+Company+Balaclava&tag=styleaiapp-20" },
      { id: 6, name: "Sling Chest Bag", brand: "Cotopaxi", price: 85, image: "", match: 81, retailer: "Cotopaxi", url: "https://www.amazon.com/s?k=Cotopaxi+Sling+Chest+Bag&tag=styleaiapp-20" },
    ],
    "Baddie": [
      { id: 1, name: "Sculpted Bodycon Dress", brand: "House of CB", price: 139, image: "", match: 96, retailer: "House of CB", url: "https://www.amazon.com/s?k=House+of+CB+Sculpted+Bodycon+Dress&tag=styleaiapp-20" },
      { id: 2, name: "Clear Heel Mules", brand: "Steve Madden", price: 79, image: "", match: 93, retailer: "Steve Madden", url: "https://www.amazon.com/s?k=Steve+Madden+Clear+Heel+Mules&tag=styleaiapp-20" },
      { id: 3, name: "Faux Fur Coat", brand: "SHEIN", price: 89, image: "", match: 89, retailer: "SHEIN", url: "https://www.amazon.com/s?k=SHEIN+Faux+Fur+Coat&tag=styleaiapp-20" },
      { id: 4, name: "Quilted Chain Bag", brand: "Zara", price: 69, image: "", match: 86, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Quilted+Chain+Bag&tag=styleaiapp-20" },
      { id: 5, name: "Lash Mascara Set", brand: "Fenty Beauty", price: 28, image: "", match: 83, retailer: "Fenty Beauty", url: "https://www.amazon.com/s?k=Fenty+Beauty+Lash+Mascara+Set&tag=styleaiapp-20" },
      { id: 6, name: "Sleek Sunglasses", brand: "Quay", price: 65, image: "", match: 80, retailer: "Quay", url: "https://www.amazon.com/s?k=Quay+Sleek+Sunglasses&tag=styleaiapp-20" },
    ],
    // ── NATURE & FANTASY ──
    "Fairycore": [
      { id: 1, name: "Chiffon Floral Dress", brand: "Free People", price: 148, image: "", match: 96, retailer: "Free People", url: "https://www.amazon.com/s?k=Free+People+Chiffon+Floral+Dress&tag=styleaiapp-20" },
      { id: 2, name: "Floral Crown", brand: "Anthropologie", price: 48, image: "", match: 93, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Floral+Crown&tag=styleaiapp-20" },
      { id: 3, name: "Lace Tights", brand: "Wolford", price: 68, image: "", match: 90, retailer: "Wolford", url: "https://www.amazon.com/s?k=Wolford+Lace+Tights&tag=styleaiapp-20" },
      { id: 4, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 180, image: "", match: 87, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Chunky+Platform+Boots&tag=styleaiapp-20" },
      { id: 5, name: "Mushroom Charm Necklace", brand: "Mejuri", price: 58, image: "", match: 84, retailer: "Mejuri", url: "https://www.amazon.com/s?k=Mejuri+Mushroom+Charm+Necklace&tag=styleaiapp-20" },
      { id: 6, name: "Velvet Ribbon Hair Bow", brand: "Urban Outfitters", price: 18, image: "", match: 81, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Velvet+Ribbon+Hair+Bow&tag=styleaiapp-20" },
    ],
    "Gorpcore": [
      { id: 1, name: "Beta AR Jacket", brand: "Arc'teryx", price: 750, image: "", match: 97, retailer: "Arc'teryx", url: "https://www.amazon.com/s?k=Arc'teryx+Beta+AR+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Fleece Vest", brand: "Patagonia", price: 139, image: "", match: 94, retailer: "Patagonia", url: "https://www.amazon.com/s?k=Patagonia+Fleece+Vest&tag=styleaiapp-20" },
      { id: 3, name: "Trail Shoes", brand: "Salomon", price: 160, image: "", match: 91, retailer: "Salomon", url: "https://www.amazon.com/s?k=Salomon+Trail+Shoes&tag=styleaiapp-20" },
      { id: 4, name: "Utility Cargo Pants", brand: "The North Face", price: 130, image: "", match: 88, retailer: "The North Face", url: "https://www.amazon.com/s?k=The+North+Face+Utility+Cargo+Pants&tag=styleaiapp-20" },
      { id: 5, name: "Beanie Hat", brand: "Patagonia", price: 35, image: "", match: 85, retailer: "Patagonia", url: "https://www.amazon.com/s?k=Patagonia+Beanie+Hat&tag=styleaiapp-20" },
      { id: 6, name: "Hip Pack", brand: "Cotopaxi", price: 75, image: "", match: 82, retailer: "Cotopaxi", url: "https://www.amazon.com/s?k=Cotopaxi+Hip+Pack&tag=styleaiapp-20" },
    ],
    // ── VINTAGE & RETRO ──
    "90s Grunge": [
      { id: 1, name: "Flannel Overshirt", brand: "Levi's", price: 79, image: "", match: 96, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Flannel+Overshirt&tag=styleaiapp-20" },
      { id: 2, name: "Band Graphic Tee", brand: "Urban Outfitters", price: 35, image: "", match: 93, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Band+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "1460 Mono Boots", brand: "Dr. Martens", price: 170, image: "", match: 90, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+1460+Mono+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Ripped Slim Jeans", brand: "Levi's", price: 98, image: "", match: 87, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Ripped+Slim+Jeans&tag=styleaiapp-20" },
      { id: 5, name: "Oversized Cardigan", brand: "Mango", price: 69, image: "", match: 84, retailer: "Mango", url: "https://www.amazon.com/s?k=Mango+Oversized+Cardigan&tag=styleaiapp-20" },
      { id: 6, name: "Leather Crossbody Bag", brand: "Urban Outfitters", price: 45, image: "", match: 81, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Leather+Crossbody+Bag&tag=styleaiapp-20" },
    ],

    "70s-80s Retro": [
      { id: 1, name: "Flared Denim Jeans", brand: "Levi's", price: 109, image: "", match: 96, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Flared+Denim+Jeans&tag=styleaiapp-20" },
      { id: 2, name: "Open-Collar Printed Shirt", brand: "Urban Outfitters", price: 59, image: "", match: 93, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Open-Collar+Printed+Shirt&tag=styleaiapp-20" },
      { id: 3, name: "Platform Chelsea Boots", brand: "Dr. Martens", price: 179, image: "", match: 90, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Platform+Chelsea+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Suede Jacket", brand: "ASOS", price: 149, image: "", match: 87, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Suede+Jacket&tag=styleaiapp-20" },
      { id: 5, name: "Oversized Tortoiseshell Sunglasses", brand: "Le Specs", price: 69, image: "", match: 84, retailer: "Le Specs", url: "https://www.amazon.com/s?k=Le+Specs+Oversized+Tortoiseshell+Sunglasses&tag=styleaiapp-20" },
      { id: 6, name: "Gold Layered Chains", brand: "Anthropologie", price: 48, image: "", match: 81, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Gold+Layered+Chains&tag=styleaiapp-20" },
    ],

    "Vintage / Thrift": [
      { id: 1, name: "Washed Denim Jacket", brand: "Levi's", price: 89, image: "", match: 95, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Washed+Denim+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Vintage Band Graphic Tee", brand: "Urban Outfitters", price: 35, image: "", match: 92, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Vintage+Band+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "Thrifted Corduroy Overshirt", brand: "ASOS", price: 55, image: "", match: 89, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Thrifted+Corduroy+Overshirt&tag=styleaiapp-20" },
      { id: 4, name: "90s Logo Cap", brand: "Tommy Hilfiger", price: 38, image: "", match: 86, retailer: "Tommy Hilfiger", url: "https://www.amazon.com/s?k=Tommy+Hilfiger+90s+Logo+Cap&tag=styleaiapp-20" },
      { id: 5, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 179, image: "", match: 83, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Chunky+Platform+Boots&tag=styleaiapp-20" },
      { id: 6, name: "Deadstock Floral Shirt", brand: "Depop", price: 28, image: "", match: 80, retailer: "Depop", url: "https://www.amazon.com/s?k=Depop+Deadstock+Floral+Shirt&tag=styleaiapp-20" },
    ],

    // ── BOLD & EXPRESSIVE ──
    "Maximalist": [
      { id: 1, name: "Printed Statement Shirt", brand: "Zara", price: 69, image: "", match: 96, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Printed+Statement+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Mixed Print Blazer", brand: "ASOS", price: 99, image: "", match: 93, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Mixed+Print+Blazer&tag=styleaiapp-20" },
      { id: 3, name: "Chunky Layered Chain Necklace", brand: "Anthropologie", price: 48, image: "", match: 90, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Chunky+Layered+Chain+Necklace&tag=styleaiapp-20" },
      { id: 4, name: "Colourful Chunky Sneakers", brand: "New Balance", price: 139, image: "", match: 87, retailer: "New Balance", url: "https://www.amazon.com/s?k=New+Balance+Colourful+Chunky+Sneakers&tag=styleaiapp-20" },
      { id: 5, name: "Mixed Print Dress", brand: "Farm Rio", price: 195, image: "", match: 84, retailer: "Farm Rio", url: "https://www.amazon.com/s?k=Farm+Rio+Mixed+Print+Dress&tag=styleaiapp-20" },
      { id: 6, name: "Animal Print Coat", brand: "ASOS", price: 129, image: "", match: 81, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Animal+Print+Coat&tag=styleaiapp-20" },
    ],

    "Rave": [
      { id: 1, name: "Holographic Mini Skirt", brand: "ASOS", price: 45, image: "", match: 97, retailer: "ASOS", url: "https://www.amazon.com/s?k=Holographic+Mini+Skirt&tag=styleaiapp-20" },
      { id: 2, name: "Fishnet Body Stocking", brand: "Leg Avenue", price: 22, image: "", match: 94, retailer: "Leg Avenue", url: "https://www.amazon.com/s?k=Leg+Avenue+Fishnet+Body+Stocking&tag=styleaiapp-20" },
      { id: 3, name: "Neon Bralette", brand: "I.AM.GIA", price: 55, image: "", match: 91, retailer: "I.AM.GIA", url: "https://www.amazon.com/s?k=Neon+Bralette&tag=styleaiapp-20" },
      { id: 4, name: "Chunky Platform Sneakers", brand: "Buffalo", price: 139, image: "", match: 88, retailer: "Buffalo", url: "https://www.amazon.com/s?k=Buffalo+Chunky+Platform+Sneakers&tag=styleaiapp-20" },
      { id: 5, name: "LED / Glow Accessories Set", brand: "ASOS", price: 18, image: "", match: 85, retailer: "ASOS", url: "https://www.amazon.com/s?k=LED+Glow+Rave+Accessories&tag=styleaiapp-20" },
      { id: 6, name: "Iridescent Cargo Pants", brand: "UNIF", price: 98, image: "", match: 82, retailer: "UNIF", url: "https://www.amazon.com/s?k=UNIF+Iridescent+Cargo+Pants&tag=styleaiapp-20" },
    ],

    "Glam / Party": [
      { id: 1, name: "Velvet Blazer", brand: "ASOS", price: 89, image: "", match: 96, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Velvet+Blazer&tag=styleaiapp-20" },
      { id: 2, name: "Sequin Mini Dress", brand: "House of CB", price: 149, image: "", match: 93, retailer: "House of CB", url: "https://www.amazon.com/s?k=House+of+CB+Sequin+Mini+Dress&tag=styleaiapp-20" },
      { id: 3, name: "Satin Dress Shirt", brand: "Zara", price: 69, image: "", match: 90, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Satin+Dress+Shirt&tag=styleaiapp-20" },
      { id: 4, name: "Metallic Clutch Bag", brand: "ASOS", price: 35, image: "", match: 87, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Metallic+Clutch+Bag&tag=styleaiapp-20" },
      { id: 5, name: "Crystal Drop Earrings", brand: "Completedworks", price: 95, image: "", match: 84, retailer: "Completedworks", url: "https://www.amazon.com/s?k=Completedworks+Crystal+Drop+Earrings&tag=styleaiapp-20" },
      { id: 6, name: "Pointed Dress Shoes", brand: "Aldo", price: 119, image: "", match: 81, retailer: "Aldo", url: "https://www.amazon.com/s?k=Aldo+Pointed+Dress+Shoes&tag=styleaiapp-20" },
    ],

    "E-Girl / Alt": [
      { id: 1, name: "Striped Long-Sleeve Tee", brand: "Urban Outfitters", price: 35, image: "", match: 96, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Striped+Long-Sleeve+Tee&tag=styleaiapp-20" },
      { id: 2, name: "Chain Link Choker", brand: "ASOS", price: 12, image: "", match: 93, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Chain+Link+Choker&tag=styleaiapp-20" },
      { id: 3, name: "Platform Combat Boots", brand: "Dr. Martens", price: 179, image: "", match: 90, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Platform+Combat+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Graphic Alt Hoodie", brand: "Killstar", price: 79, image: "", match: 87, retailer: "Killstar", url: "https://www.amazon.com/s?k=Killstar+Graphic+Alt+Hoodie&tag=styleaiapp-20" },
      { id: 5, name: "Straight-Leg Black Jeans", brand: "Topman", price: 55, image: "", match: 84, retailer: "Topman", url: "https://www.amazon.com/s?k=Topman+Straight-Leg+Black+Jeans&tag=styleaiapp-20" },
      { id: 6, name: "Plaid Mini Skirt", brand: "UNIF", price: 78, image: "", match: 81, retailer: "UNIF", url: "https://www.amazon.com/s?k=UNIF+Plaid+Mini+Skirt&tag=styleaiapp-20" },
    ],

    // ── FORMAL & POWER ──
    "Office Siren": [
      { id: 1, name: "Power Shoulder Blazer", brand: "Zara", price: 129, image: "", match: 96, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Power+Shoulder+Blazer&tag=styleaiapp-20" },
      { id: 2, name: "Slim-Fit Dress Trousers", brand: "Reiss", price: 149, image: "", match: 93, retailer: "Reiss", url: "https://www.amazon.com/s?k=Reiss+Slim-Fit+Dress+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Silk Blouse", brand: "Equipment", price: 198, image: "", match: 90, retailer: "Equipment", url: "https://www.amazon.com/s?k=Equipment+Silk+Blouse&tag=styleaiapp-20" },
      { id: 4, name: "Leather Oxford Shoes", brand: "Thursday Boot Co", price: 199, image: "", match: 87, retailer: "Thursday Boot Co", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Leather+Oxford+Shoes&tag=styleaiapp-20" },
      { id: 5, name: "Structured Work Tote", brand: "Polene", price: 295, image: "", match: 84, retailer: "Polene", url: "https://www.amazon.com/s?k=Polene+Structured+Work+Tote&tag=styleaiapp-20" },
      { id: 6, name: "Minimal Gold Watch", brand: "Skagen", price: 129, image: "", match: 81, retailer: "Skagen", url: "https://www.amazon.com/s?k=Skagen+Minimal+Gold+Watch&tag=styleaiapp-20" },
    ],

    "Occasion Wear": [
      { id: 1, name: "Tailored Two-Piece Suit", brand: "Reiss", price: 595, image: "", match: 96, retailer: "Reiss", url: "https://www.amazon.com/s?k=Reiss+Tailored+Two-Piece+Suit&tag=styleaiapp-20" },
      { id: 2, name: "Midi Wrap Dress", brand: "Reformation", price: 198, image: "", match: 93, retailer: "Reformation", url: "https://www.amazon.com/s?k=Reformation+Midi+Wrap+Dress&tag=styleaiapp-20" },
      { id: 3, name: "Oxford Dress Shoes", brand: "Thursday Boot Co", price: 199, image: "", match: 90, retailer: "Thursday Boot Co", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Oxford+Dress+Shoes&tag=styleaiapp-20" },
      { id: 4, name: "Pocket Square", brand: "Drake's", price: 55, image: "", match: 87, retailer: "Drake's", url: "https://www.amazon.com/s?k=Drake's+Pocket+Square&tag=styleaiapp-20" },
      { id: 5, name: "Satin Evening Clutch", brand: "Cult Gaia", price: 195, image: "", match: 84, retailer: "Cult Gaia", url: "https://www.amazon.com/s?k=Cult+Gaia+Satin+Evening+Clutch&tag=styleaiapp-20" },
      { id: 6, name: "Pearl Hoop Earrings", brand: "Completedworks", price: 85, image: "", match: 81, retailer: "Completedworks", url: "https://www.amazon.com/s?k=Completedworks+Pearl+Hoop+Earrings&tag=styleaiapp-20" },
    ],

    // ── SPORT & ACTIVE ──
    "Blokecore": [
      { id: 1, name: "Football Jersey", brand: "Adidas", price: 85, image: "", match: 96, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+Football+Jersey&tag=styleaiapp-20" },
      { id: 2, name: "Wide-Leg Jorts", brand: "Levi's", price: 65, image: "", match: 93, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Wide-Leg+Jorts&tag=styleaiapp-20" },
      { id: 3, name: "Classic Trainer Sneakers", brand: "Adidas", price: 90, image: "", match: 90, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+Classic+Trainer+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Bucket Hat", brand: "New Era", price: 35, image: "", match: 87, retailer: "New Era", url: "https://www.amazon.com/s?k=New+Era+Bucket+Hat&tag=styleaiapp-20" },
      { id: 5, name: "Zip-Up Track Jacket", brand: "Umbro", price: 65, image: "", match: 84, retailer: "Umbro", url: "https://www.amazon.com/s?k=Umbro+Zip-Up+Track+Jacket&tag=styleaiapp-20" },
      { id: 6, name: "Terry Cloth Wristband", brand: "Nike", price: 18, image: "", match: 81, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Terry+Cloth+Wristband&tag=styleaiapp-20" },
    ],
    // ── COUNTERCULTURAL ──
    "Goth": [
      { id: 1, name: "Platform Chelsea Boots", brand: "Dr. Martens", price: 179, image: "", match: 96, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Platform+Chelsea+Boots&tag=styleaiapp-20" },
      { id: 2, name: "Oversized Black Trench Coat", brand: "ASOS", price: 119, image: "", match: 93, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Oversized+Black+Trench+Coat&tag=styleaiapp-20" },
      { id: 3, name: "Layered Chain Choker", brand: "ASOS", price: 18, image: "", match: 90, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Layered+Chain+Choker&tag=styleaiapp-20" },
      { id: 4, name: "All-Black Skinny Jeans", brand: "Topman", price: 55, image: "", match: 87, retailer: "Topman", url: "https://www.amazon.com/s?k=Topman+All-Black+Skinny+Jeans&tag=styleaiapp-20" },
      { id: 5, name: "Velvet Blazer", brand: "ASOS", price: 89, image: "", match: 84, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Velvet+Blazer&tag=styleaiapp-20" },
      { id: 6, name: "Fishnet Layering Top", brand: "Wolford", price: 45, image: "", match: 81, retailer: "Wolford", url: "https://www.amazon.com/s?k=Wolford+Fishnet+Layering+Top&tag=styleaiapp-20" },
    ],

    "Grunge / Punk": [
      { id: 1, name: "Studded Leather Jacket", brand: "ASOS", price: 110, image: "", match: 96, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Studded+Leather+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Band Graphic Tee", brand: "Urban Outfitters", price: 34, image: "", match: 93, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Band+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "1460 Mono Boots", brand: "Dr. Martens", price: 180, image: "", match: 90, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+1460+Mono+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Distressed Jeans", brand: "Levi's", price: 88, image: "", match: 87, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Distressed+Jeans&tag=styleaiapp-20" },
      { id: 5, name: "Plaid Flannel Shirt", brand: "Carhartt", price: 59, image: "", match: 84, retailer: "Carhartt", url: "https://www.amazon.com/s?k=Carhartt+Plaid+Flannel+Shirt&tag=styleaiapp-20" },
      { id: 6, name: "Safety Pin Set", brand: "ASOS", price: 8, image: "", match: 81, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Safety+Pin+Set&tag=styleaiapp-20" },
    ],
    // ── CULTURAL / REGIONAL ──
    "Western / Americana": [
      { id: 1, name: "Cowboy Boots", brand: "Ariat", price: 199, image: "", match: 96, retailer: "Ariat", url: "https://www.amazon.com/s?k=Ariat+Cowboy+Boots&tag=styleaiapp-20" },
      { id: 2, name: "Wide-Brim Felt Hat", brand: "Lack of Color", price: 129, image: "", match: 93, retailer: "Lack of Color", url: "https://www.amazon.com/s?k=Lack+of+Color+Wide-Brim+Felt+Hat&tag=styleaiapp-20" },
      { id: 3, name: "Embroidered Western Shirt", brand: "Wrangler", price: 79, image: "", match: 90, retailer: "Wrangler", url: "https://www.amazon.com/s?k=Wrangler+Embroidered+Western+Shirt&tag=styleaiapp-20" },
      { id: 4, name: "Bootcut Denim Jeans", brand: "Levi's", price: 99, image: "", match: 87, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Bootcut+Denim+Jeans&tag=styleaiapp-20" },
      { id: 5, name: "Leather Belt with Buckle", brand: "Ariat", price: 55, image: "", match: 84, retailer: "Ariat", url: "https://www.amazon.com/s?k=Ariat+Leather+Belt+with+Buckle&tag=styleaiapp-20" },
      { id: 6, name: "Denim Fringe Jacket", brand: "Levi's", price: 149, image: "", match: 81, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Denim+Fringe+Jacket&tag=styleaiapp-20" },
    ],

    "K-Fashion": [
      { id: 1, name: "Oversized Varsity Jacket", brand: "Ader Error", price: 289, image: "", match: 96, retailer: "Ader Error", url: "https://www.amazon.com/s?k=Ader+Error+Oversized+Varsity+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Cropped Wide-Leg Trousers", brand: "COS", price: 109, image: "", match: 93, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Cropped+Wide-Leg+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Platform Dad Sneakers", brand: "New Balance", price: 139, image: "", match: 90, retailer: "New Balance", url: "https://www.amazon.com/s?k=New+Balance+Platform+Dad+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Pastel Oversized Cardigan", brand: "COS", price: 89, image: "", match: 87, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Pastel+Oversized+Cardigan&tag=styleaiapp-20" },
      { id: 5, name: "Bucket Hat", brand: "Maje", price: 65, image: "", match: 84, retailer: "Maje", url: "https://www.amazon.com/s?k=Maje+Bucket+Hat&tag=styleaiapp-20" },
      { id: 6, name: "Mini Shoulder Bag", brand: "Marc Jacobs", price: 175, image: "", match: 81, retailer: "Marc Jacobs", url: "https://www.amazon.com/s?k=Marc+Jacobs+Mini+Shoulder+Bag&tag=styleaiapp-20" },
    ],

    // ── EMERGING ──
    "Retro-Futurism": [
      { id: 1, name: "Metallic Bomber Jacket", brand: "ASOS", price: 129, image: "", match: 96, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Metallic+Bomber+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Reflective Cargo Trousers", brand: "Zara", price: 79, image: "", match: 93, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Reflective+Cargo+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Futuristic Running Shoes", brand: "Salomon", price: 149, image: "", match: 90, retailer: "Salomon", url: "https://www.amazon.com/s?k=Salomon+Futuristic+Running+Shoes&tag=styleaiapp-20" },
      { id: 4, name: "Silver Mirror Sunglasses", brand: "Le Specs", price: 69, image: "", match: 87, retailer: "Le Specs", url: "https://www.amazon.com/s?k=Le+Specs+Silver+Mirror+Sunglasses&tag=styleaiapp-20" },
      { id: 5, name: "Chrome Crossbody Bag", brand: "Coperni", price: 395, image: "", match: 84, retailer: "Coperni", url: "https://www.amazon.com/s?k=Coperni+Chrome+Crossbody+Bag&tag=styleaiapp-20" },
      { id: 6, name: "Asymmetric Knit Top", brand: "Mango", price: 59, image: "", match: 81, retailer: "Mango", url: "https://www.amazon.com/s?k=Mango+Asymmetric+Knit+Top&tag=styleaiapp-20" },
    ],

    "Historical Romanticism": [
      { id: 1, name: "Ruffled Poet Shirt", brand: "ASOS", price: 45, image: "", match: 96, retailer: "ASOS", url: "https://www.amazon.com/s?k=ASOS+Ruffled+Poet+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Velvet Blazer", brand: "Vivienne Westwood", price: 395, image: "", match: 93, retailer: "Vivienne Westwood", url: "https://www.amazon.com/s?k=Vivienne+Westwood+Velvet+Blazer&tag=styleaiapp-20" },
      { id: 3, name: "Puffed Sleeve Blouse", brand: "& Other Stories", price: 69, image: "", match: 90, retailer: "& Other Stories", url: "https://www.amazon.com/s?k=%26+Other+Stories+Puffed+Sleeve+Blouse&tag=styleaiapp-20" },
      { id: 4, name: "Velvet Midi Skirt", brand: "Free People", price: 128, image: "", match: 87, retailer: "Free People", url: "https://www.amazon.com/s?k=Free+People+Velvet+Midi+Skirt&tag=styleaiapp-20" },
      { id: 5, name: "Pearl Headband", brand: "Jennifer Behr", price: 95, image: "", match: 84, retailer: "Jennifer Behr", url: "https://www.amazon.com/s?k=Jennifer+Behr+Pearl+Headband&tag=styleaiapp-20" },
      { id: 6, name: "Buckled Dress Shoes", brand: "Dr. Martens", price: 159, image: "", match: 81, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Buckled+Dress+Shoes&tag=styleaiapp-20" },
    ],

    // ── LEGACY KEYS (map old names → closest new category) ──
    "Clean Minimal": [
      { id: 1, name: "Relaxed Linen Blazer", brand: "& Other Stories", price: 149, image: "", match: 95, retailer: "& Other Stories", url: "https://www.amazon.com/s?k=%26+Other+Stories+Relaxed+Linen+Blazer&tag=styleaiapp-20" },
      { id: 2, name: "Wide-Leg Tailored Trousers", brand: "Arket", price: 119, image: "", match: 92, retailer: "Arket", url: "https://www.amazon.com/s?k=Arket+Wide-Leg+Tailored+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "White Low-Top Sneakers", brand: "Adidas", price: 90, image: "", match: 89, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+White+Low-Top+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Structured Leather Tote", brand: "Toteme", price: 395, image: "", match: 86, retailer: "Toteme", url: "https://www.amazon.com/s?k=Toteme+Structured+Leather+Tote&tag=styleaiapp-20" },
    ],

    "Coastal": [
      { id: 1, name: "Linen Stripe Shirt", brand: "Faherty", price: 128, image: "", match: 96, retailer: "Faherty", url: "https://www.amazon.com/s?k=Faherty+Linen+Stripe+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Relaxed Chino Shorts", brand: "J.Crew", price: 79, image: "", match: 90, retailer: "J.Crew", url: "https://www.amazon.com/s?k=J.Crew+Relaxed+Chino+Shorts&tag=styleaiapp-20" },
      { id: 3, name: "Canvas Slip-On Sneakers", brand: "Vans", price: 65, image: "", match: 88, retailer: "Vans", url: "https://www.amazon.com/s?k=Vans+Canvas+Slip-On+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Woven Straw Hat", brand: "Lack of Color", price: 99, image: "", match: 84, retailer: "Lack of Color", url: "https://www.amazon.com/s?k=Lack+of+Color+Woven+Straw+Hat&tag=styleaiapp-20" },
    ],
    "Streetwear": [
      { id: 1, name: "Carpenter Jeans", brand: "Carhartt WIP", price: 110, image: "", match: 97, retailer: "Carhartt WIP", url: "https://www.amazon.com/s?k=Carhartt+WIP+Carpenter+Jeans&tag=styleaiapp-20" },
      { id: 2, name: "Heavyweight Graphic Tee", brand: "Carhartt WIP", price: 65, image: "", match: 93, retailer: "Carhartt WIP", url: "https://www.amazon.com/s?k=Carhartt+WIP+Heavyweight+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "Puffer Jacket", brand: "The North Face", price: 229, image: "", match: 90, retailer: "The North Face", url: "https://www.amazon.com/s?k=The+North+Face+Puffer+Jacket&tag=styleaiapp-20" },
      { id: 4, name: "Relaxed Fit Cargo Pants", brand: "Nike", price: 85, image: "", match: 86, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Relaxed+Fit+Cargo+Pants&tag=styleaiapp-20" },
      { id: 5, name: "Air Force 1 Low", brand: "Nike", price: 110, image: "", match: 83, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Air+Force+1+Low&tag=styleaiapp-20" },
      { id: 6, name: "Fleece Quarter-Zip", brand: "Stüssy", price: 120, image: "", match: 80, retailer: "Stüssy", url: "https://www.amazon.com/s?k=Stussy+Fleece+Quarter+Zip&tag=styleaiapp-20" },
    ],
    "Hypebeast": [
      { id: 1, name: "Air Max 95 OG", brand: "Nike", price: 185, image: "", match: 97, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Air+Max+95+OG&tag=styleaiapp-20" },
      { id: 2, name: "Box Logo Hoodie", brand: "Supreme", price: 168, image: "", match: 94, retailer: "Supreme", url: "https://www.amazon.com/s?k=Supreme+Box+Logo+Hoodie&tag=styleaiapp-20" },
      { id: 3, name: "Jordan 1 Retro High OG", brand: "Jordan Brand", price: 180, image: "", match: 91, retailer: "Jordan Brand", url: "https://www.amazon.com/s?k=Jordan+1+Retro+High+OG&tag=styleaiapp-20" },
      { id: 4, name: "Crossbody Shoulder Bag", brand: "Supreme", price: 148, image: "", match: 87, retailer: "Supreme", url: "https://www.amazon.com/s?k=Supreme+Crossbody+Shoulder+Bag&tag=styleaiapp-20" },
      { id: 5, name: "Logo Tee", brand: "Off-White", price: 290, image: "", match: 84, retailer: "Off-White", url: "https://www.amazon.com/s?k=Off-White+Logo+Tee&tag=styleaiapp-20" },
      { id: 6, name: "Camo Cap", brand: "Palace", price: 45, image: "", match: 80, retailer: "Palace", url: "https://www.amazon.com/s?k=Palace+Camo+Cap&tag=styleaiapp-20" },
    ],
    "Cottagecore": [
      { id: 1, name: "Floral Linen Shirt", brand: "Uniqlo", price: 39, image: "", match: 95, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Floral+Linen+Shirt&tag=styleaiapp-20" },
      { id: 2, name: "Crochet Cardigan", brand: "Free People", price: 148, image: "", match: 92, retailer: "Free People", url: "https://www.amazon.com/s?k=Free+People+Crochet+Cardigan&tag=styleaiapp-20" },
      { id: 3, name: "Prairie Smock Dress", brand: "Anthropologie", price: 168, image: "", match: 89, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Prairie+Smock+Dress&tag=styleaiapp-20" },
      { id: 4, name: "Wicker Basket Bag", brand: "Cult Gaia", price: 195, image: "", match: 86, retailer: "Cult Gaia", url: "https://www.amazon.com/s?k=Cult+Gaia+Wicker+Basket+Bag&tag=styleaiapp-20" },
    ],

    "Dark Academia": [
      { id: 1, name: "Plaid Wool Blazer", brand: "Polo Ralph Lauren", price: 349, image: "", match: 96, retailer: "Polo Ralph Lauren", url: "https://www.amazon.com/s?k=Polo+Ralph+Lauren+Plaid+Wool+Blazer&tag=styleaiapp-20" },
      { id: 2, name: "High-Waist Pleated Trousers", brand: "COS", price: 119, image: "", match: 92, retailer: "COS", url: "https://www.amazon.com/s?k=COS+High-Waist+Pleated+Trousers&tag=styleaiapp-20" },
      { id: 3, name: "Oxford Brogues", brand: "Thursday Boot Co", price: 199, image: "", match: 89, retailer: "Thursday", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Oxford+Brogues&tag=styleaiapp-20" },
      { id: 4, name: "Turtleneck Knit", brand: "Uniqlo", price: 49, image: "", match: 85, retailer: "Uniqlo", url: "https://www.amazon.com/s?k=Uniqlo+Turtleneck+Knit&tag=styleaiapp-20" },
    ],
    "Y2K": [
      { id: 1, name: "Low-Rise Flare Jeans", brand: "Levi's", price: 99, image: "", match: 95, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Low-Rise+Flare+Jeans&tag=styleaiapp-20" },
      { id: 2, name: "Baggy Graphic Jersey Tee", brand: "Urban Outfitters", price: 45, image: "", match: 92, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Baggy+Graphic+Jersey+Tee&tag=styleaiapp-20" },
      { id: 3, name: "Platform Sneakers", brand: "Buffalo London", price: 149, image: "", match: 89, retailer: "Buffalo London", url: "https://www.amazon.com/s?k=Buffalo+London+Platform+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Von Dutch Trucker Cap", brand: "Von Dutch", price: 45, image: "", match: 86, retailer: "Von Dutch", url: "https://www.amazon.com/s?k=Von+Dutch+Von+Dutch+Trucker+Cap&tag=styleaiapp-20" },
    ],

    "Bohemian": [
      { id: 1, name: "Wide-Brim Straw Hat", brand: "Lack of Color", price: 119, image: "", match: 95, retailer: "Lack of Color", url: "https://www.amazon.com/s?k=Lack+of+Color+Wide-Brim+Straw+Hat&tag=styleaiapp-20" },
      { id: 2, name: "Linen Button-Down Shirt", brand: "Zara", price: 49, image: "", match: 92, retailer: "Zara", url: "https://www.amazon.com/s?k=Zara+Linen+Button-Down+Shirt&tag=styleaiapp-20" },
      { id: 3, name: "Suede Fringe Boots", brand: "Sam Edelman", price: 149, image: "", match: 89, retailer: "Sam Edelman", url: "https://www.amazon.com/s?k=Sam+Edelman+Suede+Fringe+Boots&tag=styleaiapp-20" },
      { id: 4, name: "Layered Gold Necklace", brand: "Anthropologie", price: 48, image: "", match: 86, retailer: "Anthropologie", url: "https://www.amazon.com/s?k=Anthropologie+Layered+Gold+Necklace&tag=styleaiapp-20" },
    ],

    "Classic Prep": [
      { id: 1, name: "Cable-Knit Crewneck", brand: "J.Crew", price: 118, image: "", match: 95, retailer: "J.Crew", url: "https://www.amazon.com/s?k=J.Crew+Cable-Knit+Crewneck&tag=styleaiapp-20" },
      { id: 2, name: "Slim Chino Pants", brand: "Banana Republic", price: 89, image: "", match: 91, retailer: "Banana Republic", url: "https://www.amazon.com/s?k=Banana+Republic+Slim+Chino+Pants&tag=styleaiapp-20" },
      { id: 3, name: "Penny Loafers", brand: "G.H. Bass", price: 160, image: "", match: 88, retailer: "G.H. Bass", url: "https://www.amazon.com/s?k=G.H.+Bass+Penny+Loafers&tag=styleaiapp-20" },
      { id: 4, name: "Quilted Vest", brand: "Barbour", price: 149, image: "", match: 84, retailer: "Barbour", url: "https://www.amazon.com/s?k=Barbour+Quilted+Vest&tag=styleaiapp-20" },
    ],
    "Athleisure": [
      { id: 1, name: "Seamless Jogger Set", brand: "Gymshark", price: 89, image: "", match: 96, retailer: "Gymshark", url: "https://www.amazon.com/s?k=Gymshark+Seamless+Jogger+Set&tag=styleaiapp-20" },
      { id: 2, name: "Oversized Hoodie", brand: "Nike", price: 75, image: "", match: 93, retailer: "Nike", url: "https://www.amazon.com/s?k=Nike+Oversized+Hoodie&tag=styleaiapp-20" },
      { id: 3, name: "Court Low Sneakers", brand: "New Balance", price: 89, image: "", match: 90, retailer: "New Balance", url: "https://www.amazon.com/s?k=New+Balance+Court+Low+Sneakers&tag=styleaiapp-20" },
      { id: 4, name: "Track Pants", brand: "Adidas", price: 65, image: "", match: 87, retailer: "Adidas", url: "https://www.amazon.com/s?k=Adidas+Track+Pants&tag=styleaiapp-20" },
      { id: 5, name: "Seamless Leggings", brand: "Lululemon", price: 98, image: "", match: 84, retailer: "Lululemon", url: "https://www.amazon.com/s?k=Lululemon+Seamless+Leggings&tag=styleaiapp-20" },
      { id: 6, name: "Quarter-Zip Pullover", brand: "Lululemon", price: 118, image: "", match: 81, retailer: "Lululemon", url: "https://www.amazon.com/s?k=Lululemon+Quarter-Zip+Pullover&tag=styleaiapp-20" },
    ],

    "Vintage": [
      { id: 1, name: "Washed Denim Jacket", brand: "Levi's", price: 89, image: "", match: 95, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Washed+Denim+Jacket&tag=styleaiapp-20" },
      { id: 2, name: "Vintage Band Graphic Tee", brand: "Urban Outfitters", price: 35, image: "", match: 92, retailer: "Urban Outfitters", url: "https://www.amazon.com/s?k=Urban+Outfitters+Vintage+Band+Graphic+Tee&tag=styleaiapp-20" },
      { id: 3, name: "Chunky Platform Boots", brand: "Dr. Martens", price: 179, image: "", match: 89, retailer: "Dr. Martens", url: "https://www.amazon.com/s?k=Dr.+Martens+Chunky+Platform+Boots&tag=styleaiapp-20" },
      { id: 4, name: "90s Logo Cap", brand: "Tommy Hilfiger", price: 38, image: "", match: 86, retailer: "Tommy Hilfiger", url: "https://www.amazon.com/s?k=Tommy+Hilfiger+90s+Logo+Cap&tag=styleaiapp-20" },
    ],

  };

  return aestheticProducts[aesthetic] ?? [
    { id: 1, name: "Classic White Shirt", brand: "COS", price: 79, image: "", match: 88, retailer: "COS", url: "https://www.amazon.com/s?k=COS+Classic+White+Shirt&tag=styleaiapp-20" },
    { id: 2, name: "Slim Fit Jeans", brand: "Levi's", price: 89, image: "", match: 85, retailer: "Levi's", url: "https://www.amazon.com/s?k=Levi's+Slim+Fit+Jeans&tag=styleaiapp-20" },
    { id: 3, name: "Leather Derby Shoes", brand: "Thursday Boot Co", price: 149, image: "", match: 82, retailer: "Thursday", url: "https://www.amazon.com/s?k=Thursday+Boot+Co+Leather+Derby+Shoes&tag=styleaiapp-20" },
    { id: 4, name: "Canvas Tote", brand: "Baggu", price: 38, image: "", match: 79, retailer: "Baggu", url: "https://www.amazon.com/s?k=Baggu+Canvas+Tote&tag=styleaiapp-20" },
  ];
}

// ─── Gemini response schema (structured output — no regex parsing needed) ───
// ─── Pass 1: Garment detection schema ────────────────────────────────────────
const GARMENT_SCHEMA = {
  type: SchemaType.OBJECT,
  description: "Structured inventory of all visible garments and accessories in the image",
  properties: {
    garments: {
      type: SchemaType.ARRAY,
      description: "Every visible clothing item and accessory. Be exhaustive — list each piece separately.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          item: {
            type: SchemaType.STRING,
            description: "Specific item name, e.g. 'Wide-leg corduroy trousers', 'Lug-sole platform boots', 'White linen shirt'",
          },
          color: {
            type: SchemaType.STRING,
            description: "Primary color(s) of this item, e.g. 'tan', 'white', 'black and white plaid'",
          },
          fabric: {
            type: SchemaType.STRING,
            description: "Fabric or material if identifiable, e.g. 'corduroy', 'linen', 'leather', 'denim', 'knit'. Use 'unknown' if unclear.",
          },
          fit: {
            type: SchemaType.STRING,
            description: "Fit or silhouette, e.g. 'oversized', 'slim', 'wide-leg', 'fitted', 'cropped', 'relaxed'",
          },
          details: {
            type: SchemaType.STRING,
            description: "Notable details: logos, hardware, embellishments, patterns, distressing, etc. Use 'none' if plain.",
          },
        },
        required: ["item", "color", "fabric", "fit", "details"],
      },
    },
    overallPalette: {
      type: SchemaType.STRING,
      description: "The dominant color story of the whole outfit, e.g. 'warm earth tones — tan, brown, white', 'all black with silver hardware'",
    },
    layering: {
      type: SchemaType.STRING,
      description: "How the outfit is layered, e.g. 'single layer', 'cardigan over tank top', 'jacket over turtleneck'",
    },
    perceivedGender: {
      type: SchemaType.STRING,
      enum: ["masculine", "feminine", "androgynous/neutral", "ambiguous"],
      description: "Perceived gender expression of the styling, based on garments and silhouettes only",
    },
  },
  required: ["garments", "overallPalette", "layering", "perceivedGender"],
};

const GARMENT_SYSTEM_INSTRUCTION = `You are a precise fashion analyst. Your job is to inventory every visible garment and accessory in an outfit image.
Be exhaustive and specific. List every item you can see — including items that are partially visible.
Focus on factual observation: what you literally see. No interpretation of style or aesthetic yet — that comes later.
Be specific with names: not "pants" but "wide-leg corduroy trousers". Not "shoes" but "lug-sole platform boots".`;

const ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  description: "Fashion aesthetic analysis of an outfit image",
  properties: {
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
        "Streetwear",
        "Hypebeast",
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
        "Rave",
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
        // Hybrid & Crossover
        "Blokette",
        "Indie Sleaze",
        // Academia Sub-styles
        "Light Academia",
        // Wellness & Outdoor
        "Granola Girl",
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
        "Your raw, honest confidence (0–100) that the primary aesthetic is correct. " +
        "Output the exact unrounded value you calculate. Do not round for convenience — if your true estimate is 73, output 73, not 70 or 75.",
    },
    styleBreakdown: {
      type: SchemaType.ARRAY,
      description: "Top 2 matching aesthetics. Primary score matches confidence. Secondary score reflects how strongly that aesthetic is also present.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          label: { type: SchemaType.STRING },
          score: {
            type: SchemaType.INTEGER,
            description: "Raw honest score 0–100. Do not round for convenience.",
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
    outfitRecs: {
      type: SchemaType.ARRAY,
      description:
        "4 get-the-look recommendations — items that directly replicate specific pieces VISIBLE in the outfit. " +
        "Each must correspond to an actual garment, shoe, or accessory you can see in the image. " +
        "e.g. if the outfit has a brown leather jacket, recommend a specific brown leather jacket. " +
        "Real brands, specific names, realistic prices.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, description: "Specific product name matching what is worn" },
          brand: { type: SchemaType.STRING, description: "Real brand that sells this exact product type" },
          price: { type: SchemaType.INTEGER, description: "Realistic retail price in USD" },
          reason: { type: SchemaType.STRING, description: "One sentence referencing exactly which piece in the outfit this replicates" },
        },
        required: ["name", "brand", "price", "reason"],
      },
    },
    similarRecs: {
      type: SchemaType.ARRAY,
      description:
        "4 style-adjacent recommendations — items NOT in the outfit but that complement or elevate it. " +
        "Think: what would a stylist add to complete this look? Missing accessory, layering piece, shoe alternative, or bag. " +
        "Real brands, specific names, realistic prices.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, description: "Specific product name" },
          brand: { type: SchemaType.STRING, description: "Real brand that sells this product" },
          price: { type: SchemaType.INTEGER, description: "Realistic retail price in USD" },
          reason: { type: SchemaType.STRING, description: "One sentence: why this complements or elevates the outfit" },
        },
        required: ["name", "brand", "price", "reason"],
      },
    },
  },
  required: [
    "visualSignals",
    "evidenceStrength",
    "aesthetic",
    "confidence",
    "styleBreakdown",
    "occasions",
    "keyPieces",
    "colorPalette",
    "outfitRecs",
    "similarRecs",
  ],
};

// ─── System instruction — 35-category style taxonomy + calibration rules ───
const SYSTEM_INSTRUCTION = `You are Stitch, an expert fashion stylist and aesthetic analyst specialising in visual outfit classification.

GENDER-INCLUSIVE CLASSIFICATION:
- Fashion aesthetics apply to ALL genders. Classify based on visual garments, silhouettes, and styling — never assume gender from body type alone.
- Every aesthetic below lists both masculine and feminine expressions of that style. Identify whichever expression is visible.
- A man wearing quiet luxury tailoring is Quiet Luxury. A man in ballet flats and pearls is Coquette. A woman in cargo pants and clean sneakers is Streetwear. A person in a Supreme box logo hoodie with Jordan 1s is Hypebeast. Classify what you SEE.
- When unsure of gender from the image, describe the clothing items neutrally and classify by aesthetic — not by assumed gender.

STYLE TAXONOMY — definitions for all 41 supported aesthetics:

── MINIMALIST & CLEAN ──
- Quiet Luxury: Understated wealth signalling. Neutral palette (camel, cream, black, ivory, navy). Quality fabrics — cashmere, wool, silk, fine leather. No visible logos. MASC: tailored trousers, merino crewnecks, suede loafers, unstructured blazers, clean white shirts. FEM: wide-leg trousers, cashmere turtlenecks, ballet flats, structured totes. Brands: The Row, Totême, Loro Piana, Brunello Cucinelli, Auralee.
- Clean Fit: Effortless polished minimalism — basics executed with precision, zero effort visible. Off-white/black/beige/grey palette. MASC: fitted linen shirt, slim chinos or trousers, white low-top sneakers, minimal watch, clean silhouette with no logos or fuss. FEM: white tanks, wide-leg trousers, gold hoops, slicked bun, oversized blazer. KEY DISTINCTION — Clean Fit REQUIRES: (1) clean, unworn, crisp fabrics — no fading, no washing, no distressing; (2) a minimal neutral palette — white, cream, beige, grey, black; (3) simple silhouette with no layering complexity. EXCLUDE if: the outfit has faded/washed denim, thrifted-looking pieces, visible wear or texture, denim-on-denim, or any vintage/retro feel — those are Vintage/Thrift. Clean Fit = polished and pristine. If it looks lived-in → not Clean Fit.
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
- Streetwear: Everyday urban culture dress. Relaxed fits, graphic tees, cargo pants, hoodies, clean sneakers. Brands: Carhartt WIP, Stüssy, Nike, New Balance, The North Face, Corteiz. No heavy logo-flex — just cool, comfortable, culturally aware. Worn across all genders.
- Hypebeast: Drop-culture, brand-obsessed, logo-forward. Key signals: visible Supreme, Off-White, Palace, Jordan Brand, or Yeezy branding; hyped sneakers (Jordan 1, Air Max, Dunk); collector-level pieces. The fit is built around the item — often one statement piece anchors the look. DISTINGUISH from Streetwear: Hypebeast = brand signals and resale-value pieces are front and center. Streetwear = culture and silhouette without the logo flex.
- Skatecore: Baggy and anti-fashion. Wide-leg jeans, graphic tees, Vans/DC shoes, caps, overshirts. Washed denim, black, white, earth tones. Skate brand logos. MASC dominant but gender-fluid. Relaxed and deliberate.
- Techwear: Utilitarian futurism. Technical jackets, cargo trousers, tactical vests, trail shoes, dark palette. ACRONYM, Veilance, Stone Island, Arc'teryx Veilance. Modular, functional, all-weather. Predominantly masculine expression but worn by all.
- Baddie: Glamorous urban confidence. Bodycon silhouettes, form-fitting co-ords, high heels, statement bags, fur-trim coats. Black, nude, gold, animal print. Polished, confident, bold. Predominantly feminine expression.

── NATURE & FANTASY ──
- Cottagecore: Pastoral romance. Prairie dresses, floral blouses, linen, crochet, aprons, straw hats. Sage, cream, dusty rose, terracotta. MASC expression: linen shirts, suspenders, knit vests, wicker hats, floral prints. Slow-living, handmade-feeling.
- Dark Academia: Scholarly and moody. Tweed blazers, turtlenecks, plaid, oxfords, trench coats. PALETTE IS CRITICAL: dark brown, forest green, oxblood/burgundy, charcoal, black. NEVER cream or beige as primary colors — those are Light Academia. MASC: tweed blazer + turtleneck + Oxford brogues + leather satchel. FEM: plaid skirts, knee socks, structured bags. Inspired by gothic collegiate buildings, The Secret History, Dead Poets Society. Moody, melancholic, intellectual.
- Light Academia: Scholarly but bright and optimistic — the warmer sibling of Dark Academia. PALETTE IS CRITICAL: cream, ivory, warm beige, oat, camel, muted pastels (dusty rose, pale sage, butter yellow). KEY ITEMS: linen dresses, cream trousers, pastel sweaters, cotton blouses, light knits, soft scarves, wire-frame glasses. DISTINGUISH from Dark Academia by palette — Light Academia is warm/light, never dark or black-dominant. Inspired by sunlit library courtyards, pastoral academia, Brideshead Revisited.
- Fairycore: Mystical and ethereal. Chiffon, floral crowns, lace, platform boots, delicate layered jewellery. Forest green, mushroom brown, dusty purple, cream. Predominantly feminine, but seen on all genders in alt/whimsical fashion.
- Gorpcore: Outdoor technical as everyday wear. Puffer jackets, fleece vests, cargo pants, trail shoes, beanies, fanny packs. Arc'teryx, Patagonia, The North Face. Earth tones + functional details. Very gender-neutral — classify by technical garments, not wearer.
- Granola Girl: Casual wellness-meets-nature lifestyle aesthetic. Softer and more feminine than Gorpcore — less technical, more earthy-lifestyle. KEY SIGNALS: Patagonia or REI fleece, Birkenstocks or Chacos, hiking-inspired casual wear, flowy linen, reusable water bottle implied energy, braided hair, no-makeup. Earth tones: sage green, rust, warm brown, cream, clay. DISTINGUISH from Gorpcore: Granola Girl is more casual/lifestyle, fewer technical pieces. DISTINGUISH from Cottagecore: Granola Girl is outdoorsy/active, not pastoral/romantic.

── VINTAGE & RETRO ERAS ──
- Y2K: Early 2000s pop-culture nostalgia. KEY SIGNALS: low-rise waistbands, rhinestone/bedazzled details, velour tracksuits, butterfly clips, tiny micro bags, baby tees, tube tops. Palette: hot pink, metallics, neon pastels, ice blue, denim-on-denim. MASC Y2K: baggy denim, Von Dutch caps, graphic jersey tees, tinted sunglasses. FEM Y2K: tube tops, low-rise mini skirts, bedazzled belts, velour co-ords. IMPORTANT: Y2K is NOT just "has platform boots" — platforms appear in 70s-80s Retro too. Y2K requires synthetic fabrics, low-rise silhouettes, or rhinestone/logo-heavy details. Earth tones + wide-leg corduroy + platform boots = 70s-80s Retro, NOT Y2K.
- 90s Grunge: Dishevelled rebellion. Flannel shirts, band tees, ripped jeans, Doc Martens. Black, plaid earth tones, faded denim, burgundy. MASC: flannel overshirt + band tee + ripped jeans + Docs. FEM: slip dresses + flannel + chunky boots. Kurt Cobain / Courtney Love energy — equally masculine and feminine.
- 70s-80s Retro: 1970s–1980s decade nostalgia. KEY SIGNALS: wide-leg or flared silhouettes, corduroy fabric, suede, warm earth tone palette (mustard, rust, camel, tan, brown, olive), platform boots or wedges, aviator sunglasses, open-collar printed shirts, gold chains, disco-era details. MASC: flared denim, printed open shirts, suede jackets, platform boots, gold chains, aviator shades, corduroy trousers. FEM: wrap dresses, wide-leg corduroys, corset or bustier tops layered over earth tones, platform boots, suede bags. DISTINCTION: if the outfit has corduroy, warm earth tones (tan/camel/rust/brown), and wide-leg silhouettes → 70s-80s Retro. If it has rhinestones, low-rise waistbands, velour, neon pastels, or baby tees → Y2K.
- Vintage / Thrift: Curated secondhand across any era. KEY SIGNALS: faded or washed denim, thrifted-looking silhouettes, heritage cuts, worn textures, mixed-era layering, lived-in feel. MASC: washed denim jacket, faded wide-leg jeans, white tee, leather mules/loafers — denim-on-denim is a STRONG vintage signal. Vintage band tees, deadstock denim, old-logo caps, thrifted blazers. FEM: floral wrap dresses, vintage blazers, 90s slip dresses. Depop energy. Muted, washed, faded palette. IMPORTANT: a washed denim jacket over a white tee and relaxed light-wash jeans = Vintage/Thrift, NOT Clean Fit. The worn/faded texture is the tell.

── BOLD & EXPRESSIVE ──
- Maximalist: More is more. Clashing prints, bold layers, statement coats, loud accessories. Animal print, jewel tones, all brights. MASC maximalism: bold printed shirts, layered jewellery, patterned suits, colourful trainers. FEM: ruffled dresses, statement coats, stacked accessories. Dopamine dressing — equally expressive across genders.
- Glam / Party: Evening and club wear. Sequins, satin, feather trim, metallic fabrics. Gold, silver, deep red, rich jewel tones. MASC: satin shirts, embellished jackets, velvet blazers, pointed dress shoes. FEM: sequin dresses, strappy heels, metallic bags. Shine and occasion.
- Rave: Festival and club culture. KEY SIGNALS: neon or UV-reactive colours, holographic/iridescent fabrics, fishnet layers, bralettes or mesh tops, tiny shorts or skirts, chunky platform sneakers or boots, kandi bracelets, LED/glow accessories, face gems or body glitter. Palette: neon green, hot pink, electric blue, UV white, holographic silver. Very skin-baring and maximally expressive. DISTINGUISH from Glam/Party: Rave is festival-practical and subculture-coded (comfort for dancing, DIY energy, glow accessories) — not cocktail-polished. DISTINGUISH from E-Girl: Rave centres neon/UV/holographic fabrics and festival accessories, not anime/emo aesthetics. DISTINGUISH from Retro-Futurism: Rave is dance-floor functional with neon energy, not sci-fi sculptural.
- E-Girl / Alt: Internet alt culture. Striped layering tees, plaid, chunky boots, chains, alt accessories. Black, red, pastel accents. MASC expression: E-Boy — striped long-sleeve under graphic tee, chains, straight-leg jeans, skate shoes. FEM: heart clips, plaid skirts, thigh-highs. Anime meets emo.
- Indie Sleaze: Anti-polish 2006–2012 revival, back strong in 2025–2026. Raw, messy, deliberately unkempt. KEY SIGNALS: skinny jeans, leather jacket, fishnet tights, smudged eyeliner (worn deliberately), band tees, Napoleon-style military jacket, multi-layered tops, thrifted pieces worn chaotically. Black, washed-out colours, some metallics. DISTINGUISH from 90s Grunge: Indie Sleaze is skinny/slim fit (not baggy) and rooted in 2000s indie music/MySpace era. DISTINGUISH from E-Girl: Indie Sleaze is less anime-coded, more music-scene energy. The look says "I was at a show last night."

── FORMAL & POWER DRESSING ──
- Office Siren: Polished work dressing with a confident edge. Pencil skirts, structured blazers, silk blouses, heels. Black, white, grey, navy, red. MASC: slim-fit suit, open-collar dress shirt, oxford shoes, structured briefcase. FEM: power suits, pointed mules, corset tops. Corpcore / power dressing with intentional sex appeal.
- Occasion Wear: Elegant event dressing. Structured pieces, elevated fabrics, sophisticated silhouettes. Classic navy, black, ivory, rich colours. MASC: suit, dress shirt, tailored trousers, Oxford shoes, pocket square. FEM: midi dresses, structured coats, heels, clutch bags. Semi-formal to formal.

── SPORT & ACTIVE ──
- Athleisure: Athletic pieces as everyday fashion. Performance fabrics in lifestyle context. Black, grey, white, bright accents. MASC: jogger sets, quarter-zips, track pants, running shoes, performance polos. FEM: leggings, sports bras, bombers, sneakers. Unisex aesthetic — classify by activewear silhouettes and brands (Nike, Adidas, Lululemon, Gymshark).
- Blokecore: Football culture as fashion. Football jerseys, wide-leg jorts, trainers, bucket hats, zip hoodies. Team colours, navy, black, white. British casual meets streetwear. Predominantly masculine but increasingly worn by all genders.
- Blokette: The sporty-feminine hybrid — Blokecore meets Coquette. KEY SIGNAL: masculine sportswear (football jersey, zip hoodie, sports socks) deliberately paired with feminine details (mini skirt, hair bows, Mary Janes, ballet flats, leg warmers, ribbons). DISTINGUISH from Blokecore: Blokette always has feminine accessories or garments. DISTINGUISH from Coquette: Blokette always has a sports/athletic piece. If you see a football jersey + mini skirt + bow = Blokette.

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
- Classify from specific visible items only — not vibes.
- Confidence: output your raw honest score. Low if ambiguous, high if certain. No floor or ceiling.
- If two aesthetics nearly equal → confidence <70, populate secondaryAesthetic.
- Choose MOST SPECIFIC category. Don't default to Vintage/Thrift when Y2K, 90s Grunge, or 70s-80s Retro fits.
- Y2K vs 70s-80s Retro: platforms ≠ Y2K. Y2K needs low-rise, rhinestones, velour, neon pastels, baby tee, or micro bag. Corduroy + earth tones + wide-leg = 70s-80s Retro.
- Corset/bustier: look at full outfit context — Y2K (low-rise/metallics), 70s-80s (earth tones), Coquette (bows/lace), Dark Feminine (all-black).
- Dark vs Light Academia: palette decides. Charcoal/oxblood/forest green/black = Dark. Cream/ivory/warm beige/pastels = Light.
- Gorpcore vs Granola Girl: technical gear = Gorpcore. Casual earth-tone lifestyle (fleece, Birkenstocks, linen) = Granola Girl.
- Blokecore vs Blokette: jersey + jorts + trainers = Blokecore. Jersey + feminine item (bow, mini skirt, Mary Janes) = Blokette.
- Rave vs Glam/Party vs E-Girl: Rave = neon/UV/holographic + festival accessories (kandi, glow, fishnet) + skin-baring for dancing. Glam/Party = sequins/satin + heels + polished cocktail energy. E-Girl = striped layers + anime/emo accessories + platforms.
- Streetwear vs Hypebeast: Streetwear = culture/silhouette-driven, no logo flex (Carhartt WIP, Stüssy, clean Nike). Hypebeast = visible luxury/hype branding is the centrepiece (Supreme, Off-White, Jordan 1s, Palace). If you can see the brand logo and it’s the point of the outfit → Hypebeast.
- Indie Sleaze vs 90s Grunge: Indie = slim fit + leather jacket + smudged liner (2000s). Grunge = baggy + flannel + Docs (90s).
- Quiet Luxury vs Clean Fit vs Classic: Quiet Luxury = expensive fabrics, no logos. Clean Fit = crisp casual basics. Classic = structured tailoring + dress shoes.
- Clean Fit vs Vintage/Thrift: FABRIC CONDITION. Crisp/new = Clean Fit. Faded/washed/worn = Vintage/Thrift. Denim-on-denim with faded wash = Vintage/Thrift.
- GENDER: Classify garments and styling, not the wearer.

PRODUCT RECOMMENDATIONS:
Generate two separate sets of 4 recommendations based on what you ACTUALLY SEE.

outfitRecs — GET THE LOOK (4 items):
- Each item must replicate a specific piece VISIBLE in the outfit.
- If you see a brown leather jacket → recommend a specific brown leather jacket. White sneakers → those exact white sneakers.
- reason field: reference the exact piece (e.g. "Replicates the oversized denim jacket worn in the outfit").

similarRecs — COMPLETE THE LOOK (4 items):
- Items NOT visible in the outfit that would complement or elevate it.
- Think like a stylist: missing accessory, bag, shoe alternative, layering piece, or jewellery.
- reason field: explain why it pairs with what's already in the outfit.

Both sets: real brands, specific names (not "jeans" but "Washed Barrel-Fit Jeans"), match gender expression, realistic prices: Zara = 30–100, Levi's = 60–120, Dr. Martens = 140–200, The Row = 300–800.`;

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
      const imageBase64 = file.buffer.toString("base64");
      const mimeType = file.mimetype as "image/jpeg" | "image/png" | "image/webp";

      // ── PASS 1: Garment detection (gemini-2.5-flash-lite — cheaper, simpler task) ─────
      const detectionModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",
        systemInstruction: GARMENT_SYSTEM_INSTRUCTION,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GARMENT_SCHEMA as any,
          temperature: 0.0,
        },
      });

      const detectionResult = await detectionModel.generateContent([
        { inlineData: { data: imageBase64, mimeType } },
        "List every visible garment and accessory. Be specific with names and details.",
      ]);

      const detectionText = detectionResult.response.text();
      const detectionJson = detectionText.match(/\{[\s\S]*\}/);
      if (!detectionJson) throw new Error("Could not parse garment detection response");
      const garmentData = JSON.parse(detectionJson[0]);

      // Build a structured garment description to ground the aesthetic classification
      const garmentSummary = [
        `Detected garments:`,
        ...garmentData.garments.map((g: any) =>
          `- ${g.item}: ${g.color}, ${g.fabric} fabric, ${g.fit} fit${g.details !== "none" ? `, details: ${g.details}` : ""}`
        ),
        `Overall palette: ${garmentData.overallPalette}`,
        `Layering: ${garmentData.layering}`,
        `Gender expression: ${garmentData.perceivedGender}`,
      ].join("\n");

      // ── PASS 2: Aesthetic classification using detected garments ──────────
      const classificationModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA as any,
          temperature: 0.0,
        },
      });

      const result = await classificationModel.generateContent([
        { inlineData: { data: imageBase64, mimeType } },
        `Garment inventory:\n${garmentSummary}\n\nClassify the aesthetic using the taxonomy and disambiguation rules.`,
      ]);

      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse Gemini response");

      const analysis = JSON.parse(jsonMatch[0]);

      // Build products from Gemini's split recommendations
      const mapRecs = (recs: any[], type: string, startId: number) =>
        (recs || []).map((rec: any, i: number) => ({
          id: startId + i,
          name: rec.name,
          brand: rec.brand,
          price: rec.price,
          image: "",  // no placeholder — frontend shows clothing illustration
          match: Math.max(75, 97 - i * 4),
          retailer: "Amazon",
          url: amazonUrl(rec.name, rec.brand),
          reason: rec.reason,
          type,
        }));

      const outfitProducts = mapRecs(analysis.outfitRecs, "outfit", 1);
      const similarProducts = mapRecs(analysis.similarRecs, "similar", 100);
      const products = [...outfitProducts, ...similarProducts];

      // Fallback: if new schema fields missing (old response), try legacy recommendations field
      const legacyProducts = (analysis.recommendations || []).map((rec: any, i: number) => ({
        id: i + 1,
        name: rec.name,
        brand: rec.brand,
        price: rec.price,
        image: "",  // no placeholder — frontend shows clothing illustration
        match: Math.max(75, 97 - i * 4),
        retailer: "Amazon",
        url: amazonUrl(rec.name, rec.brand),
        reason: rec.reason,
        type: "outfit",
      }));

      const finalProducts = products.length >= 3 ? products : legacyProducts.length >= 3 ? legacyProducts : generateMockResults(analysis.aesthetic);
      const imageDataUrl = `data:${mimeType};base64,${imageBase64}`;

      // Sync primary style score to Gemini's actual confidence so it reflects reality
      const styleBreakdown = Array.isArray(analysis.styleBreakdown) ? analysis.styleBreakdown : [];
      if (styleBreakdown.length > 0) {
        styleBreakdown[0].score = analysis.confidence;
      }

      const deviceId = req.headers["x-device-id"] as string | undefined;

      const scan = await storage.createScan({
        deviceId: deviceId || null,
        imageData: imageDataUrl,
        aesthetic: analysis.aesthetic,
        confidence: analysis.confidence,
        styleBreakdown: JSON.stringify(styleBreakdown),
        occasions: JSON.stringify(analysis.occasions),
        keyPieces: JSON.stringify(analysis.keyPieces),
        colorPalette: JSON.stringify(analysis.colorPalette),
        results: JSON.stringify(finalProducts),
      });

      res.json({ scanId: scan.id });
    } catch (err: any) {
      console.error("Analyze error:", err);
      res.status(500).json({ error: err.message || "Analysis failed" });
    }
  });

  // Get scans — filtered by device if x-device-id header present
  app.get("/api/scans", async (req, res) => {
    const deviceId = req.headers["x-device-id"] as string | undefined;
    const allScans = await storage.getScans(deviceId || undefined);
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
