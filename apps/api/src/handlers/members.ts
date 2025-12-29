/**
 * Member Management Handlers
 *
 * HTTP handlers for organization member and invitation management:
 * - Listing members
 * - Sending invitations
 * - Managing invitations (list, revoke)
 * - Removing members
 * - Updating member roles
 * - Transferring ownership
 * - Public invitation routes (view/accept)
 */

import { getSession, requireAdmin, isAuthError } from "../lib/session";
import type { Env } from "../types/env";
import type { OrgRole } from "../types";
import {
  getOrgMembership,
  removeUserFromOrg,
  transferOwnership,
} from "../services/org-membership";
import {
  inviteUser,
  getOrgInvitations,
  revokeInvitation,
  hasPendingInvitation,
  getInvitationById,
  acceptInvitationById,
} from "../services/invitations";

/**
 * GET /api/org/members
 *
 * Returns all members of the user's organization.
 * Any member can view the member list.
 *
 * Response: [{ id, userId, email, name, role, isOwner, createdAt }, ...]
 */
export async function handleGetMembers(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getSession(request, env);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user's org
  const membership = await env.DB.prepare(
    `SELECT org_id FROM org_members WHERE user_id = ?`
  )
    .bind(session.user.id)
    .first<{ org_id: string }>();

  if (!membership) {
    return Response.json(
      { error: "Not a member of any organization" },
      { status: 403 }
    );
  }

  // Get all members with user details
  const { results } = await env.DB.prepare(
    `SELECT
       om.id, om.user_id, u.email, u.name, om.role, om.is_owner, om.created_at
     FROM org_members om
     JOIN user u ON u.id = om.user_id
     WHERE om.org_id = ?
     ORDER BY om.created_at`
  )
    .bind(membership.org_id)
    .all<{
      id: string;
      user_id: string;
      email: string;
      name: string;
      role: OrgRole;
      is_owner: number;
      created_at: number;
    }>();

  return Response.json(
    results.map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      isOwner: row.is_owner === 1,
      createdAt: row.created_at,
    }))
  );
}

/**
 * POST /api/org/invitations
 *
 * Sends an invitation to join the organization.
 * Requires admin access.
 *
 * Request body: { email: string, role: "admin" | "member" }
 *
 * Response: { id, email, role, expiresAt, emailError?: string }
 */
export async function handleSendInvitation(
  request: Request,
  env: Env
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (isAuthError(admin)) {
    return admin;
  }

  // Parse request body
  let body: { email?: string; role?: OrgRole };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate email
  const email = body.email?.toLowerCase().trim();

  if (!email || !email.includes("@")) {
    return Response.json({ error: "Valid email is required" }, { status: 400 });
  }

  // Validate role
  if (body.role !== "admin" && body.role !== "member") {
    return Response.json(
      { error: "Role must be 'admin' or 'member'" },
      { status: 400 }
    );
  }

  // Check if user is already a member
  const existingMember = await env.DB.prepare(
    `SELECT 1 FROM org_members om
     JOIN user u ON u.id = om.user_id
     WHERE u.email = ? AND om.org_id = ?`
  )
    .bind(email, admin.orgId)
    .first();

  if (existingMember) {
    return Response.json(
      { error: "This user is already a member of your organization" },
      { status: 400 }
    );
  }

  // Check for existing pending invitation
  if (await hasPendingInvitation(env.DB, email, admin.orgId)) {
    return Response.json(
      { error: "A pending invitation already exists for this email" },
      { status: 400 }
    );
  }

  // Get org name for the email
  const org = await env.DB.prepare(`SELECT name FROM org WHERE id = ?`)
    .bind(admin.orgId)
    .first<{ name: string }>();

  if (!org) {
    return Response.json({ error: "Organization not found" }, { status: 404 });
  }

  // Send the invitation
  const result = await inviteUser(env, env.DB, {
    email,
    orgId: admin.orgId,
    orgName: org.name,
    role: body.role,
    invitedBy: admin.userId,
    inviterName: admin.userName,
  });

  return Response.json({
    id: result.id,
    email,
    role: body.role,
    expiresAt: result.expiresAt,
    emailError: result.emailError,
  });
}

