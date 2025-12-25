import { useState } from "react";
import { useSearchParams, Link } from "react-router";
import type { MetaFunction } from "react-router";
import { signIn } from "~/lib/auth-client";
import styles from "~/styles/auth.module.css";

export const meta: MetaFunction = () => [
  { title: "Log In | Docket" },
  { name: "description", content: "Log in to your Docket account" },
];

/**
 * Background image styles for the login page.
 */
const backgroundImageStyles: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: -1,
};

/**
 * Hidden spacer image styles (used to balance button layouts).
 */
const hiddenSpacerStyles: React.CSSProperties = {
  opacity: 0,
};

/**
 * Login page component.
 */
export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * Handles email/password form submission.
   */
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      await signIn.email(
        { email, password },
        {
          onSuccess: () => {
            window.location.href = redirectUrl;
          },
          onError: (ctx) => {
            setErrorMessage(ctx.error.message || "Invalid email or password");
            setIsLoading(false);
          },
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setErrorMessage(message);
      setIsLoading(false);
    }
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

  return (
    <main className={styles.page}>
      {/* Background image */}
      <img
        src="/gradient-background.png"
        alt=""
        height="100%"
        width="100%"
        style={backgroundImageStyles}
      />

      <div className={styles.container}>
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.subtitle}>We're excited to work with you again.</p>

        {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit}>
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

          <div className={styles.fieldGroupLast}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <label htmlFor="password" className={styles.label}>
                Password
              </label>
              <Link
                to="/forgot-password"
                className={styles.footerLink}
                style={{ fontSize: "14px" }}
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              className={styles.input}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={styles.submitButton}
          >
            {isLoading ? "Logging in..." : "Log in"}
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
            <img
              src="/google-icon-button.png"
              alt=""
              height="18px"
              width="18px"
            />
            Continue with Google
            <img
              src="/google-icon-button.png"
              alt=""
              height="18px"
              width="18px"
              style={hiddenSpacerStyles}
            />
          </button>

          <button
            type="button"
            onClick={() => handleSocialSignIn("apple")}
            disabled={isLoading}
            className={styles.appleButton}
          >
            <img
              src="/apple-icon-button.png"
              alt=""
              height="18px"
              width="18px"
            />
            Continue with Apple
            <img
              src="/apple-icon-button.png"
              alt=""
              height="18px"
              width="18px"
              style={hiddenSpacerStyles}
            />
          </button>
        </div>

        <p className={styles.footer}>
          Need an account?{" "}
          <Link to="/signup" className={styles.footerLink}>
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}
