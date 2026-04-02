"use client";

import { useToolCalls } from "@/lib/tool-calls-context";
import type { ProcessStep } from "@/lib/types";
import styles from "./ToolCalls.module.css";

// ── Helpers ────────────────────────────────────────────────────────────────

function dotClass(step: ProcessStep): string {
  if (step.status === "active") return `${styles.dot} ${styles.dotActive}`;
  if (step.status === "error") return `${styles.dot} ${styles.dotError}`;
  return styles.dot;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ToolCalls() {
  const { steps, closePanel } = useToolCalls();

  return (
    <aside className={styles.panel}>
      <div className={styles.headerRow}>
        <h2 className={styles.heading}>Tool calls</h2>
        <button
          onClick={closePanel}
          className={styles.closeBtn}
          type="button"
          aria-label="Close tool calls"
        >
          ×
        </button>
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

              {step.kind === "tool" && step.params && (
                <p className={styles.params}>{step.params}</p>
              )}

              {step.kind === "tool" && step.detail && (
                <p
                  className={
                    step.status === "error" ? styles.detailError : styles.detail
                  }
                >
                  {step.detail}
                </p>
              )}

              {step.kind === "tool" && step.apiUrl && step.status === "done" && (
                <div className={styles.apiLinkRow}>
                  <a
                    href={step.apiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.apiLink}
                  >
                    {new URL(step.apiUrl).hostname.replace(/^www\./, "")}
                  </a>
                </div>
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
