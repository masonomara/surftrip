import type { MemberContext, AdminContext, AuthContext } from "../lib/session";
import { logAuthzFailure } from "../lib/logger";
import type { Env } from "../types/env";
import type { OrgRole } from "../types";
import { getOrgMembership, removeUserFromOrg, transferOwnership } from "../services/org-membership";
import {
  inviteUser,
  getOrgInvitations,
  revokeInvitation,
  hasPendingInvitation,
  getInvitationById,
  acceptInvitationById,
} from "../services/invitations";

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isValidRole(role: unknown): role is OrgRole {
  return role === "admin" || role === "member";
}

function getErrorStatusCode(errorType: string): number {
  const statusMap: Record<string, number> = {
    user_not_member: 404,
    is_owner: 400,
    db_error: 500,
    not_owner: 403,
    target_not_member: 404,
    target_not_admin: 400,
  };
  return statusMap[errorType] || 500;
}

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  name: string;
  role: OrgRole;
  is_owner: number;
  created_at: number;
}

function formatMemberResponse(row: MemberRow) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    isOwner: row.is_owner === 1,
    createdAt: row.created_at,
  };
}

// -----------------------------------------------------------------------------
// Member Management Handlers
// -----------------------------------------------------------------------------

/**
 * GET /org/members
 * Returns all members of the organization.
 */
export async function handleGetMembers(
  _request: Request,
  env: Env,
  ctx: MemberContext
): Promise<Response> {
  const query = `
    SELECT om.id, om.user_id, u.email, u.name, om.role, om.is_owner, om.created_at
    FROM org_members om
    JOIN user u ON u.id = om.user_id
    WHERE om.org_id = ?
    ORDER BY om.created_at
  `;

  const { results } = await env.DB.prepare(query)
    .bind(ctx.orgId)
    .all<MemberRow>();

  const members = results.map(formatMemberResponse);
  return Response.json(members);
}

/**
 * DELETE /org/members/:userId
 * Remove a member from the organization.
 */
export async function handleRemoveMember(
  _request: Request,
  env: Env,
  ctx: AdminContext,
  targetUserId: string
): Promise<Response> {
  // Prevent self-removal
  if (targetUserId === ctx.user.id) {
    return Response.json(
      { error: "Cannot remove yourself. Use leave organization instead." },
      { status: 400 }
    );
  }

  const result = await removeUserFromOrg(env.DB, targetUserId, ctx.orgId, env.TENANT);

  if (result.success === false) {
    const status = getErrorStatusCode(result.error);
    return Response.json({ error: result.message }, { status });
  }

  return Response.json({ success: true });
}

/**
 * PATCH /org/members/:userId
 * Update a member's role.
 */
export async function handleUpdateMemberRole(
  request: Request,
  env: Env,
  ctx: AdminContext,
  targetUserId: string
): Promise<Response> {
  // Parse and validate request body
  const body = await parseJsonBody<{ role?: OrgRole }>(request);
  if (!body) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidRole(body.role)) {
    return Response.json(
      { error: "Role must be 'admin' or 'member'" },
      { status: 400 }
    );
  }

  // Check target user's current membership
  const targetMembership = await getOrgMembership(env.DB, targetUserId, ctx.orgId);
  if (!targetMembership) {
    return Response.json({ error: "User is not a member" }, { status: 404 });
  }

  if (targetMembership.isOwner) {
    return Response.json({ error: "Cannot change the owner's role" }, { status: 400 });
  }

  // Update the role
  await env.DB.prepare(`UPDATE org_members SET role = ? WHERE user_id = ? AND org_id = ?`)
    .bind(body.role, targetUserId, ctx.orgId)
    .run();

  return Response.json({ success: true, role: body.role });
}

/**
 * POST /org/transfer-ownership
 * Transfer organization ownership to another admin.
 */
export async function handleTransferOwnership(
  request: Request,
  env: Env,
  ctx: AdminContext
): Promise<Response> {
  // Only the owner can transfer ownership
  if (!ctx.isOwner) {
    logAuthzFailure("transferOwnership", "Not owner", {
      userId: ctx.user.id,
      orgId: ctx.orgId,
    });
    return Response.json(
      { error: "Only the owner can transfer ownership" },
      { status: 403 }
    );
  }

  // Parse and validate request body
  const body = await parseJsonBody<{ toUserId?: string; confirmName?: string }>(request);
  if (!body) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.toUserId) {
    return Response.json({ error: "Target user ID is required" }, { status: 400 });
  }

  if (!body.confirmName) {
    return Response.json(
      { error: "Organization name confirmation is required" },
      { status: 400 }
    );
  }

  // Verify organization name matches
  const org = await env.DB.prepare(`SELECT name FROM org WHERE id = ?`)
    .bind(ctx.orgId)
    .first<{ name: string }>();

  if (!org || body.confirmName !== org.name) {
    return Response.json({ error: "Name does not match" }, { status: 400 });
  }

  // Perform the transfer
  const result = await transferOwnership(env.DB, ctx.orgId, ctx.user.id, body.toUserId);

  if (result.success === false) {
    const status = getErrorStatusCode(result.error);
    return Response.json({ error: result.message }, { status });
  }

  return Response.json({ success: true });
}

