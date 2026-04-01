"use client";

import { useState, useEffect, useRef } from "react";
import ConversationSidebar from "./ConversationSidebar";
import ProcessLog from "./ProcessLog";
import type { Tables } from "@/lib/types";
import styles from "./AppShell.module.css";

type ConversationSummary = Pick<
  Tables<"conversations">,
  "id" | "title" | "updated_at"
>;

type Props = {
  serverConversations: ConversationSummary[];
  isAuthenticated: boolean;
  children: React.ReactNode;
};

const MOBILE_MAX = 768;
const TABLET_MAX = 1239;

function getBreakpoint() {
  if (typeof window === "undefined") return { mobile: false, tablet: false };
  const w = window.innerWidth;
  return {
    mobile: w <= MOBILE_MAX,
    tablet: w > MOBILE_MAX && w <= TABLET_MAX,
  };
}

export default function AppShell({
  serverConversations,
  isAuthenticated,
  children,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);

  const [isMobile, setIsMobile] = useState(() => getBreakpoint().mobile);
  const [isTablet, setIsTablet] = useState(() => getBreakpoint().tablet);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const { mobile } = getBreakpoint();
    return !mobile;
  });
  const [processLogOpen, setProcessLogOpen] = useState(() => {
    const { mobile, tablet } = getBreakpoint();
    return !mobile && !tablet;
  });

  useEffect(() => {
    // Enable CSS transitions only after mount to avoid flash on initial render
    shellRef.current?.classList.add(styles.hydrated);

    function handleResize() {
      const { mobile, tablet } = getBreakpoint();
      setIsMobile(mobile);
      setIsTablet(tablet);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const sidebarIsOverlay = isMobile;
  const processLogIsOverlay = isMobile || isTablet;

  return (
    <div ref={shellRef} className={styles.shell}>
      {/* Sidebar — docked on tablet/desktop, overlay on mobile */}
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

      {/* Main content */}
      <main className={styles.main}>
        {/* Fixed toggle button — desktop/tablet only (process log) */}
        <button
          className={`${styles.toggleBtn} ${styles.processLogToggle}`}
          onClick={() => setProcessLogOpen((v) => !v)}
          aria-label="Toggle process log"
          type="button"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="5"
              width="14"
              height="1.5"
              rx="0.75"
              fill="currentColor"
            />
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
        </button>

        {/* Mobile header — replaces fixed buttons on small screens */}
        <header className={styles.mobileHeader}>
          <button
            className={styles.mobileIconBtn}
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
            type="button"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="2"
                y="5"
                width="16"
                height="1.5"
                rx="0.75"
                fill="currentColor"
              />
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
          </button>
          <span className={styles.mobileWordmark}>Surftrip</span>
          <button
            className={styles.mobileIconBtn}
            onClick={() => setProcessLogOpen((v) => !v)}
            aria-label="Toggle process log"
            type="button"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="3"
                y="5"
                width="14"
                height="1.5"
                rx="0.75"
                fill="currentColor"
              />
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
          </button>
        </header>

        {children}
      </main>

      {/* Process log — docked on desktop, overlay on tablet/mobile */}
      {processLogIsOverlay ? (
        <>
          {processLogOpen && (
            <div
              className={styles.backdrop}
              onClick={() => setProcessLogOpen(false)}
              aria-hidden="true"
            />
          )}
          <div
            className={`${styles.processLogOverlay} ${processLogOpen ? styles.processLogOverlayOpen : ""}`}
          >
            <ProcessLog onClose={() => setProcessLogOpen(false)} />
          </div>
        </>
      ) : (
        <div className={styles.processLogDocked}>
          <ProcessLog />
        </div>
      )}
    </div>
  );
}
