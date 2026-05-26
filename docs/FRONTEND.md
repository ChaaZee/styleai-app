# FRONTEND.md — Stitch React Frontend

## Table of Contents
1. [Tech Stack Overview](#1-tech-stack-overview)
2. [Project Structure](#2-project-structure)
3. [Routing with Wouter & Hash URLs](#3-routing-with-wouter--hash-urls)
4. [App Entry Point & Startup Sequence](#4-app-entry-point--startup-sequence)
5. [State Management Strategy](#5-state-management-strategy)
6. [localStorage — The User Identity System](#6-localstorage--the-user-identity-system)
7. [Making API Calls](#7-making-api-calls)
8. [Page-by-Page Walkthrough](#8-page-by-page-walkthrough)
9. [Component Architecture](#9-component-architecture)
10. [The Style Vector (Client-Side AI)](#10-the-style-vector-client-side-ai)
11. [Design System & Theming](#11-design-system--theming)
12. [TypeScript for Python Developers](#12-typescript-for-python-developers)
13. [Build System: Vite](#13-build-system-vite)

---

## 1. Tech Stack Overview

| Tool | Role | Python Analogy |
|------|------|----------------|
| React | UI component library | Jinja2 templates, but dynamic and reactive |
| TypeScript | Typed JavaScript | Python with type hints enforced at compile time |
| Vite | Build tool / dev server | Like `uvicorn` + Webpack, but fast |
| Tailwind CSS | Utility-first CSS framework | Inline styles, but with a design system |
| shadcn/ui | Pre-built UI components | Like Bootstrap, but composable and customisable |
| wouter | Client-side routing | `flask`'s URL routing, but in the browser |
| TanStack Query | Server state management | `requests` + caching layer |

**What is React?** React is a JavaScript library for building UIs out of reusable *components* — functions that return HTML-like syntax (JSX). When data changes, React automatically re-renders only the parts of the page that need updating. You don't manually manipulate the DOM.

**Python analogy**: Imagine if every time you updated a Python dictionary, your Jinja2 template automatically re-rendered the parts that used that variable — without reloading the page. That's React.

```tsx
// A React component — a function that returns JSX (HTML-like syntax)
function WelcomeCard({ name, aesthetic }: { name: string; aesthetic: string }) {
  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-bold">{name}</h2>
      <p className="text-gray-500">Your style: {aesthetic}</p>
    </div>
  );
}

// Usage
<WelcomeCard name="Alex" aesthetic="Dark Academia" />
```

```python
# Rough Python/Jinja2 equivalent
def welcome_card(name: str, aesthetic: str) -> str:
    return f"""
    <div class="p-4 bg-white rounded-lg shadow">
        <h2 class="text-xl font-bold">{name}</h2>
        <p class="text-gray-500">Your style: {aesthetic}</p>
    </div>
    """
```

---

## 2. Project Structure

```
client/
├── src/
│   ├── App.tsx              # Root component, router setup
│   ├── main.tsx             # Entry point (mounts App into index.html)
│   ├── index.css            # Global CSS (Tailwind imports, font-face rules)
│   │
│   ├── pages/               # One file per route/page
│   │   ├── home.tsx         # Main feed (For You + Trending tabs)  [53KB]
│   │   ├── scan.tsx         # Camera/upload page
│   │   ├── results.tsx      # Post-analysis results
│   │   ├── history.tsx      # Past scans + liked items
│   │   ├── profile.tsx      # User settings (gender, style prefs)
│   │   ├── discover.tsx     # Swipeable outfit cards
│   │   ├── forYou.tsx       # Personalised Depop feed
│   │   ├── wardrobe.tsx     # Wardrobe management
│   │   ├── styleQuiz.tsx    # First-time onboarding quiz
│   │   └── howItWorks.tsx   # Explainer page
│   │
│   ├── components/          # Reusable UI components
│   │   ├── TopBar.tsx       # Navigation header
│   │   ├── LoadingScreen.tsx
│   │   └── ui/              # shadcn/ui components (Button, Card, etc.)
│   │
│   └── lib/                 # Utilities, helpers, hooks
│       ├── deviceId.ts      # Device/user ID management
│       ├── styleVector.ts   # Client-side aesthetic taste tracking
│       └── utils.ts         # Tailwind className merging helper
│
├── index.html               # HTML shell (React mounts into <div id="root">)
└── vite.config.ts           # Vite configuration
```

**Key concept — Single Page Application (SPA)**:

The entire frontend is one HTML file (`index.html`) with one JavaScript bundle. When a user navigates from `/` to `/scan`, JavaScript intercepts the click, updates the URL (using the hash), and swaps out the displayed component — without ever requesting a new HTML page from the server. This is why the Express backend has a catch-all route that always returns `index.html`.

**Python analogy**: Imagine a Flask app where `@app.route("/<path:path>")` always returns the same HTML template, and all routing is handled by JavaScript inside that template.

---

## 3. Routing with Wouter & Hash URLs

**Wouter** is a minimalist routing library (like React Router, but smaller). Stitch uses it with a custom hook called `useHashLocation` to enable **hash-based routing**.

### Hash Routing Explained

Normal routing:
- User visits `https://stitch.app/scan`
- Browser requests `/scan` from the server
- Server must respond with the app HTML

Hash routing:
- User visits `https://stitch.app/#/scan`
- Browser requests `/` from the server (only the part before `#` is sent)
- Server always returns `index.html` regardless
- JavaScript reads the `#/scan` fragment and renders the Scan page

**Why hash routing?** On Render.com's free tier (and many static hosts), every URL path must be mapped to a file. `/scan` would 404 because there's no `scan.html`. With hash routing, the server always sees `/` and always returns `index.html`. The `#` fragment is purely client-side.

**`useHashLocation` implementation** (in `client/src/App.tsx`):

```typescript
function useHashLocation(): [string, (to: string) => void] {
  const [loc, setLoc] = useState(() => window.location.hash.slice(1) || "/");

  useEffect(() => {
    const handler = () => setLoc(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);  // cleanup
  }, []);

  const navigate = (to: string) => {
    window.location.hash = to;
  };

  return [loc, navigate];
}
```

**Python analogy**: This is like a Flask `@app.before_request` that reads `request.args.get('page')` from a query string instead of the URL path. The server doesn't know which page is shown; the client decides.

### Route Definitions

```tsx
// client/src/App.tsx
import { Router, Route, Switch } from "wouter";

function AppContent() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/quiz" component={StyleQuiz} />
        <Route path="/" component={Home} />
        <Route path="/scan" component={Scan} />
        <Route path="/results/:id" component={Results} />
        <Route path="/history" component={History} />
        <Route path="/profile" component={Profile} />
        <Route path="/discover" component={Discover} />
        <Route path="/for-you" component={ForYou} />
        <Route path="/wardrobe" component={Wardrobe} />
        <Route path="/how-it-works" component={HowItWorks} />
      </Switch>
    </Router>
  );
}
```

**`/results/:id`** — the `:id` is a URL parameter, like Flask's `<int:id>`. In the Results page:

```typescript
import { useParams } from "wouter";

function Results() {
  const { id } = useParams();  // e.g. id = "42"
  // fetch /api/scan/42
}
```

### Navigating Between Pages

```typescript
import { useLocation } from "wouter";

function SomeComponent() {
  const [, navigate] = useLocation();  // destructure [currentPath, navigateFn]
  
  const handleClick = () => {
    navigate("/scan");  // changes hash to #/scan, re-renders Scan page
  };
  
  return <button onClick={handleClick}>Go to Scan</button>;
}
```

---

## 4. App Entry Point & Startup Sequence

### Boot Sequence

When a user opens the app for the first time, this sequence happens:

```
1. Browser loads index.html
2. Browser downloads and runs the JavaScript bundle
3. React mounts the <App /> component
4. LoadingScreen appears (polls /api/health until server is ready)
5. AppContent checks localStorage for 'stitch_quiz_done'
   → Not found: redirect to /quiz
   → Found: continue to home
6. AppContent syncs DB gender → localStorage (GET /api/user/profile)
7. User is on the home page
```

### LoadingScreen Component

The LoadingScreen exists because Render.com's free tier *spins down* the backend after 15 minutes of inactivity. The first request wakes it up, which takes 10–30 seconds. The LoadingScreen hides this cold-start delay from the user.

```tsx
// client/src/components/LoadingScreen.tsx (simplified)
function LoadingScreen({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(true);
  const minShown = useRef(false);

  useEffect(() => {
    const minTimer = setTimeout(() => { minShown.current = true; }, 1200);
    const maxTimer = setTimeout(() => setVisible(false), 3000);  // give up after 3s

    // Poll /api/health
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok && minShown.current) {
          clearInterval(poll);
          setVisible(false);  // server ready + min time elapsed
        }
      } catch (_) {}  // server still waking up, keep polling
    }, 500);

    return () => {
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (!visible) onDone();  // notify parent when done
  }, [visible]);

  if (!visible) return null;
  return <div className="loading-overlay">...spinner...</div>;
}
```

**Python analogy**: This is like a `while True: requests.get(url)` health-check loop, but in the browser, using `setInterval` instead of a loop.

### `useEffect` — React's Lifecycle Hook

`useEffect` runs *after* the component renders. It's used for side effects — API calls, event listeners, timers — that shouldn't happen during rendering.

```typescript
useEffect(() => {
  // This runs after the component mounts (appears on screen)
  fetchUserProfile();
  
  return () => {
    // This runs when the component unmounts (disappears)
    // Clean up subscriptions, timers, etc.
  };
}, [userId]);  // Dependency array: re-run if userId changes
```

**Python analogy**: Think of `useEffect` as an `__init__` method that runs after the UI is initialised, and the return function as `__del__`.

---

## 5. State Management Strategy

Stitch uses three types of state:

### 1. Component State (`useState`)

Local UI state that lives inside a single component. When it changes, only that component re-renders.

```typescript
function ScanPage() {
  const [image, setImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setIsLoading(true);
    try {
      const result = await uploadImage(file);
      setImage(result.imageUrl);
    } catch (e) {
      setError("Upload failed");
    } finally {
      setIsLoading(false);
    }
  };
}
```

**Python analogy**: Like instance variables (`self.image`, `self.is_loading`), but changing them triggers a UI re-render.

### 2. localStorage (Persistent State)

User identity and preferences that must survive page refreshes and app restarts.

| Key | Value | Used For |
|-----|-------|----------|
| `stitch_device_id` | UUID string | Identifies device across sessions |
| `stitch_user_id` | UUID string | Links to `user_profiles` DB row |
| `stitch_profile` | JSON object | Cached copy of gender/onboarding status |
| `stitch_quiz_done` | `"true"` | Controls whether quiz redirect fires |
| `stitch_style_vector` | JSON float array | Client-side aesthetic taste tracker |

**Python analogy**: `localStorage` is like Python's `shelve` module or `pickle` — it persists Python objects to disk. But it's browser-specific and limited to strings.

```typescript
// Writing
localStorage.setItem("stitch_quiz_done", "true");

// Reading
const done = localStorage.getItem("stitch_quiz_done");  // "true" or null

// Deleting
localStorage.removeItem("stitch_quiz_done");

// Reading a JSON object
const profile = JSON.parse(localStorage.getItem("stitch_profile") || "{}");
```

### 3. Server State (API-fetched data)

Data from the backend. Stitch uses both native `fetch` and TanStack Query's `useQuery` for this.

```typescript
// Simple fetch (used in most pages)
const [listings, setListings] = useState([]);
useEffect(() => {
  fetch(`/api/for-you?userId=${userId}&gender=${gender}`)
    .then(r => r.json())
    .then(data => setListings(data.results));
}, [userId]);

// TanStack Query (for automatic caching + refetching)
const { data, isLoading } = useQuery({
  queryKey: ["forYou", userId],
  queryFn: () => fetch(`/api/for-you?userId=${userId}`).then(r => r.json()),
  staleTime: 5 * 60 * 1000,  // consider fresh for 5 minutes
});
```

---

## 6. localStorage — The User Identity System

Two files manage the identity system: `client/src/lib/deviceId.ts`.

### `getDeviceId()`

Returns the device ID, creating and persisting it if this is the first visit:

```typescript
// client/src/lib/deviceId.ts
export function getDeviceId(): string {
  let id = localStorage.getItem("stitch_device_id");
  if (!id) {
    id = crypto.randomUUID();  // e.g. "f47ac10b-58cc-4372-a567-0e02b2c3d479"
    localStorage.setItem("stitch_device_id", id);
  }
  return id;
}
```

### `getOrCreateUserId()`

Returns or creates the user ID, and tells the backend to create a `user_profiles` row if it doesn't exist yet:

```typescript
export async function getOrCreateUserId(): Promise<string> {
  let userId = localStorage.getItem("stitch_user_id");
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem("stitch_user_id", userId);
    // Create DB row
    await fetch("/api/user/profile", {
      method: "POST",
      body: JSON.stringify({ userId }),
      headers: { "Content-Type": "application/json" }
    });
  }
  return userId;
}
```

**Important**: There's no login system. The device ID and user ID are UUIDs stored in localStorage. If a user clears their browser storage, they get a fresh identity and lose their history. This is a deliberate simplification for a side project — no auth infrastructure needed.

---

## 7. Making API Calls

All API calls go to the same Express backend serving the app. Because the frontend and backend are co-located (both served from port 5000 in production), relative URLs work:

```typescript
// This works in both dev (Vite proxies to Express) and prod (Express serves both)
const response = await fetch("/api/scan", {
  method: "POST",
  body: JSON.stringify({ image: base64Image, deviceId }),
  headers: { "Content-Type": "application/json" },
});

const data = await response.json();
```

**In development**: Vite has a proxy config that forwards `/api/*` requests from port 5173 (Vite dev server) to port 5000 (Express). Users hit the Vite server but API calls go to Express:

```typescript
// vite.config.ts
export default {
  server: {
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
};
```

**Python analogy**: Like running Flask on port 5000 and a separate dev server on port 3000, with the dev server configured to proxy `/api` calls to Flask.

### Error Handling Pattern

```typescript
async function callApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

// Usage
try {
  const scan = await callApi<ScanResult>("/api/scan", { method: "POST", body: ... });
} catch (e) {
  setError(e.message);
}
```

---

## 8. Page-by-Page Walkthrough

### `/quiz` — `styleQuiz.tsx` (First-time Onboarding)

**What it does**: Shows a multi-step quiz to learn the user's style preferences. Results seed their `taste_vector` in the database.

**Flow**:
1. Display aesthetic options with images (e.g. "Dark Academia", "Streetwear", "Cottagecore")
2. User selects 3+ aesthetics they like
3. User selects their gender preference
4. On submit: POST to `/api/user/onboard` with picks
5. Backend calls `getAverageEmbeddingForAesthetics(picks)` → sets initial `taste_vector`
6. Frontend sets `localStorage.setItem("stitch_quiz_done", "true")`
7. Navigate to `/`

**Key state**:
```typescript
const [selectedAesthetics, setSelectedAesthetics] = useState<string[]>([]);
const [gender, setGender] = useState<"male" | "female" | "both">("both");
const [step, setStep] = useState<"aesthetics" | "gender" | "done">("aesthetics");
```

### `/` — `home.tsx` (Main Feed, 53KB)

The largest file in the codebase (53KB). This is the main page with two tabs:
- **For You** — personalised Depop listings based on taste vector
- **Trending** — cache-fresh listings from the curated seed queries

**Why is it so large?** It handles a lot: tab switching, infinite scroll, listing cards, gender filtering, style filtering, liked-item tracking, the "scan" CTA, and multiple fetch paths.

**Data fetch**:
```typescript
// For You tab
const { data: forYouData } = useQuery({
  queryKey: ["forYou", userId, gender],
  queryFn: () => fetch(`/api/for-you?userId=${userId}&gender=${gender}`).then(r => r.json()),
});

// Trending tab
const { data: trendingData } = useQuery({
  queryKey: ["trending", gender],
  queryFn: () => fetch(`/api/trending?gender=${gender}`).then(r => r.json()),
});
```

**Liked items**: When a user taps the heart on a listing, the page calls:
1. `POST /api/user/interact` — updates DB taste vector + liked_ids
2. `onLike(listing)` from `styleVector.ts` — updates client-side style vector in localStorage

### `/scan` — `scan.tsx` (Camera/Upload)

**What it does**: Lets the user take a photo or upload an image, then sends it to the backend for Gemini analysis.

**Image capture options**:
1. File input (`<input type="file" accept="image/*">`) — works on desktop and mobile
2. Camera capture (`<input type="file" accept="image/*" capture="environment">`) — opens camera on mobile

**Image processing before upload**:
```typescript
// Convert File to base64 before sending to API
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);  // data:image/jpeg;base64,...
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Upload to backend
const imageBase64 = await fileToBase64(selectedFile);
const response = await fetch("/api/scan", {
  method: "POST",
  body: JSON.stringify({
    image: imageBase64,
    deviceId: getDeviceId(),
    userId: await getOrCreateUserId(),
  }),
  headers: { "Content-Type": "application/json" },
});
const { scanId } = await response.json();
navigate(`/results/${scanId}`);  // Go to results page
```

**Python analogy**: `FileReader` is like Python's `base64.b64encode(file.read())`.

### `/results/:id` — `results.tsx` (Post-Analysis)

**What it does**: Displays the Gemini analysis and Depop product recommendations for a scan.

**Data fetch**:
```typescript
const { id } = useParams();
const [scan, setScan] = useState(null);

useEffect(() => {
  fetch(`/api/scan/${id}`)
    .then(r => r.json())
    .then(data => {
      setScan({
        ...data,
        styleBreakdown: JSON.parse(data.styleBreakdown),  // parse JSON strings
        keyPieces: JSON.parse(data.keyPieces),
        occasions: JSON.parse(data.occasions),
        results: JSON.parse(data.results),
      });
    });
}, [id]);
```

**Displayed elements**:
- Aesthetic name + confidence badge
- Style breakdown chart (list of percentages)
- Occasion tags
- Key pieces list
- Colour palette swatches (hex circles)
- Depop product grid (image, title, price, "Shop on Depop" button)

### `/discover` — `discover.tsx` (TikTok-Style Cards)

**What it does**: Full-screen swipeable outfit cards from Reddit. Swipe right = like, swipe left = skip.

**Swipe implementation**: Uses CSS `transform: translateX()` and touch event handlers:
```typescript
const [dragX, setDragX] = useState(0);
const [isDragging, setIsDragging] = useState(false);

const handleTouchMove = (e: TouchEvent) => {
  const delta = e.touches[0].clientX - startX;
  setDragX(delta);
};

const handleTouchEnd = () => {
  if (dragX > 80) likeCard();   // swiped right
  if (dragX < -80) skipCard();  // swiped left
  setDragX(0);  // snap back if not decisive enough
};
```

**Cards are pre-fetched in batches**: `GET /api/discover?limit=20` loads 20 cards at once. When the user reaches card 15, the next batch is fetched in the background.

### `/for-you` — `forYou.tsx` (Personalised Depop Feed)

The dedicated full-page For You view — similar to the home page tab but with more filtering options and a larger grid.

### `/profile` — `profile.tsx` (User Settings)

**What it does**: Lets the user update gender preference and view their style preferences.

**Gender update flow**:
```typescript
const handleGenderChange = async (newGender: "male" | "female" | "both") => {
  // 1. Update DB
  await fetch("/api/user/profile", {
    method: "PATCH",
    body: JSON.stringify({ userId, gender: newGender }),
    headers: { "Content-Type": "application/json" },
  });
  
  // 2. Update localStorage cache
  const cached = JSON.parse(localStorage.getItem("stitch_profile") || "{}");
  localStorage.setItem("stitch_profile", JSON.stringify({ ...cached, gender: newGender }));
  
  setGender(newGender);  // update local state → re-render
};
```

### `/history` — `history.tsx` (Past Scans + Liked Items)

Two sections:
1. **Scan History**: Past outfit analyses. Fetched from `GET /api/scans?deviceId=...`
2. **Liked Items**: Items the user hearted. Fetched from `GET /api/user/liked-items?userId=...`

### `/wardrobe` — `wardrobe.tsx`

A personal wardrobe manager. Users can add items manually (photo + label + category). Reads/writes from the `wardrobe_items` DB table.

---

## 9. Component Architecture

### TopBar Component

The navigation header displayed on every page. Contains:
- Stitch logo (Bebas Neue font)
- Navigation links (home, scan, discover, history, profile)
- Active state highlighting based on current route

```tsx
function TopBar() {
  const [location] = useLocation();  // current hash path

  return (
    <nav className="top-bar">
      <span className="logo">STITCH</span>
      <NavLink href="/" active={location === "/"}>Home</NavLink>
      <NavLink href="/scan" active={location === "/scan"}>Scan</NavLink>
      <NavLink href="/discover" active={location === "/discover"}>Discover</NavLink>
      {/* ... */}
    </nav>
  );
}
```

### shadcn/ui Components

shadcn/ui provides pre-built accessible components. Unlike traditional component libraries, shadcn copies the source code into your `components/ui/` directory — you own the code and can customise it freely.

Common components used:
- `Button` — styled buttons with variants (primary, outline, ghost)
- `Card` — white rounded content containers
- `Badge` — small label tags (e.g. aesthetic names)
- `Sheet` — slide-in panel (used for mobile filter menus)
- `Tabs` — tab switching (For You / Trending)
- `Skeleton` — loading placeholder animation

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Usage
<Button variant="outline" onClick={handleScan}>
  Scan Outfit
</Button>
<Badge className="bg-purple-100 text-purple-800">Dark Academia</Badge>
```

---

## 10. The Style Vector (Client-Side AI)

`client/src/lib/styleVector.ts` manages a **second taste vector** stored in localStorage. This is separate from the DB taste vector.

**Why a client-side vector?** Latency. Updating the DB vector requires an async API call. The client-side vector can be updated instantly without any network request, and is used for real-time UI decisions (e.g. reordering cards immediately after a like).

### AESTHETICS List

The file defines a list of 41 aesthetics with numeric "coordinates" — a simplified 5-dimensional vector representing where each aesthetic falls in style space:

```typescript
const AESTHETICS: Record<string, number[]> = {
  "Dark Academia":     [0.9, 0.1, 0.2, 0.8, 0.3],  // [dark, streetwear, casual, elegant, feminine]
  "Cottagecore":       [0.3, 0.0, 0.8, 0.6, 0.9],
  "Streetwear":        [0.4, 0.9, 0.3, 0.2, 0.1],
  "Quiet Luxury":      [0.2, 0.1, 0.2, 0.9, 0.5],
  // ... 37 more
};
```

### `onLike`, `onSkip`, `onResultSaved`

These functions update the `stitch_style_vector` in localStorage using the same weighted-average formula as the DB:

```typescript
// client/src/lib/styleVector.ts
export function onLike(aesthetic: string): void {
  const vec = getStyleVector();  // from localStorage
  const aestheticVec = AESTHETICS[aesthetic];
  if (!aestheticVec) return;

  const updated = vec.map((v, i) => v * 0.9 + aestheticVec[i] * 0.1);
  // "90% old taste, 10% new signal" — exponential moving average
  localStorage.setItem("stitch_style_vector", JSON.stringify(updated));
}
```

**Python analogy**:
```python
def update_ema(old_vec: list, new_signal: list, alpha=0.1) -> list:
    """Exponential moving average — same as onLike"""
    return [old * (1 - alpha) + new * alpha for old, new in zip(old_vec, new_signal)]
```

---

## 11. Design System & Theming

### Colours

Defined in `index.css` as CSS custom properties (variables):

```css
:root {
  --background: #F8F7FF;      /* Light lavender white */
  --foreground: #0E0F16;      /* Near-black */
  --primary: #5088B8;         /* Stitch blue */
  --primary-foreground: #fff;
  --muted: #f1f0f9;
  --border: #e2e1f0;
}

.dark {
  --background: #0E0F16;
  --foreground: #F8F7FF;
  /* ... dark mode overrides */
}
```

Tailwind classes like `bg-background` and `text-foreground` automatically use these CSS variables, so dark mode works just by toggling a `dark` class on `<html>`.

### Fonts

Loaded via Google Fonts in `index.html`:

| Font | Usage | CSS variable |
|------|-------|-------------|
| Cormorant Garamond | Display headings, aesthetic labels | `font-cormorant` |
| Jost | Labels, navigation, buttons | `font-jost` |
| DM Sans | Body text, descriptions | `font-dm-sans` |
| Bebas Neue | Logo "STITCH" | `font-bebas` |

### Tailwind CSS

Tailwind applies CSS through class names on HTML elements. Instead of writing a CSS file:

```css
/* Traditional CSS */
.scan-button {
  background-color: #5088B8;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
}
```

You apply utility classes directly in JSX:

```tsx
// Tailwind in React
<button className="bg-primary text-white px-6 py-3 rounded-lg font-semibold">
  Scan
</button>
```

**Python analogy**: It's like Bootstrap's `btn btn-primary` classes, but you can compose any CSS property directly as a class name. `p-4` = `padding: 1rem`, `text-xl` = `font-size: 1.25rem`, etc.

---

## 12. TypeScript for Python Developers

TypeScript adds static types to JavaScript. Types are checked at compile time (when Vite builds the app) but are erased at runtime — the browser runs plain JavaScript.

### Basic Types

```typescript
// TypeScript
let name: string = "Alex";
let age: number = 25;
let isOnboarded: boolean = false;
let tags: string[] = ["dark academia", "vintage"];
let id: string | null = null;  // union type — string OR null
```

```python
# Python with type hints (equivalent)
name: str = "Alex"
age: int = 25
is_onboarded: bool = False
tags: list[str] = ["dark academia", "vintage"]
id: str | None = None
```

### Interfaces & Types

```typescript
// TypeScript interface — like a Python dataclass or TypedDict
interface Listing {
  id: string;
  title: string;
  price: string;
  imageUrl: string;
  gender: "male" | "female" | "both";
  likes: number;
}

// Using it
const item: Listing = {
  id: "dep-123",
  title: "Vintage Blazer",
  price: "35.00",
  imageUrl: "https://...",
  gender: "female",
  likes: 47,
};
```

```python
# Python TypedDict equivalent
from typing import TypedDict, Literal

class Listing(TypedDict):
    id: str
    title: str
    price: str
    image_url: str
    gender: Literal["male", "female", "both"]
    likes: int
```

### Generic Types

```typescript
// useState<T> — T is the type of the state value
const [listings, setListings] = useState<Listing[]>([]);
const [scanId, setScanId] = useState<number | null>(null);

// API response type
async function fetchScan(id: number): Promise<Scan> {
  const res = await fetch(`/api/scan/${id}`);
  return res.json() as Promise<Scan>;
}
```

```python
# Python generic equivalent
from typing import Generic, TypeVar

T = TypeVar("T")
async def fetch_data(url: str) -> T: ...
```

### Optional Chaining

```typescript
// Safe property access — returns undefined instead of throwing if null
const aesthetic = scan?.styleBreakdown?.[0]?.label;
// Equivalent to:
// scan && scan.styleBreakdown && scan.styleBreakdown[0] && scan.styleBreakdown[0].label
```

```python
# Python equivalent (no built-in safe navigation, but can use getattr)
aesthetic = (scan or {}).get("style_breakdown", [{}])[0].get("label")
# Or with walrus operator:
aesthetic = (sb := (scan or {}).get("style_breakdown")) and sb[0].get("label")
```

### Non-Null Assertion

```typescript
const userId = localStorage.getItem("stitch_user_id")!;
// The ! says "I know this isn't null" — removes null from the type
// Will crash at runtime if it actually is null
```

---

## 13. Build System: Vite

Vite is the build tool — it processes TypeScript, JSX, CSS, and static assets into a browser-ready bundle.

**Development mode** (`npm run dev`):
- Starts the Vite dev server on port 5173
- Hot Module Replacement (HMR): when you save a file, the browser updates without full reload
- TypeScript errors shown in the terminal
- API requests proxied to Express on port 5000

**Production build** (`npm run build`):
- Compiles TypeScript → JavaScript
- Bundles all imports into a few optimised files
- Output goes to `dist/public/`
- Express's `server/static.ts` serves this directory

**Key config** (`vite.config.ts`):
```typescript
export default defineConfig({
  plugins: [react()],  // enables JSX processing and HMR
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist/public",
    rollupOptions: {
      // Code splitting — splits vendor libraries into separate chunks
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          ui: ["@radix-ui/react-tabs", "@radix-ui/react-dialog"],
        },
      },
    },
  },
});
```

**Python analogy**: Vite is like `setuptools` + `uvicorn` in one. In development it's the dev server with auto-reload. For production it's the build tool that packages everything into static files.

---

## AppContent Startup: Full Detail

```tsx
function AppContent() {
  const [, navigate] = useLocation();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      // 1. Ensure user has an ID
      const uid = await getOrCreateUserId();
      setUserId(uid);

      // 2. Check if quiz is done
      const quizDone = localStorage.getItem("stitch_quiz_done");
      if (!quizDone) {
        navigate("/quiz");
        return;
      }

      // 3. Sync gender from DB → localStorage
      // (in case user changed it on another device — though there's no login,
      // this just ensures the local cache isn't stale after a fresh install)
      try {
        const profile = await fetch(`/api/user/profile?userId=${uid}`).then(r => r.json());
        const cached = JSON.parse(localStorage.getItem("stitch_profile") || "{}");
        localStorage.setItem("stitch_profile", JSON.stringify({
          ...cached,
          gender: profile.gender,
          onboarded: profile.onboarded,
        }));
      } catch (_) {
        // Non-fatal — use cached profile if DB unreachable
      }
    }

    init();
  }, []);

  return (
    <Switch>
      <Route path="/quiz" component={StyleQuiz} />
      <Route path="/" component={Home} />
      {/* ... */}
    </Switch>
  );
}
```
