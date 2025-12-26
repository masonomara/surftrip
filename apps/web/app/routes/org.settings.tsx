import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import type { Route } from "./+types/org.settings";
import { apiFetch } from "~/lib/api";
import { API_URL } from "~/lib/auth-client";
import type { SessionResponse, OrgMembership } from "~/lib/types";
import { AppLayout } from "~/components/AppLayout";
import styles from "~/styles/org-settings.module.css";

interface DeletionPreview {
  org: { id: string; name: string } | null;
  members: number;
  invitations: number;
  workspaceBindings: number;
  apiKeys: number;
  subscriptions: number;
  orgContextChunks: number;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const cookie = request.headers.get("cookie") || "";

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

  const orgResponse = await apiFetch(context, "/api/user/org", cookie);
  if (!orgResponse.ok) {
    throw redirect("/dashboard");
  }

  const orgMembership = (await orgResponse.json()) as OrgMembership | null;
  if (!orgMembership?.org) {
    throw redirect("/dashboard");
  }

  return {
    user: sessionData.user,
    org: orgMembership,
  };
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const { user, org } = loaderData;
  const navigate = useNavigate();
  const isOwner = org.isOwner;

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletionPreview, setDeletionPreview] =
    useState<DeletionPreview | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleShowDeleteModal() {
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/org/deletion-preview`, {
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

  async function handleDeleteOrg() {
    if (confirmName !== org.org.name) {
      setError("Organization name does not match");
      return;
    }

    setError(null);
    setIsDeleting(true);

    try {
      const response = await fetch(`${API_URL}/api/org`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to delete organization");
      }

      // Redirect to dashboard after deletion
      navigate("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete organization";
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <AppLayout user={user} org={org} currentPath="/org/settings">
      <header className={styles.header}>
        <h1>Organization Settings</h1>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      {/* Org Info */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Organization</h2>
        <div className={styles.infoCard}>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Name</span>
            <span className={styles.infoValue}>{org.org.name}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Your Role</span>
            <span className={styles.infoValue}>
              {org.isOwner ? "Owner" : org.role}
            </span>
          </div>
        </div>
      </section>

      {/* Danger Zone - Owner only */}
      {isOwner && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitleDanger}>Danger Zone</h2>
          <div className={styles.dangerCard}>
            <div className={styles.dangerInfo}>
              <h3>Delete Organization</h3>
              <p>
                Permanently delete this organization and all its data. This
                action cannot be undone.
              </p>
            </div>
            <button
              onClick={handleShowDeleteModal}
              className={styles.deleteButton}
            >
              Delete Organization
            </button>
          </div>
        </section>
      )}

      {/* Delete Modal */}
      {showDeleteModal && deletionPreview && (
        <div className={styles.modal} onClick={() => setShowDeleteModal(false)}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={styles.modalTitle}>Delete Organization</h2>

            <div className={styles.warning}>
              This will permanently delete:
            </div>

            <ul className={styles.deletionList}>
              <li>
                <strong>{deletionPreview.org?.name}</strong> organization
              </li>
              <li>{deletionPreview.members} member(s)</li>
              <li>{deletionPreview.invitations} pending invitation(s)</li>
              <li>{deletionPreview.orgContextChunks} document chunk(s)</li>
              <li>All conversations and messages</li>
              <li>All Clio connections and cached data</li>
              <li>All audit logs</li>
            </ul>

            <div className={styles.confirmSection}>
              <label htmlFor="confirmName" className={styles.confirmLabel}>
                Type <strong>{org.org.name}</strong> to confirm:
              </label>
              <input
                id="confirmName"
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className={styles.confirmInput}
                placeholder="Organization name"
              />
            </div>

            {error && <div className={styles.modalError}>{error}</div>}

            <div className={styles.modalActions}>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setConfirmName("");
                  setError(null);
                }}
                className={styles.cancelButton}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteOrg}
                disabled={isDeleting || confirmName !== org.org.name}
                className={styles.confirmDeleteButton}
              >
                {isDeleting ? "Deleting..." : "Delete Organization"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
