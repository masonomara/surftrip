"use client";

import styles from "./ThinkingIndicator.module.css";

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
      <svg className={styles.arrow} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
