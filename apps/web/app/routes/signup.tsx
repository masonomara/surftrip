import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router";
import type { MetaFunction } from "react-router";
import { signUp, signIn } from "~/lib/auth-client";

export const meta: MetaFunction = () => [
  { title: "Sign Up | Docket" },
  { name: "description", content: "Create your Docket account" },
];

const styles = {
  page: {
    fontFamily: "system-ui, sans-serif",
    padding: "2rem",
    maxWidth: "400px",
    margin: "0 auto",
  },
  subtitle: {
    color: "#666",
    marginBottom: "2rem",
  },
  errorBox: {
    padding: "0.75rem",
    background: "#fee",
    color: "#c00",
    borderRadius: "4px",
    marginBottom: "1rem",
  },
  fieldGroup: {
    marginBottom: "1rem",
  },
  fieldGroupLast: {
    marginBottom: "1.5rem",
  },
  label: {
    display: "block" as const,
    marginBottom: "0.5rem",
    fontWeight: 500,
  },
  input: {
    width: "100%",
    padding: "0.5rem",
    border: "1px solid #ccc",
    borderRadius: "4px",
  },
  divider: {
    margin: "1.5rem 0",
    textAlign: "center" as const,
    color: "#666",
  },
  socialButtonContainer: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
  },
  footer: {
    marginTop: "2rem",
    textAlign: "center" as const,
    color: "#666",
  },
  footerLink: {
    color: "#000",
  },
};

function getSubmitButtonStyle(isLoading: boolean) {
  return {
    width: "100%",
    padding: "0.75rem",
    background: isLoading ? "#999" : "#000",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: isLoading ? "not-allowed" : "pointer",
    fontWeight: 500,
  };
}

function getGoogleButtonStyle() {
  return {
    width: "100%",
    padding: "0.75rem",
    background: "#fff",
    border: "1px solid #ccc",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: 500,
  };
}

function getAppleButtonStyle() {
  return {
    width: "100%",
    padding: "0.75rem",
    background: "#000",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: 500,
  };
}

export default function SignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const inviteCode = searchParams.get("invite");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getRedirectUrl(): string {
    if (inviteCode) {
      return `/invite/${inviteCode}`;
    }
    return "/dashboard";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    await signUp.email(
      { name, email, password },
      {
        onSuccess: () => {
          navigate(getRedirectUrl());
        },
        onError: (ctx) => {
          const message = ctx.error.message || "Failed to create account";
          setError(message);
          setLoading(false);
        },
      }
    );
  }

  function handleGoogleSignIn() {
    signIn.social({
      provider: "google",
      callbackURL: getRedirectUrl(),
    });
  }

  function handleAppleSignIn() {
    signIn.social({
      provider: "apple",
      callbackURL: getRedirectUrl(),
    });
  }

  return (
    <main style={styles.page}>
      <h1>Create your account</h1>
      <p style={styles.subtitle}>Sign up to get started with Docket.</p>

      {error && <div style={styles.errorBox}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <div style={styles.fieldGroup}>
          <label htmlFor="name" style={styles.label}>
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={loading}
            style={styles.input}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label htmlFor="email" style={styles.label}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            style={styles.input}
          />
        </div>

        <div style={styles.fieldGroupLast}>
          <label htmlFor="password" style={styles.label}>
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            disabled={loading}
            style={styles.input}
          />
        </div>

        <button type="submit" disabled={loading} style={getSubmitButtonStyle(loading)}>
          {loading ? "Creating account..." : "Sign up"}
        </button>
      </form>

      <div style={styles.divider}>or</div>

      <div style={styles.socialButtonContainer}>
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          style={getGoogleButtonStyle()}
        >
          Continue with Google
        </button>

        <button
          type="button"
          onClick={handleAppleSignIn}
          disabled={loading}
          style={getAppleButtonStyle()}
        >
          Continue with Apple
        </button>
      </div>

      <p style={styles.footer}>
        Already have an account?{" "}
        <Link to="/login" style={styles.footerLink}>
          Log in
        </Link>
      </p>
    </main>
  );
}
