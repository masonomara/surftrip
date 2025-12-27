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

  // Check if user is coming from an invitation link
  const invitationId = searchParams.get("invitation");
  const redirectParam = searchParams.get("redirect") || "/dashboard";
  const redirectUrl = invitationId
    ? `/accept-invite?invitation=${invitationId}`
    : redirectParam;

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Invitation details (if coming from an invite link)
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [invitationLoading, setInvitationLoading] = useState(!!invitationId);

  // Email verification state
  const [emailSent, setEmailSent] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [hasResent, setHasResent] = useState(false);

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
        // Invitation fetch failed, but we can still let them sign up normally
      } finally {
        setInvitationLoading(false);
      }
    }

    loadInvitation();
  }, [invitationId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    const callbackURL = `${window.location.origin}${redirectUrl}`;

    await signUp.email(
      { name, email, password, callbackURL },
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

    const callbackURL = `${window.location.origin}${redirectUrl}`;
    await authClient.sendVerificationEmail({ email, callbackURL });

    setIsResending(false);
    setHasResent(true);
  }

  function handleSocialSignIn(provider: "google" | "apple") {
    const callbackURL = `${window.location.origin}${redirectUrl}`;
    signIn.social({ provider, callbackURL });
  }

  function handleGoBack() {
    setEmailSent(false);
    setHasResent(false);
  }

  // Show email verification screen after signup
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
            <p className="alert alert-success">Verification email resent!</p>
          )}

          <button
            type="button"
            onClick={handleResendVerification}
            disabled={isResending}
            className="btn btn-primary btn-lg"
            style={{ marginTop: "1rem", width: "100%" }}
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

  // Show loading state while fetching invitation
  if (invitationLoading) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <p className={styles.subtitle}>Loading invitation...</p>
        </div>
      </main>
    );
  }

  // Show expired invitation error
  if (invitation?.isExpired) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Invitation Expired</h1>
          <p className={styles.subtitle}>
            This invitation to join {invitation.orgName} has expired. Please
            contact your organization admin.
          </p>
          <Link to="/login" className={styles.submitButton}>
            Go to Login
          </Link>
        </div>
      </main>
    );
  }

  // Show already accepted invitation error
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

  // Build login link, preserving invitation if present
  const loginLink = invitationId
    ? `/login?invitation=${invitationId}`
    : "/login";

  // Determine if email field should be locked (when coming from invitation)
  const isEmailLocked = invitation !== null;

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
            Sign up with Google
          </button>
        </div>

        <div className={styles.divider}>or</div>

        <form onSubmit={handleSubmit}>
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
              minLength={8}
              disabled={isLoading}
              className={styles.input}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary btn-lg"
            style={{ width: "100%" }}
          >
            {isLoading ? "Creating account..." : "Sign up"}
          </button>
        </form>

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
