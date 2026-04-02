"use client";

import { useState, useEffect, useRef } from "react";
import ConversationSidebar from "./ConversationSidebar";
import ToolCalls from "./ToolCalls";
import { useToolCall } from "@/lib/tool-call-context";
import type { ConversationSummary } from "@/lib/types";
import styles from "./AppShell.module.css";
import { Menu } from "lucide-react";

// ── Breakpoints ────────────────────────────────────────────────────────────

const MOBILE_BREAKPOINT = 768;

function getIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

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
  const [isMobile, setIsMobile] = useState(() => getIsMobile());
  const [sidebarOpen, setSidebarOpen] = useState(() => !getIsMobile());
  const { isPanelOpen, closePanel } = useToolCall();

  useEffect(() => {
    shellRef.current?.classList.add(styles.hydrated);
    function handleResize() {
      setIsMobile(getIsMobile());
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div ref={shellRef} className={styles.shell}>
      {/* Sidebar — overlay on mobile, docked on tablet/desktop */}
      {isMobile ? (
        <>
          {sidebarOpen && (
            <div
              className={styles.backdrop}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
          <div className={`${styles.sidebarOverlay} ${sidebarOpen ? styles.sidebarOverlayOpen : ""}`}>
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
        {/* Mobile header — sidebar toggle + wordmark only */}
        <header className={styles.mobileHeader}>
          <button
            className={styles.mobileIconBtn}
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle sidebar"
            type="button"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <span className={styles.mobileWordmark}>Surftrip</span>
          {/* Spacer keeps wordmark centered */}
          <div style={{ width: 40 }} aria-hidden="true" />
        </header>

        {children}
      </main>

      {/* Tool calls panel — always overlay, opened via ThinkingIndicator */}
      {isPanelOpen && (
        <div
          className={styles.backdrop}
          onClick={closePanel}
          aria-hidden="true"
        />
      )}
      <div className={`${styles.toolCallsOverlay} ${isPanelOpen ? styles.toolCallsOverlayOpen : ""}`}>
        <ToolCalls />
      </div>
    </div>
  );
}
