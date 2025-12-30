/**
 * Invitation Service
 *
 * Handles organization member invitations. Invitations are sent via email
 * and expire after 7 days by default. Once accepted, the invitation
 * becomes a membership record.
 */

import { type OrgRole, type Invitation } from "../types";
import { sendInvitationEmail, type EmailEnv } from "./email";

// Milliseconds per day
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Database row shape for invitations.
 * Uses snake_case to match D1 column naming.
 */
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
 * Converts a database row to the application's Invitation type.
 * Transforms snake_case database columns to camelCase properties.
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
 * Creates a new invitation record in the database.
 *
 * Does NOT send the email - use inviteUser() for the full flow.
 *
 * @param db - D1 database binding
 * @param input - Invitation parameters
 * @returns The created invitation ID and expiration timestamp
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
  const expiresInDays = input.expiresInDays ?? 7;
  const expiresAt = now + expiresInDays * MS_PER_DAY;

  await db
    .prepare(
      `INSERT INTO invitations (id, email, org_id, role, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
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
 * Accepts an invitation and creates a membership record.
 *
 * Atomically:
 * 1. Creates a new org_members record for the user
 * 2. Marks the invitation as accepted
 *
 * Returns null if the invitation doesn't exist, is expired, or already accepted.
 *
 * @param db - D1 database binding
 * @param invitationId - The invitation to accept
 * @param userId - The user accepting the invitation
 * @returns The org ID and role if successful, null otherwise
 */
export async function acceptInvitationById(
  db: D1Database,
  invitationId: string,
  userId: string
) {
  // Find the invitation (must be pending and not expired)
  const invitation = await db
    .prepare(
      `SELECT org_id, role FROM invitations WHERE id = ? AND accepted_at IS NULL AND expires_at > ?`
    )
    .bind(invitationId, Date.now())
    .first<{ org_id: string; role: OrgRole }>();

  if (!invitation) {
    return null;
  }

  const now = Date.now();
  const memberId = crypto.randomUUID();

  // Create membership and mark invitation as accepted atomically
  await db.batch([
    db
      .prepare(
        `INSERT INTO org_members (id, org_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(memberId, invitation.org_id, userId, invitation.role, now),
    db
      .prepare(`UPDATE invitations SET accepted_at = ? WHERE id = ?`)
      .bind(now, invitationId),
  ]);

  return { orgId: invitation.org_id, role: invitation.role };
}

/**
 * Gets all pending invitations for an organization.
 *
 * Only returns invitations that:
 * - Haven't been accepted yet
 * - Haven't expired
 *
 * @param db - D1 database binding
 * @param orgId - Organization ID
 * @returns Array of pending invitations, newest first
 */
export async function getOrgInvitations(
  db: D1Database,
  orgId: string
): Promise<Invitation[]> {
  const { results } = await db
    .prepare(
      `SELECT id, email, org_id, role, invited_by, created_at, expires_at, accepted_at
       FROM invitations
       WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC`
    )
    .bind(orgId, Date.now())
    .all<InvitationRow>();

  return results.map(rowToInvitation);
}

/**
 * Revokes (deletes) a pending invitation.
 *
 * Can only revoke invitations that haven't been accepted yet.
 *
 * @param db - D1 database binding
 * @param invitationId - The invitation to revoke
 * @returns true if the invitation was revoked, false if not found or already accepted
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
 * Gets detailed information about an invitation.
 *
 * Includes related data for display:
 * - Organization name
 * - Inviter's name
 * - Expiration and acceptance status
 *
 * Used by the accept invitation page to show context.
 *
 * @param db - D1 database binding
 * @param invitationId - The invitation ID
 * @returns Invitation details or null if not found
 */
export async function getInvitationById(db: D1Database, invitationId: string) {
  const row = await db
    .prepare(
      `SELECT
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
       WHERE i.id = ?`
    )
    .bind(invitationId)
    .first<{
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

  return {
    id: row.id,
    email: row.email,
    orgId: row.org_id,
    orgName: row.org_name,
    role: row.role,
    inviterName: row.inviter_name,
    expiresAt: row.expires_at,
    isExpired: row.expires_at < Date.now(),
    isAccepted: row.accepted_at !== null,
  };
}

/**
 * Checks if there's already a pending invitation for an email in an organization.
 *
 * Used to prevent sending duplicate invitations.
 *
 * @param db - D1 database binding
 * @param email - The email to check
 * @param orgId - The organization ID
 * @returns true if a pending invitation exists
 */
export async function hasPendingInvitation(
  db: D1Database,
  email: string,
  orgId: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM invitations
       WHERE email = ? AND org_id = ? AND accepted_at IS NULL AND expires_at > ?`
    )
    .bind(email.toLowerCase(), orgId, Date.now())
    .first();

  return row !== null;
}

/**
 * Creates an invitation and sends the invitation email.
 *
 * This is the high-level function that handles the full invitation flow:
 * 1. Creates the invitation record in the database
 * 2. Sends the invitation email to the user
 *
 * Even if the email fails to send, the invitation is still created
 * and can be manually shared.
 *
 * @param env - Environment with email configuration
 * @param db - D1 database binding
 * @param input - Invitation parameters including org and inviter names
 * @returns The invitation ID, expiration, and any email error
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
