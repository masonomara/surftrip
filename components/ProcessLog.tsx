"use client";

import { useProcessLog } from "@/lib/process-log-context";
import styles from "./ProcessLog.module.css";

export default function ProcessLog() {
  const { steps } = useProcessLog();

  return (
    <aside className={styles.panel}>
      <h2 className={styles.heading}>Process log</h2>

      {steps.length === 0 ? (
        <p className={styles.empty}>Steps will appear here as the AI works.</p>
      ) : (
        <ol className={styles.steps}>
          {steps.map((step, i) => (
            <li key={i} className={styles.step}>
              <span className={styles.index}>{i + 1}</span>
              <span className={styles.text}>{step}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
