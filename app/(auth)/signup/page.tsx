"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "../auth.module.css";

const supabaseEnabled = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

// ── Component ──────────────────────────────────────────────────────────────

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!supabaseEnabled) router.replace("/");
  }, [router]);

  if (!supabaseEnabled) return null;

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      setErrorMessage(authError.message);
      setIsSubmitting(false);
      return;
    }

    // push() navigates to the home page; refresh() forces the Server Components
    // (layout, sidebar) to re-render with the now-authenticated session.
    router.push("/");
    router.refresh();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Surftrip</h1>
        <p className={styles.subtitle}>Create an account</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.fieldGroup}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={styles.input}
            />
          </div>
          <div className={styles.fieldGroup}>
            <input
              type="password"
              placeholder="Password (8+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className={styles.input}
            />
          </div>

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className={styles.button}
          >
            {isSubmitting ? "Creating account..." : "Sign up"}
          </button>
        </form>

        <p className={styles.footer}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
