import { useState, useEffect } from "react";
import { redirect, useSearchParams, useRevalidator } from "react-router";
import type { Route } from "./+types/org.clio";
import { apiFetch } from "~/lib/api";
import { API_URL } from "~/lib/auth-client";
import type { SessionResponse, OrgMembership } from "~/lib/types";
import { AppLayout } from "~/components/AppLayout";
import { PageLayout } from "~/components/PageLayout";

interface ClioStatus {
  connected: boolean;
  schemaLoaded: boolean;
  schemaVersion?: number;
}

// Error messages for OAuth error codes
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  denied: "Authorization denied.",
  invalid_request: "Invalid request.",
  invalid_state: "Session expired.",
  exchange_failed: "Authorization failed.",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const cookie = request.headers.get("cookie") || "";

  // Check if user is logged in
  const sessionResponse = await apiFetch(
    context,
    "/api/auth/get-session",
    cookie
  );

  if (!sessionResponse.ok) {
    throw redirect("/auth");
  }

  const sessionData = (await sessionResponse.json()) as SessionResponse | null;

  if (!sessionData?.user) {
    throw redirect("/auth");
  }

  // Fetch user's organization membership
  const orgResponse = await apiFetch(context, "/api/user/org", cookie);

  if (!orgResponse.ok) {
    throw redirect("/dashboard");
  }

  const orgMembership = (await orgResponse.json()) as OrgMembership | null;

  if (!orgMembership?.org) {
    throw redirect("/dashboard");
  }

  // Fetch Clio connection status
  const clioResponse = await apiFetch(context, "/api/clio/status", cookie);

  let clioStatus: ClioStatus = { connected: false, schemaLoaded: false };
  if (clioResponse.ok) {
    clioStatus = (await clioResponse.json()) as ClioStatus;
  }

  return {
    user: sessionData.user,
    org: orgMembership,
    clioStatus,
  };
}

export default function ClioPage({ loaderData }: Route.ComponentProps) {
  const { user, org, clioStatus } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();

  // Action state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Feedback state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Permission flags
  const isAdmin = org.role === "admin";

  // Handle URL parameters from OAuth callback
  useEffect(() => {
    const successParam = searchParams.get("success");
    const errorParam = searchParams.get("error");

    if (successParam === "connected") {
      setSuccess("Successfully connected to Clio!");
      setSearchParams({}, { replace: true });
      return;
    }

    if (errorParam) {
      const errorMessage =
        OAUTH_ERROR_MESSAGES[errorParam] || "Authorization failed.";
      setError(errorMessage);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  function handleConnect() {
    window.location.href = `${API_URL}/api/clio/connect`;
  }

  async function handleDisconnect() {
    const confirmed = confirm(
      "Are you sure you want to disconnect your Clio account?"
    );
    if (!confirmed) {
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

  // Build schema version display text
  const schemaVersionText = clioStatus.schemaLoaded
    ? `Loaded (v${clioStatus.schemaVersion || "?"})`
    : "Not Loaded";

  const actionButtons = clioStatus.connected ? (
    <>
      <button
        onClick={handleDisconnect}
        disabled={isDisconnecting}
        className="btn btn-danger-outline"
      >
        {isDisconnecting ? "Disconnecting..." : "Disconnect"}
      </button>
      <button onClick={handleConnect} className="btn btn-secondary">
        Reconnect
      </button>
    </>
  ) : (
    <button onClick={handleConnect} className="btn btn-primary">
      Connect to Clio
    </button>
  );

  return (
    <AppLayout user={user} org={org} currentPath="/org/clio">
      <PageLayout
        title="Clio Connection"
        subtitle="Connect your Clio account to let Docket query and manage your case data."
        actions={actionButtons}
      >
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {/* Connection Status Section */}
        <section>
          <h2 className="text-title-3">Connection Status</h2>
          <div className="card card-sm">
            <div className="info-row">
              <span className="info-label">Clio Account</span>
              <span
                className={
                  clioStatus.connected ? "status-success" : "status-muted"
                }
              >
                {clioStatus.connected ? "Connected" : "Not Connected"}
              </span>
            </div>

            {clioStatus.connected && (
              <div className="info-row">
                <span className="info-label">Schema Cache</span>
                <span
                  className={
                    clioStatus.schemaLoaded ? "status-success" : "status-muted"
                  }
                >
                  {schemaVersionText}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Schema Management Section (Admin only, when connected) */}
        {isAdmin && clioStatus.connected && (
          <section>
            <h2 className="text-title-3">Schema Management</h2>
            <p className="section-description">
              Refresh the schema cache to pick up Clio configuration changes.
            </p>
            <button
              onClick={handleRefreshSchema}
              disabled={isRefreshing}
              className="btn btn-secondary"
            >
              {isRefreshing ? "Refreshing..." : "Refresh Schema"}
            </button>
          </section>
        )}

        {/* Information Section */}
        <section>
          <div className="info-card">
            <h3 className="text-headline" style={{ marginBottom: "0.5rem" }}>
              What Docket can do with Clio:
            </h3>
            <ul
              className="text-secondary"
              style={{ paddingLeft: "1.25rem", marginBottom: "1rem" }}
            >
              <li>Query matters, contacts, tasks, and calendar entries</li>
              <li>Create and update records (Admin only, with confirmation)</li>
              <li>Search across your firm&apos;s case data</li>
            </ul>

            <h3 className="text-headline" style={{ marginBottom: "0.5rem" }}>
              Security:
            </h3>
            <ul className="text-secondary" style={{ paddingLeft: "1.25rem" }}>
              <li>Tokens are encrypted and stored securely</li>
              <li>Access is limited to your Clio permissions</li>
              <li>Write operations require explicit confirmation</li>
            </ul>
          </div>
        </section>
      </PageLayout>
    </AppLayout>
  );
}
