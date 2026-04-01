"use client";

import { useProcessLog } from "@/lib/process-log-context";
import styles from "./ProcessLog.module.css";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  onClose?: () => void;
};

// ── Component ──────────────────────────────────────────────────────────────

export default function ProcessLog({ onClose }: Props) {
  const { steps } = useProcessLog();

  const lastStepIndex = steps.length - 1;

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
          <p className={styles.empty}>
            Steps will appear here as the AI works.
          </p>
        ) : (
          steps.map((step, index) => {
            // The dot pulses on the last step while the AI is still working.
            // Once the final step is "Done", the pulse stops.
            const isInProgress = index === lastStepIndex && step !== "Done";

            return (
              <div key={index} className={styles.event}>
                <div className={styles.eventHeader}>
                  <span
                    className={`${styles.dot} ${isInProgress ? styles.dotActive : ""}`}
                  />
                  <span className={styles.label}>{step}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
