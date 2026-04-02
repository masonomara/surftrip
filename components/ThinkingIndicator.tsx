"use client";

import styles from "./ThinkingIndicator.module.css";
import { ChevronRight } from "lucide-react";

type Props =
  | { mode: "active";   label: string; onClick: () => void }
  | { mode: "complete"; label: string; onClick: () => void };

export default function ThinkingIndicator({ mode, label, onClick }: Props) {
  return (
    <button
      className={styles.btn}
      onClick={onClick}
      type="button"
      aria-label={label}
      aria-live={mode === "active" ? "polite" : undefined}
    >
      {mode === "active" && (
        <svg
          className={styles.squiggle}
          width="40"
          height="8"
          viewBox="0 0 40 8"
          aria-hidden="true"
        >
          <path
            className={styles.squigglePath}
            d="M-16,4 C-12,1 -12,1 -8,4 C-4,7 -4,7 0,4 C4,1 4,1 8,4 C12,7 12,7 16,4 C20,1 20,1 24,4 C28,7 28,7 32,4 C36,1 36,1 40,4 C44,7 44,7 48,4 C52,1 52,1 56,4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className={styles.label}>{label}</span>
      <ChevronRight size={12} className={styles.arrow} aria-hidden="true" />
    </button>
  );
}
