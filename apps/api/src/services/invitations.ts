import { type OrgRole, type Invitation } from "../types";
import { sendInvitationEmail, type EmailEnv } from "./email";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type InvitationRow = {
  id: string;
  email: string;
  org_id: string;
  role: OrgRole;
  invited_by: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
};

/**
 * Convert a database row to an Invitation object.
 */
function rowToInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    orgId: row.org_id,
    role: row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}

/**
 * Create a new invitation in the database.
 */
export async function createInvitation(
  db: D1Database,
  input: {
    email: string;
    orgId: string;
    role: OrgRole;
    invitedBy: string;
    expiresInDays?: number;
  }
) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const daysUntilExpiry = input.expiresInDays ?? 7;
  const expiresAt = now + daysUntilExpiry * MS_PER_DAY;

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
 * Accept an invitation and add the user to the organization.
 * Returns the org info if successful, null if the invitation is invalid.
 */
export async function acceptInvitationById(
  db: D1Database,
  invitationId: string,
  userId: string
) {
  // Find a valid, unexpired, unaccepted invitation
  const invitation = await db
    .prepare(
      `SELECT org_id, role FROM invitations
       WHERE id = ? AND accepted_at IS NULL AND expires_at > ?`
    )
    .bind(invitationId, Date.now())
    .first<{ org_id: string; role: OrgRole }>();

  if (!invitation) {
    return null;
  }

  // Add user to org and mark invitation as accepted
  const now = Date.now();
  const memberId = crypto.randomUUID();

  await db.batch([
    db
      .prepare(
        `INSERT INTO org_members (id, org_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(memberId, invitation.org_id, userId, invitation.role, now),
    db
      .prepare(`UPDATE invitations SET accepted_at = ? WHERE id = ?`)
      .bind(now, invitationId),
  ]);

  return {
    orgId: invitation.org_id,
    role: invitation.role,
  };
}

/**
 * Get all pending (unaccepted, unexpired) invitations for an organization.
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

  const { results } = await db
    .prepare(query)
    .bind(orgId, Date.now())
    .all<InvitationRow>();

  return results.map(rowToInvitation);
}

/**
 * Revoke (delete) a pending invitation.
 * Returns true if the invitation was deleted, false if it didn't exist or was already accepted.
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
 * Get full invitation details by ID, including org name and inviter name.
 * Used for the invitation acceptance flow.
 */
export async function getInvitationById(db: D1Database, invitationId: string) {
  const query = `
    SELECT
      i.id,
      i.email,
      i.org_id,
      i.role,
      i.expires_at,
      i.accepted_at,
      o.name as org_name,
      u.name as inviter_name
    FROM invitations i
    JOIN org o ON o.id = i.org_id
    JOIN user u ON u.id = i.invited_by
    WHERE i.id = ?
  `;

  const row = await db.prepare(query).bind(invitationId).first<{
    id: string;
    email: string;
    org_id: string;
    role: OrgRole;
    expires_at: number;
    accepted_at: number | null;
    org_name: string;
    inviter_name: string;
  }>();

  if (!row) {
    return null;
  }

  const now = Date.now();

  return {
    id: row.id,
    email: row.email,
    orgId: row.org_id,
    orgName: row.org_name,
    role: row.role,
    inviterName: row.inviter_name,
    expiresAt: row.expires_at,
    isExpired: row.expires_at < now,
    isAccepted: row.accepted_at !== null,
  };
}

/**
 * Check if there's already a pending invitation for this email at this org.
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

  const row = await db
    .prepare(query)
    .bind(email.toLowerCase(), orgId, Date.now())
    .first();

  return row !== null;
}

/**
 * Create an invitation and send the invitation email.
 * This is the main function for inviting users.
 */
export async function inviteUser(
  env: EmailEnv,
  db: D1Database,
  input: {
    email: string;
    orgId: string;
    orgName: string;
    role: OrgRole;
    invitedBy: string;
    inviterName: string;
  }
) {
  // Create the invitation record
  const invitation = await createInvitation(db, {
    email: input.email,
    orgId: input.orgId,
    role: input.role,
    invitedBy: input.invitedBy,
  });

  // Send the invitation email
  const emailResult = await sendInvitationEmail(env, {
    to: input.email,
    orgName: input.orgName,
    inviterName: input.inviterName,
    role: input.role,
    invitationId: invitation.id,
  });

  return {
    id: invitation.id,
    expiresAt: invitation.expiresAt,
    emailError: emailResult.error,
  };
}
