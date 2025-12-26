import { useState, useEffect } from "react";
import { redirect, useSearchParams, useRevalidator } from "react-router";
import type { Route } from "./+types/org.clio";
import { apiFetch } from "~/lib/api";
import { API_URL } from "~/lib/auth-client";
import type { SessionResponse, OrgMembership } from "~/lib/types";
import { AppLayout } from "~/components/AppLayout";
import styles from "~/styles/org-clio.module.css";

interface ClioStatus {
  connected: boolean;
  schemaLoaded: boolean;
  schemaVersion?: number;
}

/**
 * Server-side loader: Fetch session, org membership, and Clio status.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const cookie = request.headers.get("cookie") || "";

  // Check session
  const sessionResponse = await apiFetch(
    context,
    "/api/auth/get-session",
    cookie
  );
  if (!sessionResponse.ok) {
    throw redirect("/login");
  }

  const sessionData = (await sessionResponse.json()) as SessionResponse | null;
  if (!sessionData?.user) {
    throw redirect("/login");
  }

  // Check org membership
  const orgResponse = await apiFetch(context, "/api/user/org", cookie);
  if (!orgResponse.ok) {
    throw redirect("/dashboard");
  }

  const orgMembership = (await orgResponse.json()) as OrgMembership | null;

  // Must have an org to view Clio settings
  if (!orgMembership?.org) {
    throw redirect("/dashboard");
  }

  // Fetch Clio connection status
  const clioResponse = await apiFetch(context, "/api/clio/status", cookie);
  const clioStatus = clioResponse.ok
    ? ((await clioResponse.json()) as ClioStatus)
    : { connected: false, schemaLoaded: false };

  return {
    user: sessionData.user,
    org: orgMembership,
    clioStatus,
  };
}

/**
 * Clio connection management page.
 */
export default function ClioPage({ loaderData }: Route.ComponentProps) {
  const { user, org, clioStatus } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdmin = org.role === "admin";

  // Handle OAuth callback success/error messages
  useEffect(() => {
    const successParam = searchParams.get("success");
    const errorParam = searchParams.get("error");

    if (successParam === "connected") {
      setSuccess("Successfully connected to Clio!");
      setSearchParams({}, { replace: true });
    } else if (errorParam) {
      const errorMessages: Record<string, string> = {
        denied: "Clio authorization was denied.",
        invalid_request: "Invalid authorization request.",
        invalid_state: "Authorization session expired. Please try again.",
        exchange_failed: "Failed to complete authorization. Please try again.",
      };
      setError(errorMessages[errorParam] || "Authorization failed.");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  /**
   * Initiate Clio OAuth connection.
   */
  function handleConnect() {
    // Redirect to API's Clio connect endpoint
    window.location.href = `${API_URL}/api/clio/connect`;
  }

  /**
   * Disconnect Clio account.
   */
  async function handleDisconnect() {
    if (
      !confirm("Disconnect your Clio account? You can reconnect at any time.")
    ) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsDisconnecting(true);

    try {
      const response = await fetch(`${API_URL}/api/clio/disconnect`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to disconnect");
      }

      setSuccess("Clio account disconnected.");
      revalidator.revalidate();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to disconnect";
      setError(message);
    } finally {
      setIsDisconnecting(false);
    }
  }

  /**
   * Refresh Clio schema cache.
   */
  async function handleRefreshSchema() {
    setError(null);
    setSuccess(null);
    setIsRefreshing(true);

    try {
      const response = await fetch(`${API_URL}/api/org/clio/refresh-schema`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to refresh schema");
      }

      const result = (await response.json()) as { count: number };
      setSuccess(`Schema refreshed. ${result.count} object types loaded.`);
      revalidator.revalidate();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to refresh schema";
      setError(message);
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <AppLayout user={user} org={org} currentPath="/org/clio">
      <header className={styles.header}>
        <div className={styles.headerInfo}>
          <h1>Clio Connection</h1>
          <p className={styles.description}>
            Connect your Clio account to let Docket query and manage your case
            data.
          </p>
        </div>
        <div className={styles.statusActions}>
          {clioStatus.connected ? (
            <>
              <button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className={styles.disconnectButton}
              >
                {isDisconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
              <button
                onClick={handleConnect}
                className={styles.reconnectButton}
              >
                Reconnect
              </button>
            </>
          ) : (
            <button onClick={handleConnect} className={styles.connectButton}>
              Connect to Clio
            </button>
          )}
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Connection Status</h2>

        <div className={styles.statusCard}>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Clio Account</span>
            <span
              className={`${styles.statusValue} ${
                clioStatus.connected ? styles.connected : styles.disconnected
              }`}
            >
              {clioStatus.connected ? "Connected" : "Not Connected"}
            </span>
          </div>

          {clioStatus.connected && (
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>Schema Cache</span>
              <span
                className={`${styles.statusValue} ${
                  clioStatus.schemaLoaded
                    ? styles.connected
                    : styles.disconnected
                }`}
              >
                {clioStatus.schemaLoaded
                  ? `Loaded (v${clioStatus.schemaVersion || "?"})`
                  : "Not Loaded"}
              </span>
            </div>
          )}
        </div>
      </section>

      {isAdmin && clioStatus.connected && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Schema Management</h2>
          <p className={styles.sectionDescription}>
            Refresh the Clio schema cache to pick up any changes to your Clio
            configuration or custom fields.
          </p>

          <button
            onClick={handleRefreshSchema}
            disabled={isRefreshing || !clioStatus.connected}
            className={styles.refreshButton}
          >
            {isRefreshing ? "Refreshing..." : "Refresh Schema"}
          </button>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.infoCard}>
          <h3 className={styles.sectionTitle}>What Docket can do with Clio:</h3>
          <ul>
            <li>Query matters, contacts, tasks, and calendar entries</li>
            <li>Create and update records (Admin only, with confirmation)</li>
            <li>Search across your firm&apos;s case data</li>
          </ul>

          <h3>Security:</h3>
          <ul>
            <li>Each user connects their own Clio credentials</li>
            <li>Tokens are encrypted and stored securely</li>
            <li>Access is limited to your Clio permissions</li>
            <li>Write operations require explicit confirmation</li>
          </ul>
        </div>
      </section>
    </AppLayout>
  );
}
