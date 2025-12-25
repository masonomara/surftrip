import { useState } from "react";
import { useSearchParams, Link } from "react-router";
import type { MetaFunction } from "react-router";
import { signUp, signIn, authClient } from "~/lib/auth-client";
import styles from "~/styles/auth.module.css";

export const meta: MetaFunction = () => [
  { title: "Sign Up | Docket" },
  { name: "description", content: "Create your Docket account" },
];

/**
 * Signup page component.
 */
export default function SignupPage() {
  const [searchParams] = useSearchParams();
  const inviteCode = searchParams.get("invite");

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Email verification state
  const [emailSent, setEmailSent] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [hasResent, setHasResent] = useState(false);

  // Redirect URL (respects invite code if present)
  const redirectUrl = inviteCode ? `/invite/${inviteCode}` : "/dashboard";

  /**
   * Handles the signup form submission.
   */
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    await signUp.email(
      {
        name,
        email,
        password,
        callbackURL: `${window.location.origin}/dashboard`,
      },
      {
        onSuccess: () => {
          setEmailSent(true);
          setIsLoading(false);
        },
        onError: (ctx) => {
          setErrorMessage(ctx.error.message || "Failed to create account");
          setIsLoading(false);
        },
      }
    );
  }

  /**
   * Resends the verification email.
   */
  async function handleResendVerification() {
    setIsResending(true);
    setHasResent(false);

    await authClient.sendVerificationEmail({
      email,
      callbackURL: `${window.location.origin}/dashboard`,
    });

    setIsResending(false);
    setHasResent(true);
  }

  /**
   * Goes back to the signup form (to change email).
   */
  function handleGoBack() {
    setEmailSent(false);
    setHasResent(false);
  }

  /**
   * Initiates OAuth sign-in with the specified provider.
   */
  function handleSocialSignIn(provider: "google" | "apple") {
    signIn.social({
      provider,
      callbackURL: `${window.location.origin}${redirectUrl}`,
    });
  }

  // Show verification email sent screen
  if (emailSent) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Check your email</h1>
          <p className={styles.subtitle}>
            We sent a verification link to <strong>{email}</strong>. Click the
            link to verify your account.
          </p>

          {hasResent && (
            <p className={styles.successBox}>Verification email resent!</p>
          )}

          <button
            type="button"
            onClick={handleResendVerification}
            disabled={isResending}
            className={styles.submitButton}
            style={{ marginTop: "1rem" }}
          >
            {isResending ? "Resending..." : "Resend verification email"}
          </button>

          <p className={styles.footer}>
            Wrong email?{" "}
            <button
              type="button"
              onClick={handleGoBack}
              className={styles.footerLink}
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              Go back
            </button>
          </p>
        </div>
      </main>
    );
  }

  // Show signup form
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>Sign up to get started with Docket.</p>

        {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}

        <form onSubmit={handleSubmit}>
          {/* Name Field */}
          <div className={styles.fieldGroup}>
            <label htmlFor="name" className={styles.label}>
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isLoading}
              className={styles.input}
            />
          </div>

          {/* Email Field */}
          <div className={styles.fieldGroup}>
            <label htmlFor="email" className={styles.label}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
              className={styles.input}
            />
          </div>

          {/* Password Field */}
          <div className={styles.fieldGroupLast}>
            <label htmlFor="password" className={styles.label}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={isLoading}
              className={styles.input}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={styles.submitButton}
          >
            {isLoading ? "Creating account..." : "Sign up"}
          </button>
        </form>

        <div className={styles.divider}>or</div>

        {/* Social Sign-In Buttons */}
        <div className={styles.socialButtonContainer}>
          <button
            type="button"
            onClick={() => handleSocialSignIn("google")}
            disabled={isLoading}
            className={styles.googleButton}
          >
            Continue with Google
          </button>

          <button
            type="button"
            onClick={() => handleSocialSignIn("apple")}
            disabled={isLoading}
            className={styles.appleButton}
          >
            Continue with Apple
          </button>
        </div>

        <p className={styles.footer}>
          Already have an account?{" "}
          <Link to="/login" className={styles.footerLink}>
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
