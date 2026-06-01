/**
 * InstallPrompt.tsx
 * -----------------
 * Shows a native-feeling "Add to Home Screen" overlay when the app is opened
 * in a mobile browser and hasn't been installed yet.
 *
 * Android (Chrome):
 *   Listens for the `beforeinstallprompt` event, captures it, and shows our
 *   custom bottom sheet. When the user taps "Add to Home Screen" we trigger
 *   the native install dialog.
 *
 * iOS (Safari):
 *   Apple does not allow apps to trigger the native prompt. We detect Safari
 *   on iOS and show a manual guide overlay explaining the Share → Add to Home
 *   Screen flow.
 *
 * The prompt is shown:
 *   - Only on mobile (no desktop prompt)
 *   - Only once per session (dismissed state lives in sessionStorage)
 *   - Only when NOT already running in standalone mode (already installed)
 */

import { useEffect, useState } from "react";

// ── Platform detection helpers ──────────────────────────────────────────────

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPad on iOS 13+ identifies as MacIntel but has touch
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isInStandaloneMode(): boolean {
  return (
    ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function isMobile(): boolean {
  return window.innerWidth <= 768 || /Mobi|Android/i.test(navigator.userAgent);
}

// ── Types ───────────────────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function InstallPrompt() {
  const [showIOS, setShowIOS] = useState(false);
  const [showAndroid, setShowAndroid] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false); // controls CSS slide-in

  useEffect(() => {
    // Don't show if already installed or not on mobile
    if (isInStandaloneMode() || !isMobile()) return;

    // Don't show if user already dismissed this session
    if (sessionStorage.getItem("stitch_install_dismissed")) return;

    if (isIOS()) {
      // iOS: show after a short delay so the page has settled
      const t = setTimeout(() => {
        setShowIOS(true);
        setTimeout(() => setVisible(true), 50); // trigger slide-in
      }, 2500);
      return () => clearTimeout(t);
    } else {
      // Android/Chrome: wait for the browser's install event
      const handler = (e: Event) => {
        e.preventDefault(); // stop Chrome's mini infobar
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setTimeout(() => {
          setShowAndroid(true);
          setTimeout(() => setVisible(true), 50);
        }, 2500);
      };
      window.addEventListener("beforeinstallprompt", handler);
      return () => window.removeEventListener("beforeinstallprompt", handler);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    sessionStorage.setItem("stitch_install_dismissed", "1");
    setTimeout(() => {
      setShowIOS(false);
      setShowAndroid(false);
    }, 350);
  }

  async function installAndroid() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
    dismiss();
  }

  if (!showIOS && !showAndroid) return null;

  // ── Shared styles ──────────────────────────────────────────────────────────
  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9998,
    background: "rgba(0,0,0,0.45)",
    backdropFilter: "blur(2px)",
    opacity: visible ? 1 : 0,
    transition: "opacity 0.3s ease",
  };

  const sheetStyle: React.CSSProperties = {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    background: "var(--card, #fff)",
    borderRadius: "20px 20px 0 0",
    padding: "28px 24px 40px",
    boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
    transform: visible ? "translateY(0)" : "translateY(100%)",
    transition: "transform 0.35s cubic-bezier(0.34, 1.2, 0.64, 1)",
  };

  // ── iOS overlay ────────────────────────────────────────────────────────────
  if (showIOS) {
    return (
      <>
        <div style={overlayStyle} onClick={dismiss} />
        <div style={sheetStyle} role="dialog" aria-label="Add Stitch to your home screen">
          {/* Drag handle */}
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border, #e0e0e0)", margin: "0 auto 20px" }} />

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: "#5088B8",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {/* Stitch needle icon */}
              <svg viewBox="0 0 44 44" width="32" height="32" fill="none">
                <path d="M22 8 C22 8 30 16 30 24 C30 28.4 26.4 32 22 32 C17.6 32 14 28.4 14 24 C14 16 22 8 22 8Z"
                  stroke="white" strokeWidth="1.8" fill="none" strokeLinejoin="round"/>
                <path d="M22 18 L22 30" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="22" cy="33" r="2" fill="white"/>
                <path d="M18 22 C19.5 20.5 24.5 20.5 26 22" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              </svg>
            </div>
            <div>
              <p style={{ fontSize: 17, fontWeight: 700, color: "var(--foreground, #111)", margin: 0, lineHeight: 1.2 }}>
                Add Stitch to your Home Screen
              </p>
              <p style={{ fontSize: 13, color: "var(--muted-foreground, #888)", margin: "4px 0 0", lineHeight: 1.4 }}>
                Get the full app experience — fast, offline-ready, no App Store needed.
              </p>
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
            {[
              { n: 1, icon: shareIcon(), text: <>Tap the <strong>Share</strong> button <strong style={{ fontSize: 16 }}>⎦</strong> at the bottom of Safari</> },
              { n: 2, icon: addIcon(), text: <>Scroll down and tap <strong>"Add to Home Screen"</strong></> },
              { n: 3, icon: checkIcon(), text: <>Tap <strong>Add</strong> in the top-right — you're done!</> },
            ].map(({ n, icon, text }) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "rgba(80,136,184,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {icon}
                </div>
                <p style={{ margin: 0, fontSize: 14, color: "var(--foreground, #222)", lineHeight: 1.45 }}>
                  {text}
                </p>
              </div>
            ))}
          </div>

          {/* Dismiss */}
          <button
            onClick={dismiss}
            style={{
              width: "100%", padding: "13px", borderRadius: 100,
              border: "1.5px solid var(--border, #ddd)",
              background: "transparent",
              fontSize: 15, fontWeight: 600,
              color: "var(--muted-foreground, #888)",
              cursor: "pointer",
            }}
          >
            Maybe later
          </button>
        </div>
      </>
    );
  }

  // ── Android bottom sheet ───────────────────────────────────────────────────
  return (
    <>
      <div style={overlayStyle} onClick={dismiss} />
      <div style={sheetStyle} role="dialog" aria-label="Install Stitch">
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border, #e0e0e0)", margin: "0 auto 20px" }} />

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12,
            background: "#5088B8",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg viewBox="0 0 44 44" width="32" height="32" fill="none">
              <path d="M22 8 C22 8 30 16 30 24 C30 28.4 26.4 32 22 32 C17.6 32 14 28.4 14 24 C14 16 22 8 22 8Z"
                stroke="white" strokeWidth="1.8" fill="none" strokeLinejoin="round"/>
              <path d="M22 18 L22 30" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="22" cy="33" r="2" fill="white"/>
              <path d="M18 22 C19.5 20.5 24.5 20.5 26 22" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            </svg>
          </div>
          <div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "var(--foreground, #111)", margin: 0, lineHeight: 1.2 }}>
              Install Stitch
            </p>
            <p style={{ fontSize: 13, color: "var(--muted-foreground, #888)", margin: "4px 0 0", lineHeight: 1.4 }}>
              Add to your home screen for the full app experience — no App Store needed.
            </p>
          </div>
        </div>

        {/* Install button */}
        <button
          onClick={installAndroid}
          style={{
            width: "100%", padding: "14px", borderRadius: 100,
            background: "#5088B8", border: "none",
            fontSize: 15, fontWeight: 700, color: "#fff",
            cursor: "pointer", marginBottom: 10,
            boxShadow: "0 4px 16px rgba(80,136,184,0.35)",
          }}
        >
          Add to Home Screen
        </button>

        {/* Dismiss */}
        <button
          onClick={dismiss}
          style={{
            width: "100%", padding: "13px", borderRadius: 100,
            border: "1.5px solid var(--border, #ddd)",
            background: "transparent",
            fontSize: 15, fontWeight: 600,
            color: "var(--muted-foreground, #888)",
            cursor: "pointer",
          }}
        >
          Maybe later
        </button>
      </div>
    </>
  );
}

// ── Inline SVG helpers (keeps the component self-contained) ─────────────────

function shareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5088B8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
      <polyline points="16 6 12 2 8 6"/>
      <line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  );
}

function addIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5088B8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <line x1="12" y1="8" x2="12" y2="16"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  );
}

function checkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5088B8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}