// -----------------------------------------------------------------------------
// Invitation Handlers
// -----------------------------------------------------------------------------

/**
 * POST /org/invitations
 * Send an invitation to join the organization.
 */
export async function handleSendInvitation(
  request: Request,
  env: Env,
  ctx: AdminContext
): Promise<Response> {
  // Parse and validate request body
  const body = await parseJsonBody<{ email?: string; role?: OrgRole }>(request);
  if (!body) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.toLowerCase().trim();
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Valid email is required" }, { status: 400 });
  }

  if (!isValidRole(body.role)) {
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
    .bind(email, ctx.orgId)
    .first();

  if (existingMember) {
    return Response.json(
      { error: "This user is already a member of your organization" },
      { status: 400 }
    );
  }

  // Check for existing pending invitation
  const hasPending = await hasPendingInvitation(env.DB, email, ctx.orgId);
  if (hasPending) {
    return Response.json(
      { error: "A pending invitation already exists for this email" },
      { status: 400 }
    );
  }

  // Get organization name for the invitation email
  const org = await env.DB.prepare(`SELECT name FROM org WHERE id = ?`)
    .bind(ctx.orgId)
    .first<{ name: string }>();

  if (!org) {
    return Response.json({ error: "Organization not found" }, { status: 404 });
  }

  // Send the invitation
  const result = await inviteUser(env, env.DB, {
    email,
    orgId: ctx.orgId,
    orgName: org.name,
    role: body.role,
    invitedBy: ctx.user.id,
    inviterName: ctx.user.name,
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
 * GET /org/invitations
 * Returns all pending invitations for the organization.
 */
export async function handleGetInvitations(
  _request: Request,
  env: Env,
  ctx: AdminContext
): Promise<Response> {
  const invitations = await getOrgInvitations(env.DB, ctx.orgId);

  // Collect unique inviter IDs to fetch their names
  const inviterIds = Array.from(new Set(invitations.map((inv) => inv.invitedBy)));
  const inviterNames = new Map<string, string>();

  if (inviterIds.length > 0) {
    const placeholders = inviterIds.map(() => "?").join(",");
    const query = `SELECT id, name FROM user WHERE id IN (${placeholders})`;

    const { results } = await env.DB.prepare(query)
      .bind(...inviterIds)
      .all<{ id: string; name: string }>();

    for (const user of results) {
      inviterNames.set(user.id, user.name);
    }
  }

  // Format the response
  const formattedInvitations = invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    invitedBy: inv.invitedBy,
    inviterName: inviterNames.get(inv.invitedBy) || "Unknown",
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
  }));

  return Response.json(formattedInvitations);
}

/**
 * DELETE /org/invitations/:invitationId
 * Revoke a pending invitation.
 */
export async function handleRevokeInvitation(
  _request: Request,
  env: Env,
  ctx: AdminContext,
  invitationId: string
): Promise<Response> {
  // Verify the invitation belongs to this organization
  const invitation = await env.DB.prepare(`SELECT org_id FROM invitations WHERE id = ?`)
    .bind(invitationId)
    .first<{ org_id: string }>();

  if (!invitation || invitation.org_id !== ctx.orgId) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }

  // Revoke the invitation
  const revoked = await revokeInvitation(env.DB, invitationId);

  if (!revoked) {
    return Response.json(
      { error: "Invitation not found or already accepted" },
      { status: 404 }
    );
  }

  return Response.json({ success: true });
}

/**
 * GET /invitations/:invitationId
 * Get invitation details (public, for the invitation accept page).
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
 * POST /invitations/:invitationId/accept
 * Accept an invitation to join an organization.
 */
export async function handleAcceptInvitation(
  _request: Request,
  env: Env,
  ctx: AuthContext,
  invitationId: string
): Promise<Response> {
  // Check if user already belongs to an organization
  const existingMembership = await env.DB.prepare(
    `SELECT org_id FROM org_members WHERE user_id = ?`
  )
    .bind(ctx.user.id)
    .first<{ org_id: string }>();

  if (existingMembership) {
    return Response.json(
      { error: "You already belong to an organization" },
      { status: 400 }
    );
  }

  // Get the invitation
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
  const userEmail = ctx.user.email.toLowerCase();
  const invitationEmail = invitation.email.toLowerCase();

  if (userEmail !== invitationEmail) {
    logAuthzFailure("acceptInvitation", "Email mismatch", {
      userId: ctx.user.id,
      email: ctx.user.email,
    });
    return Response.json(
      { error: "This invitation was sent to a different email address. Please log in with the correct account." },
      { status: 403 }
    );
  }

  // Accept the invitation
  const result = await acceptInvitationById(env.DB, invitationId, ctx.user.id);

  if (!result) {
    return Response.json({ error: "Failed to accept invitation" }, { status: 500 });
  }

  return Response.json({
    success: true,
    orgId: result.orgId,
    role: result.role,
  });
}
