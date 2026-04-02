"use client";

import { useState, useEffect, useRef } from "react";
import ConversationSidebar from "./ConversationSidebar";
import ToolCalls from "./ToolCalls";
import type { ConversationSummary } from "@/lib/types";
import styles from "./AppShell.module.css";

// ── Breakpoints ────────────────────────────────────────────────────────────
//
// These must match the media queries in AppShell.module.css.

const MOBILE_BREAKPOINT = 768; // ≤ this → mobile
const TABLET_BREAKPOINT = 1239; // ≤ this (and > mobile) → tablet

type Breakpoint = { isMobile: boolean; isTablet: boolean };

function getBreakpoint(): Breakpoint {
  if (typeof window === "undefined")
    return { isMobile: false, isTablet: false };
  const width = window.innerWidth;
  return {
    isMobile: width <= MOBILE_BREAKPOINT,
    isTablet: width > MOBILE_BREAKPOINT && width <= TABLET_BREAKPOINT,
  };
}

// ── Icons ──────────────────────────────────────────────────────────────────

// Equal-width lines — used for the sidebar (navigation) toggle.
const HamburgerIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    <rect x="2" y="5" width="16" height="1.5" rx="0.75" fill="currentColor" />
    <rect
      x="2"
      y="9.25"
      width="16"
      height="1.5"
      rx="0.75"
      fill="currentColor"
    />
    <rect
      x="2"
      y="13.5"
      width="16"
      height="1.5"
      rx="0.75"
      fill="currentColor"
    />
  </svg>
);

// Unequal-width lines — used for the tool calls toggle (looks like a doc).
const ToolCallsIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="14" height="1.5" rx="0.75" fill="currentColor" />
    <rect
      x="3"
      y="9.25"
      width="10"
      height="1.5"
      rx="0.75"
      fill="currentColor"
    />
    <rect
      x="3"
      y="13.5"
      width="12"
      height="1.5"
      rx="0.75"
      fill="currentColor"
    />
  </svg>
);

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  serverConversations: ConversationSummary[];
  isAuthenticated: boolean;
  children: React.ReactNode;
};

// ── Component ──────────────────────────────────────────────────────────────

export default function AppShell({
  serverConversations,
  isAuthenticated,
  children,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);

  // Derive all breakpoint state from a single getBreakpoint() call at init.
  const [isMobile, setIsMobile] = useState(() => getBreakpoint().isMobile);
  const [isTablet, setIsTablet] = useState(() => getBreakpoint().isTablet);

  // Sidebar starts open unless the user is on mobile.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !getBreakpoint().isMobile,
  );

  // Tool calls panel starts open only on desktop (not mobile, not tablet).
  const [toolCallsOpen, setToolCallsOpen] = useState(
    () => !getBreakpoint().isMobile && !getBreakpoint().isTablet,
  );

  useEffect(() => {
    // CSS transitions are disabled until after mount to prevent a flash where
    // the panels animate in from off-screen on the initial page load.
    shellRef.current?.classList.add(styles.hydrated);

    function handleResize() {
      const { isMobile, isTablet } = getBreakpoint();
      setIsMobile(isMobile);
      setIsTablet(isTablet);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // On mobile, panels slide in over the content (overlay).
  // On tablet/desktop, the sidebar is docked. The tool calls panel is only
  // docked on desktop; on tablet it's still an overlay.
  const sidebarIsOverlay   = isMobile;
  const toolCallsIsOverlay = isMobile || isTablet;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div ref={shellRef} className={styles.shell}>
      {/* Sidebar — overlay on mobile, docked on tablet/desktop */}
      {sidebarIsOverlay ? (
        <>
          {sidebarOpen && (
            <div
              className={styles.backdrop}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
          <div
            className={`${styles.sidebarOverlay} ${sidebarOpen ? styles.sidebarOverlayOpen : ""}`}
          >
            <ConversationSidebar
              serverConversations={serverConversations}
              isAuthenticated={isAuthenticated}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </>
      ) : (
        <div className={styles.sidebarDocked}>
          <ConversationSidebar
            serverConversations={serverConversations}
            isAuthenticated={isAuthenticated}
          />
        </div>
      )}

      {/* Main content area */}
      <main className={styles.main}>
        {/* Desktop/tablet: fixed button to toggle the tool calls panel */}
        <button
          className={`${styles.toggleBtn} ${styles.toolCallsToggle}`}
          onClick={() => setToolCallsOpen((open) => !open)}
          aria-label="Toggle tool calls"
          type="button"
        >
          <ToolCallsIcon />
        </button>

        {/* Mobile: header bar with sidebar + tool calls toggles */}
        <header className={styles.mobileHeader}>
          <button
            className={styles.mobileIconBtn}
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle sidebar"
            type="button"
          >
            <HamburgerIcon />
          </button>

          <span className={styles.mobileWordmark}>Surftrip</span>

          <button
            className={styles.mobileIconBtn}
            onClick={() => setToolCallsOpen((open) => !open)}
            aria-label="Toggle tool calls"
            type="button"
          >
            <ToolCallsIcon />
          </button>
        </header>

        {children}
      </main>

      {/* Tool calls panel — overlay on mobile/tablet, docked on desktop */}
      {toolCallsIsOverlay ? (
        <>
          {toolCallsOpen && (
            <div
              className={styles.backdrop}
              onClick={() => setToolCallsOpen(false)}
              aria-hidden="true"
            />
          )}
          <div
            className={`${styles.toolCallsOverlay} ${toolCallsOpen ? styles.toolCallsOverlayOpen : ""}`}
          >
            <ToolCalls onClose={() => setToolCallsOpen(false)} />
          </div>
        </>
      ) : (
        <div className={styles.toolCallsDocked}>
          <ToolCalls />
        </div>
      )}
    </div>
  );
}
