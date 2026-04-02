"use client";

import styles from "./ThinkingIndicator.module.css";
import { ChevronRight } from "lucide-react";

type Props = {
  mode: "active" | "complete";
  label: string;
  onClick: () => void;
};

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
          width="20"
          height="20"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            className={styles.squigglePath}
            d="M-16,10 C-12,3 -12,3 -8,10 C-4,17 -4,17 0,10 C4,3 4,3 8,10 C12,17 12,17 16,10 C20,3 20,3 24,10 C28,17 28,17 32,10 C36,3 36,3 40,10 C44,17 44,17 48,10 C52,3 52,3 56,10"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className={styles.label}>{label}</span>
      <ChevronRight size={16} strokeWidth={1.75} className={styles.arrow} aria-hidden="true" />
    </button>
  );
}
