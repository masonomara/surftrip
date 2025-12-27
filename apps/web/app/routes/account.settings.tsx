import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import type { Route } from "./+types/account.settings";
import { apiFetch } from "~/lib/api";
import { API_URL, authClient, signOut } from "~/lib/auth-client";
import type { SessionResponse, OrgMembership } from "~/lib/types";
import { AppLayout } from "~/components/AppLayout";
import { PageLayout } from "~/components/PageLayout";

interface DeletionPreview {
  user: { id: string; email: string } | null;
  orgsOwned: number;
  orgMemberships: number;
}

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

  let orgMembership: OrgMembership | null = null;
  if (orgResponse.ok) {
    const orgData = (await orgResponse.json()) as OrgMembership | null;
    if (orgData?.org) {
      orgMembership = orgData;
    }
  }

  return {
    user: sessionData.user,
    org: orgMembership,
  };
}

export default function AccountSettingsPage({
  loaderData,
}: Route.ComponentProps) {
  const { user, org } = loaderData;
  const navigate = useNavigate();

  // Modal and deletion state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletionPreview, setDeletionPreview] =
    useState<DeletionPreview | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleShowDeleteModal() {
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/account/deletion-preview`, {
        credentials: "include",
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to load deletion preview");
      }

      const preview = (await response.json()) as DeletionPreview;
      setDeletionPreview(preview);
      setShowDeleteModal(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load preview";
      setError(message);
    }
  }

  async function handleDeleteAccount() {
    if (confirmEmail !== user.email) {
      setError("Email does not match");
      return;
    }

    setError(null);
    setIsDeleting(true);

    try {
      const response = await fetch(`${API_URL}/api/account`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail }),
      });

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string;
          message?: string;
        };

        // Handle special case where user owns organizations
        if (data.error === "sole_owner") {
          throw new Error(
            data.message ||
              "You must transfer ownership of your organizations first"
          );
        }

        throw new Error(data.error || "Failed to delete account");
      }

      // Sign out and redirect to auth
      await authClient.signOut();
      navigate("/auth");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete account";
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleCloseModal() {
    setShowDeleteModal(false);
    setConfirmEmail("");
    setError(null);
  }

  return (
    <AppLayout user={user} org={org} currentPath="/account/settings">
      <PageLayout title="Account Settings">
        {error && <div className="alert alert-error">{error}</div>}

        {/* Account Information Section */}
        <section>
          <h2 className="text-title-3">Account</h2>
          <div className="info-card">
            <div className="info-row">
              <span className="info-label">Email</span>
              <span className="info-value">{user.email}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Name</span>
              <span className="info-value">{user.name}</span>
            </div>
          </div>
        </section>

        {/* Session Section */}
        <section>
          <h2 className="text-title-3">Session</h2>
          <div className="info-card">
            <div>
              <h3 className="text-headline">Sign Out</h3>
              <p className="text-secondary">
                Sign out of your account on this device.
              </p>
            </div>
            <button
              onClick={() =>
                signOut().then(() => (window.location.href = "/auth"))
              }
              className="btn btn-secondary"
            >
              Sign Out
            </button>
          </div>
        </section>

        {/* Danger Zone Section */}
        <section>
          <h2
            className="text-title-3"
            style={{ color: "var(--error-primary)" }}
          >
            Danger Zone
          </h2>

          <div className="info-card">
            <div>
              <h3 className="text-headline">Delete Account</h3>
              <p className="text-secondary">
                Permanently delete your account and all associated data. This
                action cannot be undone.
              </p>
            </div>

            <button onClick={handleShowDeleteModal} className="btn btn-danger">
              Delete Account
            </button>
          </div>
        </section>

        {/* Delete Account Modal */}
        {showDeleteModal && deletionPreview && (
          <div className="modal-overlay" onClick={handleCloseModal}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2
                className="modal-title"
                style={{ color: "var(--error-primary)" }}
              >
                Delete Account
              </h2>

              <div className="alert alert-error">
                This will permanently delete:
              </div>

              <ul
                className="text-secondary"
                style={{ paddingLeft: "1.5rem", margin: "1rem 0" }}
              >
                <li>
                  Your account (<strong>{deletionPreview.user?.email}</strong>)
                </li>
                {deletionPreview.orgsOwned > 0 && (
                  <li>{deletionPreview.orgsOwned} organization(s) you own</li>
                )}
                {deletionPreview.orgMemberships > 0 && (
                  <li>
                    {deletionPreview.orgMemberships} organization membership(s)
                  </li>
                )}
                <li>All your conversations and messages</li>
              </ul>

              {deletionPreview.orgsOwned > 0 && (
                <div className="alert alert-error">
                  Warning: You must transfer ownership before deleting your
                  account.
                </div>
              )}

              <div className="form-group">
                <label htmlFor="confirmEmail" className="form-label">
                  Type <strong>{user.email}</strong> to confirm:
                </label>
                <input
                  id="confirmEmail"
                  type="email"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  className="form-input"
                  placeholder="Your email"
                />
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <div className="modal-actions">
                <button
                  onClick={handleCloseModal}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={isDeleting || confirmEmail !== user.email}
                  className="btn btn-danger"
                >
                  {isDeleting ? "Deleting..." : "Delete Account"}
                </button>
              </div>
            </div>
          </div>
        )}
      </PageLayout>
    </AppLayout>
  );
}
