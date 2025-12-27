import { useState } from "react";
import { redirect, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/org.settings";
import { apiFetch } from "~/lib/api";
import { API_URL } from "~/lib/auth-client";
import {
  FIRM_SIZES,
  US_STATES,
  PRACTICE_AREAS,
  getFirmSizeLabel,
  getPracticeAreaLabel,
} from "~/lib/org-constants";
import type { SessionResponse, OrgMembership } from "~/lib/types";
import { AppLayout } from "~/components/AppLayout";
import { PageLayout } from "~/components/PageLayout";

interface DeletionPreview {
  org: { id: string; name: string } | null;
  members: number;
  invitations: number;
  orgContextChunks: number;
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
  const revalidator = useRevalidator();

  // Permission flags
  const isAdmin = org.role === "admin";
  const isOwner = org.isOwner;

  // Edit form state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(org.org.name);
  const [editFirmSize, setEditFirmSize] = useState(org.org.firmSize || "");
  const [editJurisdictions, setEditJurisdictions] = useState<string[]>(
    org.org.jurisdictions || []
  );
  const [editPracticeTypes, setEditPracticeTypes] = useState<string[]>(
    org.org.practiceTypes || []
  );
  const [isSaving, setIsSaving] = useState(false);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletionPreview, setDeletionPreview] =
    useState<DeletionPreview | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  // Feedback state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /**
   * Toggle an item in a string array (add if not present, remove if present)
   */
  function toggleArrayItem(array: string[], item: string): string[] {
    if (array.includes(item)) {
      return array.filter((i) => i !== item);
    }
    return [...array, item];
  }

  async function handleSave() {
    setError(null);
    setSuccess(null);
    setIsSaving(true);

    try {
      const response = await fetch(`${API_URL}/api/org`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          firmSize: editFirmSize || undefined,
          jurisdictions: editJurisdictions,
          practiceTypes: editPracticeTypes,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to update organization");
      }

      setSuccess("Organization updated");
      setIsEditing(false);
      revalidator.revalidate();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancelEdit() {
    // Reset form to original values
    setEditName(org.org.name);
    setEditFirmSize(org.org.firmSize || "");
    setEditJurisdictions(org.org.jurisdictions || []);
    setEditPracticeTypes(org.org.practiceTypes || []);
    setIsEditing(false);
    setError(null);
  }

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
      const message = err instanceof Error ? err.message : "Failed to load";
      setError(message);
    }
  }

  async function handleDeleteOrg() {
    if (confirmName !== org.org.name) {
      setError("Name does not match");
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

      navigate("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete";
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleCloseDeleteModal() {
    setShowDeleteModal(false);
    setConfirmName("");
    setError(null);
  }

  // Build display values for read-only view
  const jurisdictionsDisplay = org.org.jurisdictions?.length
    ? org.org.jurisdictions.join(", ")
    : "Not set";

  const practiceAreasDisplay = org.org.practiceTypes?.length
    ? org.org.practiceTypes.map(getPracticeAreaLabel).join(", ")
    : "Not set";

  const roleDisplay = org.isOwner ? "Owner" : org.role;

  return (
    <AppLayout user={user} org={org} currentPath="/org/settings">
      <PageLayout title="Organization Settings">
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {/* Organization Information Section */}
        <section>
          <div className="section-header">
            <h2 className="text-title-3">Organization</h2>
            {isAdmin && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="btn btn-secondary"
              >
                Edit
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="card">
              <div className="form-group">
                <label htmlFor="orgName" className="form-label">
                  Organization Name
                </label>
                <input
                  id="orgName"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="firmSize" className="form-label">
                  Firm Size
                </label>
                <select
                  id="firmSize"
                  value={editFirmSize}
                  onChange={(e) => setEditFirmSize(e.target.value)}
                  className="form-select"
                >
                  <option value="">Select size...</option>
                  {FIRM_SIZES.map((size) => (
                    <option key={size.id} value={size.id}>
                      {size.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Jurisdictions</label>
                <div className="chip-grid">
                  {US_STATES.map((state) => {
                    const isSelected = editJurisdictions.includes(state);
                    return (
                      <button
                        key={state}
                        type="button"
                        onClick={() =>
                          setEditJurisdictions(
                            toggleArrayItem(editJurisdictions, state)
                          )
                        }
                        className={`chip ${isSelected ? "chip-selected" : ""}`}
                      >
                        {state}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Practice Areas</label>
                <div className="chip-grid">
                  {PRACTICE_AREAS.map((area) => {
                    const isSelected = editPracticeTypes.includes(area.id);
                    return (
                      <button
                        key={area.id}
                        type="button"
                        onClick={() =>
                          setEditPracticeTypes(
                            toggleArrayItem(editPracticeTypes, area.id)
                          )
                        }
                        className={`chip ${isSelected ? "chip-selected" : ""}`}
                      >
                        {area.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className="modal-actions"
                style={{
                  marginTop: "1.5rem",
                  paddingTop: "1rem",
                  borderTop: "1px solid var(--border-default)",
                }}
              >
                <button
                  onClick={handleCancelEdit}
                  className="btn btn-secondary"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          ) : (
            <div className="info-card">
              <div className="info-row">
                <span className="info-label">Name</span>
                <span className="info-value">{org.org.name}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Firm Size</span>
                <span className="info-value">
                  {org.org.firmSize
                    ? getFirmSizeLabel(org.org.firmSize)
                    : "Not set"}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Jurisdictions</span>
                <span className="info-value">{jurisdictionsDisplay}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Practice Areas</span>
                <span className="info-value">{practiceAreasDisplay}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Your Role</span>
                <span className="info-value">{roleDisplay}</span>
              </div>
            </div>
          )}
        </section>

        {/* Danger Zone Section (Owner only) */}
        {isOwner && (
          <section>
            <h2
              className="text-title-3"
              style={{ color: "var(--error-primary)" }}
            >
              Danger Zone
            </h2>
            <div>
              <h3 className="text-headline">Delete Organization</h3>
              <p className="text-secondary">
                Permanently delete this organization and all its data. This
                action cannot be undone.
              </p>
            </div>
            <button onClick={handleShowDeleteModal} className="btn btn-danger">
              Delete Organization
            </button>
          </section>
        )}

        {/* Delete Organization Modal */}
        {showDeleteModal && deletionPreview && (
          <div className="modal-overlay" onClick={handleCloseDeleteModal}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2
                className="modal-title"
                style={{ color: "var(--error-primary)" }}
              >
                Delete Organization
              </h2>

              <div className="alert alert-error">
                This will permanently delete:
              </div>

              <ul
                className="text-secondary"
                style={{ margin: "0 0 1.5rem 0", paddingLeft: "1.5rem" }}
              >
                <li>
                  <strong>{deletionPreview.org?.name}</strong> organization
                </li>
                <li>{deletionPreview.members} member(s)</li>
                <li>{deletionPreview.invitations} pending invitation(s)</li>
                <li>{deletionPreview.orgContextChunks} document chunk(s)</li>
                <li>All conversations, Clio connections, and audit logs</li>
              </ul>

              <div className="form-group">
                <label htmlFor="confirmName" className="form-label">
                  Type <strong>{org.org.name}</strong> to confirm:
                </label>
                <input
                  id="confirmName"
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  className="form-input"
                  placeholder="Organization name"
                />
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <div className="modal-actions">
                <button
                  onClick={handleCloseDeleteModal}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteOrg}
                  disabled={isDeleting || confirmName !== org.org.name}
                  className="btn btn-danger"
                >
                  {isDeleting ? "Deleting..." : "Delete Organization"}
                </button>
              </div>
            </div>
          </div>
        )}
      </PageLayout>
    </AppLayout>
  );
}
