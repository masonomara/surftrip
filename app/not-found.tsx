import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page Not Found",
  description: "The page you are looking for does not exist.",
  robots: { index: false, follow: false },
};

// ── Component ──────────────────────────────────────────────────────────────

export default function NotFound() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        gap: "1rem",
        fontFamily: "var(--font-inter), sans-serif",
        color: "var(--color-text-primary)",
        backgroundColor: "var(--color-surface-1)",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "4rem", fontWeight: 700, margin: 0 }}>404</h1>
      <p style={{ fontSize: "1.125rem", color: "var(--color-text-secondary)", margin: 0 }}>
        This page doesn&apos;t exist.
      </p>
      <Link
        href="/"
        style={{
          marginTop: "0.5rem",
          padding: "0.625rem 1.25rem",
          borderRadius: "0.5rem",
          backgroundColor: "var(--color-surface-3)",
          color: "var(--color-text-primary)",
          textDecoration: "none",
          fontSize: "0.9375rem",
        }}
      >
        Back to Surftrip
      </Link>
    </main>
  );
}
