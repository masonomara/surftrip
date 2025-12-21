import { type OrgRole, type Invitation } from "../types";

export type { OrgRole, Invitation };

export interface CreateInvitationInput {
  email: string;
  orgId: string;
  role: OrgRole;
  invitedBy: string;
  expiresInDays?: number;
}

const DEFAULT_EXPIRY_DAYS = 7;
const MS_PER_DAY = 86400000;

/**
 * Creates a new invitation for a user to join an organization.
 */
export async function createInvitation(
  db: D1Database,
  input: CreateInvitationInput
): Promise<{ id: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiryDays = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt = now + expiryDays * MS_PER_DAY;

  await db
    .prepare(
      `INSERT INTO invitations (id, email, org_id, role, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
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
 * Finds a pending (not accepted, not expired) invitation by email.
 */
export async function findPendingInvitation(
  db: D1Database,
  email: string
): Promise<{ id: string; orgId: string; role: OrgRole } | null> {
  const result = await db
    .prepare(
      `SELECT id, org_id, role
       FROM invitations
       WHERE email = ?
         AND accepted_at IS NULL
         AND expires_at > ?`
    )
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
 * Processes a pending invitation for a user who just signed up or logged in.
 * Creates org membership and marks the invitation as accepted.
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

  await db.batch([
    db
      .prepare(
        `INSERT INTO org_members (id, org_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)`
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
 * Gets all pending invitations for an organization.
 */
export async function getOrgInvitations(
  db: D1Database,
  orgId: string
): Promise<Invitation[]> {
  const result = await db
    .prepare(
      `SELECT id, email, org_id, role, invited_by, created_at, expires_at, accepted_at
       FROM invitations
       WHERE org_id = ?
         AND accepted_at IS NULL
         AND expires_at > ?
       ORDER BY created_at DESC`
    )
    .bind(orgId, Date.now())
    .all<{
      id: string;
      email: string;
      org_id: string;
      role: OrgRole;
      invited_by: string;
      created_at: number;
      expires_at: number;
      accepted_at: number | null;
    }>();

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
 * Revokes (deletes) a pending invitation.
 * Returns true if an invitation was deleted, false if not found.
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
 * Checks if a user already has a pending invitation for an organization.
 */
export async function hasPendingInvitation(
  db: D1Database,
  email: string,
  orgId: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `SELECT 1
       FROM invitations
       WHERE email = ?
         AND org_id = ?
         AND accepted_at IS NULL
         AND expires_at > ?`
    )
    .bind(email.toLowerCase(), orgId, Date.now())
    .first();

  return result !== null;
}
