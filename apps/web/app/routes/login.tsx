import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router";
import type { MetaFunction } from "react-router";
import { signIn, API_URL } from "~/lib/auth-client";
import type { InvitationDetails } from "~/lib/types";
import styles from "~/styles/auth.module.css";

export const meta: MetaFunction = () => [
  { title: "Log In | Docket" },
  { name: "description", content: "Log in to your Docket account" },
];

export default function LoginPage() {
  const [searchParams] = useSearchParams();

  // Get invitation ID from URL if present
  const invitationId = searchParams.get("invitation");

  // Where to redirect after login
  const redirectUrl = invitationId
    ? `/accept-invite?invitation=${invitationId}`
    : searchParams.get("redirect") || "/dashboard";

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Invitation state (for pre-filling email)
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);

  // Fetch invitation details if we have an invitation ID
  useEffect(() => {
    if (!invitationId) {
      return;
    }

    fetch(`${API_URL}/api/invitations/${invitationId}`, {
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) {
          return null;
        }
        return response.json() as Promise<InvitationDetails>;
      })
      .then((data) => {
        if (data) {
          setInvitation(data);
          setEmail(data.email);
        }
      })
      .catch(() => {
        // Ignore errors - invitation might not exist
      });
  }, [invitationId]);

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

  function handleSocialSignIn(provider: "google" | "apple") {
    signIn.social({
      provider,
      callbackURL: `${window.location.origin}${redirectUrl}`,
    });
  }

  // Build the signup link (preserve invitation if present)
  const signupLink = invitationId
    ? `/signup?invitation=${invitationId}`
    : "/signup";

  return (
    <main className={styles.page}>
      <img
        src="/gradient-background.png"
        alt=""
        height="100%"
        width="100%"
        style={{ position: "absolute", inset: 0, zIndex: -1 }}
      />

      <div className={styles.container}>
        <h1 className={styles.title}>Welcome back</h1>

        <p className={styles.subtitle}>
          {invitation ? (
            <>
              Log in to join <strong>{invitation.orgName}</strong> as a{" "}
              {invitation.role}.
            </>
          ) : (
            "We're excited to work with you again."
          )}
        </p>

        {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}

        <form onSubmit={handleSubmit}>
          {/* Email field */}
          <div className={styles.fieldGroup}>
            <label htmlFor="email" className={styles.label}>
              Email
              {invitation && (
                <span
                  style={{
                    fontWeight: "normal",
                    color: "var(--text-secondary)",
                    marginLeft: "0.5rem",
                  }}
                >
                  (from invitation)
                </span>
              )}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading || !!invitation}
              readOnly={!!invitation}
              className={styles.input}
              style={
                invitation
                  ? {
                      backgroundColor: "var(--surface-3)",
                      cursor: "not-allowed",
                    }
                  : undefined
              }
            />
          </div>

          {/* Password field */}
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

        {/* Social login buttons */}
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
              style={{ opacity: 0 }}
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
              style={{ opacity: 0 }}
            />
          </button>
        </div>

        <p className={styles.footer}>
          Need an account?{" "}
          <Link to={signupLink} className={styles.footerLink}>
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}
