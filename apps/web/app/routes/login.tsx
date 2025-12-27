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

  // Check if user is coming from an invitation link
  const invitationId = searchParams.get("invitation");
  const redirectParam = searchParams.get("redirect") || "/dashboard";
  const redirectUrl = invitationId
    ? `/accept-invite?invitation=${invitationId}`
    : redirectParam;

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Invitation details (if coming from an invite link)
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);

  // Load invitation details if we have an invitation ID
  useEffect(() => {
    if (!invitationId) {
      return;
    }

    async function loadInvitation() {
      try {
        const response = await fetch(
          `${API_URL}/api/invitations/${invitationId}`,
          {
            credentials: "include",
          }
        );

        if (response.ok) {
          const data = (await response.json()) as InvitationDetails;
          setInvitation(data);
          setEmail(data.email);
        }
      } catch {
        // Invitation fetch failed, but we can still let them log in normally
      }
    }

    loadInvitation();
  }, [invitationId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    const callbackURL = `${window.location.origin}${redirectUrl}`;
    signIn.social({ provider, callbackURL });
  }

  // Build signup link, preserving invitation if present
  const signupLink = invitationId
    ? `/signup?invitation=${invitationId}`
    : "/signup";

  // Determine if email field should be locked (when coming from invitation)
  const isEmailLocked = invitation !== null;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Work with Docket Case Management</h1>

        <p className={styles.subtitle}>
          {invitation ? (
            <>
              Continue to Docket as a {invitation.role} of {invitation.orgName}.
            </>
          ) : (
            "Continue to Docket"
          )}
        </p>

        {errorMessage && (
          <div className="alert alert-error">{errorMessage}</div>
        )}

        <div className={styles.socialButtonContainer}>
          <button
            type="button"
            onClick={() => handleSocialSignIn("google")}
            disabled={isLoading}
            className={styles.ssoButton}
          >
            <img
              src="/google-icon-button.svg"
              alt=""
              height="18px"
              width="18px"
            />
            Continue with Google
          </button>
        </div>

        <div className={styles.divider}>or</div>

        <form onSubmit={handleSubmit}>
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
              disabled={isLoading || isEmailLocked}
              readOnly={isEmailLocked}
              className={styles.input}
              placeholder="Enter your email"
              style={
                isEmailLocked
                  ? {
                      backgroundColor: "var(--surface-3)",
                      cursor: "not-allowed",
                    }
                  : undefined
              }
            />
          </div>

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
              disabled={isLoading}
              className={styles.input}
              placeholder="Enter your password"
            />
            <Link
              to="/forgot-password"
              className={styles.footerLink}
              style={{ fontSize: "14px" }}
            >
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary btn-lg"
            style={{ width: "100%" }}
          >
            {isLoading ? "Logging in..." : "Log in"}
          </button>
        </form>

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
