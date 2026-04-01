"use client";

import { useProcessLog } from "@/lib/process-log-context";
import styles from "./ProcessLog.module.css";

type Props = {
  onClose?: () => void;
};

export default function ProcessLog({ onClose }: Props) {
  const { steps } = useProcessLog();
  const lastIndex = steps.length - 1;

  return (
    <aside className={styles.panel}>
      <div className={styles.headerRow}>
        <h2 className={styles.heading}>Process log</h2>
        {onClose && (
          <button
            onClick={onClose}
            className={styles.closeBtn}
            type="button"
            aria-label="Close process log"
          >
            ×
          </button>
        )}
      </div>
      <div className={styles.events}>
        {steps.length === 0 ? (
          <p className={styles.empty}>Steps will appear here as the AI works.</p>
        ) : (
          steps.map((step, i) => (
            <div key={i} className={styles.event}>
              <div className={styles.eventHeader}>
                <span
                  className={`${styles.dot} ${i === lastIndex && step !== "Done" ? styles.dotActive : ""}`}
                />
                <span className={styles.label}>{step}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
