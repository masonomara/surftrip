import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router";
import type { MetaFunction } from "react-router";
import { signUp, signIn, authClient, API_URL } from "~/lib/auth-client";
import type { InvitationDetails } from "~/lib/types";
import styles from "~/styles/auth.module.css";

export const meta: MetaFunction = () => [
  { title: "Sign Up | Docket" },
  { name: "description", content: "Create your Docket account" },
];

export default function SignupPage() {
  const [searchParams] = useSearchParams();

  // Get invitation ID from URL if present
  const invitationId = searchParams.get("invitation");

  // Where to redirect after signup
  const redirectUrl = invitationId
    ? `/accept-invite?invitation=${invitationId}`
    : searchParams.get("redirect") || "/dashboard";

  // Invitation state
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [invitationLoading, setInvitationLoading] = useState(!!invitationId);

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
      })
      .finally(() => {
        setInvitationLoading(false);
      });
  }, [invitationId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    await signUp.email(
      {
        name,
        email,
        password,
        callbackURL: `${window.location.origin}${redirectUrl}`,
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

  async function handleResendVerification() {
    setIsResending(true);
    setHasResent(false);

    await authClient.sendVerificationEmail({
      email,
      callbackURL: `${window.location.origin}${redirectUrl}`,
    });

    setIsResending(false);
    setHasResent(true);
  }

  function handleSocialSignIn(provider: "google" | "apple") {
    signIn.social({
      provider,
      callbackURL: `${window.location.origin}${redirectUrl}`,
    });
  }

  function handleGoBack() {
    setEmailSent(false);
    setHasResent(false);
  }

  // Email verification sent - show confirmation page
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

  // Loading invitation
  if (invitationLoading) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <p className={styles.subtitle}>Loading invitation...</p>
        </div>
      </main>
    );
  }

  // Invitation expired
  if (invitation?.isExpired) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Invitation Expired</h1>
          <p className={styles.subtitle}>
            This invitation to join {invitation.orgName} has expired. Please
            contact your organization admin for a new invitation.
          </p>
          <Link to="/login" className={styles.submitButton}>
            Go to Login
          </Link>
        </div>
      </main>
    );
  }

  // Invitation already accepted
  if (invitation?.isAccepted) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Already Accepted</h1>
          <p className={styles.subtitle}>
            This invitation has already been accepted.
          </p>
          <Link to="/login" className={styles.submitButton}>
            Go to Login
          </Link>
        </div>
      </main>
    );
  }

  // Build login link (preserve invitation if present)
  const loginLink = invitationId
    ? `/login?invitation=${invitationId}`
    : "/login";

  // Main signup form
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>
          {invitation ? "You're invited!" : "Create your account"}
        </h1>

        <p className={styles.subtitle}>
          {invitation ? (
            <>
              {invitation.inviterName} invited you to join{" "}
              <strong>{invitation.orgName}</strong> as a {invitation.role}.
              Create an account to get started.
            </>
          ) : (
            "Sign up to get started with Docket."
          )}
        </p>

        {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}

        <form onSubmit={handleSubmit}>
          {/* Name field */}
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

        {/* Social signup buttons */}
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
          <Link to={loginLink} className={styles.footerLink}>
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
