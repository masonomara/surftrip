"use client";

import { useToolCalls } from "@/lib/tool-calls-context";
import type { ProcessStep } from "@/lib/types";
import styles from "./ToolCalls.module.css";

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
  if (step.status === "error")  return `${styles.dot} ${styles.dotError}`;
  return styles.dot;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ToolCalls({ onClose }: Props) {
  const { steps } = useToolCalls();

  return (
    <aside className={styles.panel}>
      <div className={styles.headerRow}>
        <h2 className={styles.heading}>Tool calls</h2>
        {onClose && (
          <button
            onClick={onClose}
            className={styles.closeBtn}
            type="button"
            aria-label="Close tool calls"
          >
            ×
          </button>
        )}
      </div>

      <div className={styles.events}>
        {steps.filter((s) => s.kind === "tool").length === 0 ? (
          <p className={styles.empty}>Tool calls will appear here as the AI works.</p>
        ) : (
          steps.filter((s) => s.kind === "tool").map((step) => (
            <div key={step.id} className={styles.event}>
              <div className={styles.eventHeader}>
                <span className={dotClass(step)} />
                <span className={styles.label}>{step.label}</span>
              </div>

              {/* Input params — what was queried */}
              {step.kind === "tool" && step.params && (
                <p className={styles.params}>{step.params}</p>
              )}

              {/* Result detail — what came back */}
              {step.kind === "tool" && step.detail && (
                <p className={styles.detail}>{step.detail}</p>
              )}

              {/* API link — clickable endpoint */}
              {step.kind === "tool" && step.apiUrl && (
                <p className={styles.apiLinkRow}>
                  <a
                    href={step.apiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.apiLink}
                    title={step.apiUrl}
                  >
                    {new URL(step.apiUrl).hostname} ↗
                  </a>
                </p>
              )}

              {/* Web search steps can have citation source links */}
              {step.kind === "tool" && step.sources && step.sources.length > 0 && (
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
