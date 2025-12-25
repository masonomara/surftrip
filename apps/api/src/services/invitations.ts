import { type OrgRole, type Invitation } from "../types";
import { sendInvitationEmail, type EmailEnv } from "./email";

// Invitations expire after 7 days by default
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRATION_DAYS = 7;

/**
 * Database row structure for invitations.
 */
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

/**
 * Converts a database row to an Invitation entity.
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

// ============================================================================
// Create Invitation
// ============================================================================

interface CreateInvitationInput {
  email: string;
  orgId: string;
  role: OrgRole;
  invitedBy: string;
  expiresInDays?: number;
}

interface CreateInvitationResult {
  id: string;
  expiresAt: number;
}

/**
 * Creates a new invitation in the database.
 */
export async function createInvitation(
  db: D1Database,
  input: CreateInvitationInput
): Promise<CreateInvitationResult> {
  const invitationId = crypto.randomUUID();
  const now = Date.now();
  const expirationDays = input.expiresInDays ?? DEFAULT_EXPIRATION_DAYS;
  const expiresAt = now + expirationDays * MILLISECONDS_PER_DAY;

  await db
    .prepare(
      `INSERT INTO invitations (id, email, org_id, role, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      invitationId,
      input.email.toLowerCase(),
      input.orgId,
      input.role,
      input.invitedBy,
      now,
      expiresAt
    )
    .run();

  return {
    id: invitationId,
    expiresAt: expiresAt,
  };
}

// ============================================================================
// Find Pending Invitation
// ============================================================================

interface PendingInvitation {
  id: string;
  orgId: string;
  role: OrgRole;
}

/**
 * Finds a pending (not accepted, not expired) invitation for an email.
 */
export async function findPendingInvitation(
  db: D1Database,
  email: string
): Promise<PendingInvitation | null> {
  const row = await db
    .prepare(
      `SELECT id, org_id, role
       FROM invitations
       WHERE email = ?
         AND accepted_at IS NULL
         AND expires_at > ?`
    )
    .bind(email.toLowerCase(), Date.now())
    .first<{ id: string; org_id: string; role: OrgRole }>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    orgId: row.org_id,
    role: row.role,
  };
}

// ============================================================================
// Process Invitation (Accept)
// ============================================================================

interface ProcessInvitationResult {
  orgId: string;
  role: OrgRole;
}

/**
 * Processes a pending invitation for a newly registered user.
 * Adds them to the organization and marks the invitation as accepted.
 */
export async function processInvitation(
  db: D1Database,
  user: { id: string; email: string }
): Promise<ProcessInvitationResult | null> {
  const invitation = await findPendingInvitation(db, user.email);

  if (!invitation) {
    return null;
  }

  const now = Date.now();
  const membershipId = crypto.randomUUID();

  // Add user to org and mark invitation as accepted in one transaction
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

// ============================================================================
// Get Organization Invitations
// ============================================================================

/**
 * Gets all pending invitations for an organization.
 * Returns only invitations that haven't been accepted and haven't expired.
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
    .all<InvitationRow>();

  return result.results.map(rowToInvitation);
}

// ============================================================================
// Revoke Invitation
// ============================================================================

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

// ============================================================================
// Check for Pending Invitation
// ============================================================================

/**
 * Checks if a pending invitation already exists for an email in an org.
 */
export async function hasPendingInvitation(
  db: D1Database,
  email: string,
  orgId: string
): Promise<boolean> {
  const row = await db
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

  return row !== null;
}

// ============================================================================
// Invite User (Create + Send Email)
// ============================================================================

interface InviteUserInput {
  email: string;
  orgId: string;
  orgName: string;
  role: OrgRole;
  invitedBy: string;
  inviterName: string;
}

interface InviteUserResult {
  id: string;
  expiresAt: number;
  emailError?: string;
}

/**
 * Creates an invitation and sends the invitation email.
 * This is the main function to use when inviting a new user.
 */
export async function inviteUser(
  env: EmailEnv,
  db: D1Database,
  input: InviteUserInput
): Promise<InviteUserResult> {
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
