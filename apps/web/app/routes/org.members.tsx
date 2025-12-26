import { useState } from "react";
import { redirect, useRevalidator } from "react-router";
import type { Route } from "./+types/org.members";
import { apiFetch } from "~/lib/api";
import { API_URL } from "~/lib/auth-client";
import type {
  SessionResponse,
  OrgMembership,
  OrgMember,
  PendingInvitation,
} from "~/lib/types";
import { AppLayout } from "~/components/AppLayout";
import styles from "~/styles/org-members.module.css";

/**
 * Server-side loader: Fetch session, org membership, members, and invitations.
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

  // Must be admin to view members page
  if (!orgMembership?.org || orgMembership.role !== "admin") {
    throw redirect("/dashboard");
  }

  // Fetch members and invitations in parallel
  const [membersResponse, invitationsResponse] = await Promise.all([
    apiFetch(context, "/api/org/members", cookie),
    apiFetch(context, "/api/org/invitations", cookie),
  ]);

  const members = membersResponse.ok
    ? ((await membersResponse.json()) as OrgMember[])
    : [];

  const invitations = invitationsResponse.ok
    ? ((await invitationsResponse.json()) as PendingInvitation[])
    : [];

  return {
    user: sessionData.user,
    org: orgMembership,
    members,
    invitations,
  };
}

/**
 * Members management page.
 */
