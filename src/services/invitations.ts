import { type OrgRole, type Invitation } from "../types";

export type { OrgRole, Invitation };

const DEFAULT_EXPIRY_DAYS = 7;
const MS_PER_DAY = 86400000;

interface CreateInvitationInput {
  email: string;
  orgId: string;
  role: OrgRole;
  invitedBy: string;
  expiresInDays?: number;
}

/**
 * Create a new org invitation.
 * Invitation expires after 7 days by default.
 */
export async function createInvitation(
  db: D1Database,
  input: CreateInvitationInput
): Promise<{ id: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiryDays = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt = now + expiryDays * MS_PER_DAY;

  const query = `
    INSERT INTO invitations (id, email, org_id, role, invited_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  await db
    .prepare(query)
    .bind(
      id,
      input.email.toLowerCase(),
      input.orgId,
      input.role,
      input.invitedBy,
      now,
      expiresAt
    )
    .run();

  return { id, expiresAt };
}

/**
 * Find a pending (unaccepted, unexpired) invitation for an email.
 */
export async function findPendingInvitation(
  db: D1Database,
  email: string
): Promise<{ id: string; orgId: string; role: OrgRole } | null> {
  const query = `
    SELECT id, org_id, role
    FROM invitations
    WHERE email = ?
      AND accepted_at IS NULL
      AND expires_at > ?
  `;

  const result = await db
    .prepare(query)
    .bind(email.toLowerCase(), Date.now())
    .first<{ id: string; org_id: string; role: OrgRole }>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    orgId: result.org_id,
    role: result.role,
  };
}

/**
 * Process an invitation when a user signs up or logs in.
 * If they have a pending invitation, adds them to the org and marks it accepted.
 */
export async function processInvitation(
  db: D1Database,
  user: { id: string; email: string }
): Promise<{ orgId: string; role: OrgRole } | null> {
  const invitation = await findPendingInvitation(db, user.email);
  if (!invitation) {
    return null;
  }

  const now = Date.now();
  const membershipId = crypto.randomUUID();

  // Add to org and mark invitation as accepted in a single transaction
  await db.batch([
    db
      .prepare(
        `INSERT INTO org_members (id, org_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(membershipId, invitation.orgId, user.id, invitation.role, now),
    db
      .prepare(`UPDATE invitations SET accepted_at = ? WHERE id = ?`)
      .bind(now, invitation.id),
  ]);

  return {
    orgId: invitation.orgId,
    role: invitation.role,
  };
}

/**
 * Get all pending invitations for an org.
 */
export async function getOrgInvitations(
  db: D1Database,
  orgId: string
): Promise<Invitation[]> {
  const query = `
    SELECT id, email, org_id, role, invited_by, created_at, expires_at, accepted_at
    FROM invitations
    WHERE org_id = ?
      AND accepted_at IS NULL
      AND expires_at > ?
    ORDER BY created_at DESC
  `;

  interface InvitationRow {
    id: string;
    email: string;
    org_id: string;
    role: OrgRole;
    invited_by: string;
    created_at: number;
    expires_at: number;
    accepted_at: number | null;
  }

  const result = await db
    .prepare(query)
    .bind(orgId, Date.now())
    .all<InvitationRow>();

  return result.results.map((row) => ({
    id: row.id,
    email: row.email,
    orgId: row.org_id,
    role: row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  }));
}

/**
 * Cancel a pending invitation.
 * Returns true if an invitation was deleted, false if none was found.
 */
export async function revokeInvitation(
  db: D1Database,
  invitationId: string
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM invitations WHERE id = ? AND accepted_at IS NULL`)
    .bind(invitationId)
    .run();

  return result.meta.changes > 0;
}

/**
 * Check if a pending invitation already exists for this email+org combo.
 */
export async function hasPendingInvitation(
  db: D1Database,
  email: string,
  orgId: string
): Promise<boolean> {
  const query = `
    SELECT 1 FROM invitations
    WHERE email = ?
      AND org_id = ?
      AND accepted_at IS NULL
      AND expires_at > ?
  `;

  const result = await db
    .prepare(query)
    .bind(email.toLowerCase(), orgId, Date.now())
    .first();

  return result !== null;
}
