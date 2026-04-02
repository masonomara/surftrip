"use client";

import { useProcessLog } from "@/lib/process-log-context";
import type { ProcessStep } from "@/lib/types";
import styles from "./ProcessLog.module.css";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  onClose?: () => void;
};

// ── Helpers ────────────────────────────────────────────────────────────────

// Returns the CSS class string for a step's status dot:
//   active → pulsing yellow dot (in progress)
//   error  → red dot
//   done   → green dot (default)
function dotClass(step: ProcessStep): string {
  if (step.status === "active") return `${styles.dot} ${styles.dotActive}`;
  if (step.status === "error") return `${styles.dot} ${styles.dotError}`;
  return styles.dot;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ProcessLog({ onClose }: Props) {
  const { steps } = useProcessLog();

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
          steps.map((step) => (
            <div key={step.id} className={styles.event}>
              <div className={styles.eventHeader}>
                <span className={dotClass(step)} />
                <span className={styles.label}>{step.label}</span>
              </div>

              {/* Tool steps can have a one-line detail summary below the label */}
              {step.kind === "tool" && step.detail && (
                <p
                  className={
                    step.status === "error" ? styles.detailError : styles.detail
                  }
                >
                  {step.detail}
                </p>
              )}

              {/* Web search steps can have citation source links */}
              {step.kind === "tool" &&
                step.sources &&
                step.sources.length > 0 && (
                  <ul className={styles.sources}>
                    {step.sources.map((source) => (
                      <li key={source.url} className={styles.sourceItem}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.sourceLink}
                          title={source.url}
                        >
                          {source.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