/**
 * GET /api/org/invitations
 *
 * Returns all pending invitations for the organization.
 * Requires admin access.
 *
 * Response: [{ id, email, role, invitedBy, inviterName, createdAt, expiresAt }, ...]
 */
export async function handleGetInvitations(
  request: Request,
  env: Env
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (isAuthError(admin)) {
    return admin;
  }

  // Get pending invitations
  const invitations = await getOrgInvitations(env.DB, admin.orgId);

  // Get inviter names
  const inviterIds = [...new Set(invitations.map((inv) => inv.invitedBy))];
  const inviterNames = new Map<string, string>();

  if (inviterIds.length > 0) {
    const placeholders = inviterIds.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT id, name FROM user WHERE id IN (${placeholders})`
    )
      .bind(...inviterIds)
      .all<{ id: string; name: string }>();

    for (const user of results) {
      inviterNames.set(user.id, user.name);
    }
  }

  return Response.json(
    invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      invitedBy: inv.invitedBy,
      inviterName: inviterNames.get(inv.invitedBy) || "Unknown",
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
    }))
  );
}

/**
 * DELETE /api/org/invitations/:invitationId
 *
 * Revokes a pending invitation.
 * Requires admin access.
 *
 * Response: { success: true }
 */
export async function handleRevokeInvitation(
  request: Request,
  env: Env,
  invitationId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (isAuthError(admin)) {
    return admin;
  }

  // Verify invitation belongs to this org
  const invitation = await env.DB.prepare(
    `SELECT org_id FROM invitations WHERE id = ?`
  )
    .bind(invitationId)
    .first<{ org_id: string }>();

  if (!invitation || invitation.org_id !== admin.orgId) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }

  // Revoke the invitation
  const success = await revokeInvitation(env.DB, invitationId);

  if (success) {
    return Response.json({ success: true });
  }

  return Response.json(
    { error: "Invitation not found or already accepted" },
    { status: 404 }
  );
}

/**
 * DELETE /api/org/members/:userId
 *
 * Removes a member from the organization.
 * Requires admin access. Cannot remove yourself (use leave instead).
 * Cannot remove the owner.
 *
 * Response: { success: true }
 */
export async function handleRemoveMember(
  request: Request,
  env: Env,
  targetUserId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (isAuthError(admin)) {
    return admin;
  }

  // Cannot remove yourself
  if (targetUserId === admin.userId) {
    return Response.json(
      { error: "Cannot remove yourself. Use leave organization instead." },
      { status: 400 }
    );
  }

  // Remove the member
  const result = await removeUserFromOrg(
    env.DB,
    targetUserId,
    admin.orgId,
    env.TENANT
  );

  if (!result.success) {
    const statusCodes: Record<string, number> = {
      user_not_member: 404,
      is_owner: 400,
      db_error: 500,
    };

    return Response.json(
      { error: result.message },
      { status: statusCodes[result.error] || 500 }
    );
  }

  return Response.json({ success: true });
}

/**
 * PATCH /api/org/members/:userId
 *
 * Updates a member's role.
 * Requires admin access. Cannot change the owner's role.
 *
 * Request body: { role: "admin" | "member" }
 *
 * Response: { success: true, role: string }
 */
export async function handleUpdateMemberRole(
  request: Request,
  env: Env,
  targetUserId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (isAuthError(admin)) {
    return admin;
  }

  // Parse request body
  let body: { role?: OrgRole };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate role
  if (body.role !== "admin" && body.role !== "member") {
    return Response.json(
      { error: "Role must be 'admin' or 'member'" },
      { status: 400 }
    );
  }

  // Get target membership
  const target = await getOrgMembership(env.DB, targetUserId, admin.orgId);

  if (!target) {
    return Response.json({ error: "User is not a member" }, { status: 404 });
  }

  // Cannot change owner's role
  if (target.isOwner) {
    return Response.json(
      { error: "Cannot change the owner's role" },
      { status: 400 }
    );
  }

  // Update the role
  await env.DB.prepare(
    `UPDATE org_members SET role = ? WHERE user_id = ? AND org_id = ?`
  )
    .bind(body.role, targetUserId, admin.orgId)
    .run();

  return Response.json({ success: true, role: body.role });
}

/**
 * POST /api/org/transfer-ownership
 *
 * Transfers organization ownership to another admin.
 * Requires current user to be the owner and type the org name to confirm.
 *
 * Request body: { toUserId: string, confirmName: string }
 *
 * Response: { success: true }
 */
export async function handleTransferOwnership(
  request: Request,
  env: Env
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (isAuthError(admin)) {
    return admin;
  }

  // Must be the owner to transfer ownership
  if (!admin.isOwner) {
    return Response.json(
      { error: "Only the owner can transfer ownership" },
      { status: 403 }
    );
  }

  // Parse request body
  let body: { toUserId?: string; confirmName?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  if (!body.toUserId) {
    return Response.json(
      { error: "Target user ID is required" },
      { status: 400 }
    );
  }

  if (!body.confirmName) {
    return Response.json(
      { error: "Organization name confirmation is required" },
      { status: 400 }
    );
  }

  // Get org name and verify it matches
  const org = await env.DB.prepare(`SELECT name FROM org WHERE id = ?`)
    .bind(admin.orgId)
    .first<{ name: string }>();

  if (!org || body.confirmName !== org.name) {
    return Response.json({ error: "Name does not match" }, { status: 400 });
  }

  // Transfer ownership
  const result = await transferOwnership(
    env.DB,
    admin.orgId,
    admin.userId,
    body.toUserId
  );

  if (!result.success) {
    const statusCodes: Record<string, number> = {
      not_owner: 403,
      target_not_member: 404,
      target_not_admin: 400,
      db_error: 500,
    };

    return Response.json(
      { error: result.message },
      { status: statusCodes[result.error] || 500 }
    );
  }

  return Response.json({ success: true });
}

// ============================================================
// Public Invitation Routes (can be accessed without being a member)
// ============================================================

/**
 * GET /api/invitations/:invitationId
 *
 * Gets public details about an invitation.
 * Used by the accept invitation page.
 * Does NOT require authentication.
 *
 * Response: { id, email, orgName, role, inviterName, isExpired, isAccepted }
 */
export async function handleGetInvitation(
  _request: Request,
  env: Env,
  invitationId: string
): Promise<Response> {
  const invitation = await getInvitationById(env.DB, invitationId);

  if (!invitation) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }

  return Response.json({
    id: invitation.id,
    email: invitation.email,
    orgName: invitation.orgName,
    role: invitation.role,
    inviterName: invitation.inviterName,
    isExpired: invitation.isExpired,
    isAccepted: invitation.isAccepted,
  });
}

/**
 * POST /api/invitations/:invitationId/accept
 *
 * Accepts an invitation and joins the organization.
 * Requires authentication. The logged-in user's email must match
 * the invitation email.
 *
 * Response: { success: true, orgId: string, role: string }
 */
export async function handleAcceptInvitation(
  request: Request,
  env: Env,
  invitationId: string
): Promise<Response> {
  const session = await getSession(request, env);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if user already belongs to an organization
  const existingMembership = await env.DB.prepare(
    `SELECT org_id FROM org_members WHERE user_id = ?`
  )
    .bind(session.user.id)
    .first<{ org_id: string }>();

  if (existingMembership) {
    return Response.json(
      { error: "You already belong to an organization" },
      { status: 400 }
    );
  }

  // Get invitation details
  const invitation = await getInvitationById(env.DB, invitationId);

  if (!invitation) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }

  if (invitation.isAccepted) {
    return Response.json(
      { error: "This invitation has already been accepted" },
      { status: 400 }
    );
  }

  if (invitation.isExpired) {
    return Response.json(
      { error: "This invitation has expired" },
      { status: 400 }
    );
  }

  // Verify email matches
  if (session.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return Response.json(
      {
        error:
          "This invitation was sent to a different email address. Please log in with the correct account.",
      },
      { status: 403 }
    );
  }

  // Accept the invitation
  const result = await acceptInvitationById(
    env.DB,
    invitationId,
    session.user.id
  );

  if (result) {
    return Response.json({
      success: true,
      orgId: result.orgId,
      role: result.role,
    });
  }

  return Response.json(
    { error: "Failed to accept invitation" },
    { status: 500 }
  );
}
