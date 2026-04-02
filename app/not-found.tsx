import Link from "next/link";
import type { Metadata } from "next";
import styles from "./(auth)/auth.module.css";

export const metadata: Metadata = {
  title: "Page Not Found",
  description: "The page you are looking for does not exist.",
  robots: { index: false, follow: false },
};

// ── Component ──────────────────────────────────────────────────────────────

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.container} style={{ textAlign: "center" }}>
        <h1 className={styles.title}>404</h1>
        <p className={styles.subtitle}>This page doesn&apos;t exist.</p>
        <Link href="/" className={styles.button} style={{ display: "flex", justifyContent: "center", textDecoration: "none" }}>
          Back to Surftrip
        </Link>
      </div>
    </main>
  );
}
