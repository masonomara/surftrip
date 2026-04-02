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
        <div className={styles.dots}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
      )}
      <span className={styles.label}>{label}</span>
      <ChevronRight size={12} className={styles.arrow} aria-hidden="true" />
    </button>
  );
}