export default function MembersPage({ loaderData }: Route.ComponentProps) {
  const { user, org, members, invitations } = loaderData;
  const revalidator = useRevalidator();

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /**
   * Make an API request.
   */
  async function apiAction(
    url: string,
    method: string,
    body?: object
  ): Promise<void> {
    const response = await fetch(`${API_URL}${url}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error || "Request failed");
    }
  }

  /**
   * Handle an action with error handling and success message.
   */
  async function handleAction(action: () => Promise<void>, successMsg: string) {
    setError(null);
    setSuccess(null);

    try {
      await action();
      setSuccess(successMsg);
      revalidator.revalidate();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      setError(message);
    }
  }

  /**
   * Change a member's role.
   */
  function handleRoleChange(member: OrgMember, newRole: string) {
    handleAction(
      () =>
        apiAction(`/api/org/members/${member.userId}`, "PATCH", {
          role: newRole,
        }),
      "Role updated"
    );
  }

  /**
   * Remove a member from the organization.
   */
  function handleRemoveMember(member: OrgMember) {
    if (!confirm(`Remove ${member.name}?`)) {
      return;
    }

    handleAction(
      () => apiAction(`/api/org/members/${member.userId}`, "DELETE"),
      "Member removed"
    );
  }

  /**
   * Transfer ownership to another admin.
   */
  function handleTransferOwnership(member: OrgMember) {
    if (!confirm(`Transfer ownership to ${member.name}?`)) {
      return;
    }

    handleAction(
      () =>
        apiAction("/api/org/transfer-ownership", "POST", {
          toUserId: member.userId,
        }),
      "Ownership transferred"
    );
  }

  /**
   * Revoke a pending invitation.
   */
  function handleRevokeInvitation(inv: PendingInvitation) {
    if (!confirm(`Revoke invitation to ${inv.email}?`)) {
      return;
    }

    handleAction(
      () => apiAction(`/api/org/invitations/${inv.id}`, "DELETE"),
      "Invitation revoked"
    );
  }

  /**
   * Called when invitation is sent successfully.
   */
  function handleInviteSent() {
    setShowInviteModal(false);
    setSuccess("Invitation sent");
    revalidator.revalidate();
  }

  return (
    <AppLayout user={user} org={org} currentPath="/org/members">
      <header className={styles.header}>
        <h1>Members</h1>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            Current Members ({members.length})
          </h2>
          <button
            onClick={() => setShowInviteModal(true)}
            className={styles.inviteButton}
          >
            Invite Member
          </button>
        </div>

        {members.length === 0 ? (
          <div className={styles.emptyState}>No members found</div>
        ) : (
          <MembersTable
            members={members}
            currentUser={user}
            isOwner={org.isOwner}
            onRoleChange={handleRoleChange}
            onRemove={handleRemoveMember}
            onTransferOwnership={handleTransferOwnership}
          />
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            Pending Invitations ({invitations.length})
          </h2>
        </div>

        {invitations.length === 0 ? (
          <div className={styles.emptyState}>No pending invitations</div>
        ) : (
          <InvitationsTable
            invitations={invitations}
            onRevoke={handleRevokeInvitation}
          />
        )}
      </section>

      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onSuccess={handleInviteSent}
        />
      )}
    </AppLayout>
  );
}

/**
 * Table displaying current organization members.
 */
function MembersTable({
  members,
  currentUser,
  isOwner,
  onRoleChange,
  onRemove,
  onTransferOwnership,
}: {
  members: OrgMember[];
  currentUser: { id: string };
  isOwner: boolean;
  onRoleChange: (member: OrgMember, newRole: string) => void;
  onRemove: (member: OrgMember) => void;
  onTransferOwnership: (member: OrgMember) => void;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Role</th>
          <th>Joined</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => {
          const isCurrentUser = member.userId === currentUser.id;
          const canEditRole = !member.isOwner && !isCurrentUser;
          const canRemove = !member.isOwner && !isCurrentUser;
          const canTransfer =
            isOwner &&
            !member.isOwner &&
            !isCurrentUser &&
            member.role === "admin";

          return (
            <tr key={member.id}>
              <td>
                <div className={styles.memberName}>
                  {member.name}
                  {isCurrentUser && " (you)"}
                </div>
                <div className={styles.memberEmail}>{member.email}</div>
              </td>

              <td>
                {canEditRole ? (
                  <select
                    className={styles.roleSelect}
                    value={member.role}
                    onChange={(e) => onRoleChange(member, e.target.value)}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  <RoleBadge member={member} />
                )}
              </td>

              <td>{new Date(member.createdAt).toLocaleDateString()}</td>

              <td>
                <div className={styles.actions}>
                  {canTransfer && (
                    <button
                      className={styles.actionButton}
                      onClick={() => onTransferOwnership(member)}
                    >
                      Transfer Ownership
                    </button>
                  )}
                  {canRemove && (
                    <button
                      className={`${styles.actionButton} ${styles.actionButtonDanger}`}
                      onClick={() => onRemove(member)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Display a member's role as a badge.
 */
function RoleBadge({ member }: { member: OrgMember }) {
  let badgeClass = styles.badge;

  if (member.isOwner) {
    badgeClass = `${styles.badge} ${styles.badgeOwner}`;
  } else if (member.role === "admin") {
    badgeClass = `${styles.badge} ${styles.badgeAdmin}`;
  }

  const label = member.isOwner ? "Owner" : member.role;

  return <span className={badgeClass}>{label}</span>;
}

/**
 * Table displaying pending invitations.
 */
function InvitationsTable({
  invitations,
  onRevoke,
}: {
  invitations: PendingInvitation[];
  onRevoke: (inv: PendingInvitation) => void;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Email</th>
          <th>Role</th>
          <th>Invited By</th>
          <th>Expires</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {invitations.map((inv) => {
          const expiresAt = new Date(inv.expiresAt);
          const expiringInADay =
            inv.expiresAt - Date.now() < 24 * 60 * 60 * 1000;

          return (
            <tr key={inv.id}>
              <td className={styles.pendingEmail}>{inv.email}</td>
              <td>
                <span className={styles.badge}>{inv.role}</span>
              </td>
              <td className={styles.pendingMeta}>{inv.inviterName}</td>
              <td className={styles.pendingMeta}>
                {expiresAt.toLocaleDateString()}
                {expiringInADay && " (soon)"}
              </td>
              <td>
                <button
                  className={`${styles.actionButton} ${styles.actionButtonDanger}`}
                  onClick={() => onRevoke(inv)}
                >
                  Revoke
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Modal for inviting new members.
 */
function InviteModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/org/invitations`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to send invitation");
      }

      onSuccess();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to send invitation";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.modal} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>Invite a Team Member</h2>

        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="email" className={styles.label}>
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              placeholder="colleague@lawfirm.com"
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="role" className={styles.label}>
              Role
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
              className={styles.select}
            >
              <option value="member">Member (read-only)</option>
              <option value="admin">Admin (full access)</option>
            </select>
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              onClick={onClose}
              className={styles.cancelButton}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={styles.submitButton}
            >
              {isSubmitting ? "Sending..." : "Send Invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
