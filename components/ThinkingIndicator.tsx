"use client";

import styles from "./ThinkingIndicator.module.css";

type Props = {
  label: string;
};

export default function ThinkingIndicator({ label }: Props) {
  return (
    <div className={styles.container} aria-live="polite" aria-label={label}>
      <div className={styles.dots}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
