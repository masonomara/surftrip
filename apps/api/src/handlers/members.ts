import { getAuth } from "../lib/auth";
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
 * Get the current session from the request.
 * Returns null if the user is not authenticated.
 */
async function getSession(request: Request, env: Env) {
  try {
    const session = await getAuth(env).api.getSession({
      headers: request.headers,
    });
    return session;
  } catch {
    return null;
  }
}

/**
 * Check if the current user is an admin of their organization.
 * Returns the org info if they are, or an error response if not.
 */
async function requireAdmin(db: D1Database, userId: string) {
  const membership = await db
    .prepare(`SELECT org_id, role, is_owner FROM org_members WHERE user_id = ?`)
    .bind(userId)
    .first<{ org_id: string; role: OrgRole; is_owner: number }>();

  if (!membership) {
    return {
      ok: false as const,
      res: Response.json(
        { error: "Not a member of any organization" },
        { status: 403 }
      ),
    };
  }

  if (membership.role !== "admin") {
    return {
      ok: false as const,
      res: Response.json({ error: "Admin access required" }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    orgId: membership.org_id,
    isOwner: membership.is_owner === 1,
  };
}

/**
 * GET /api/org/members
 * List all members of the current user's organization.
 */
export async function handleGetMembers(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find which org this user belongs to
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

  // Get all members of that org
  const query = `
    SELECT
      om.id,
      om.user_id,
      u.email,
      u.name,
      om.role,
      om.is_owner,
      om.created_at
    FROM org_members om
    JOIN user u ON u.id = om.user_id
    WHERE om.org_id = ?
    ORDER BY om.created_at
  `;

  const { results } = await env.DB.prepare(query).bind(membership.org_id).all<{
    id: string;
    user_id: string;
    email: string;
    name: string;
    role: OrgRole;
    is_owner: number;
    created_at: number;
  }>();

  // Transform to camelCase for the API response
  const members = results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    isOwner: row.is_owner === 1,
    createdAt: row.created_at,
  }));

  return Response.json(members);
}

/**
 * POST /api/org/invitations
 * Send an invitation to join the organization.
 */
export async function handleSendInvitation(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await requireAdmin(env.DB, session.user.id);
  if (!admin.ok) {
    return admin.res;
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
  const role = body.role;
  if (role !== "admin" && role !== "member") {
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
  const hasPending = await hasPendingInvitation(env.DB, email, admin.orgId);
  if (hasPending) {
    return Response.json(
      { error: "A pending invitation already exists for this email" },
      { status: 400 }
    );
  }

  // Get org name for the invitation email
  const org = await env.DB.prepare(`SELECT name FROM org WHERE id = ?`)
    .bind(admin.orgId)
    .first<{ name: string }>();

  if (!org) {
    return Response.json({ error: "Organization not found" }, { status: 404 });
  }

  // Create and send the invitation
  const result = await inviteUser(env, env.DB, {
    email,
    orgId: admin.orgId,
    orgName: org.name,
    role,
    invitedBy: session.user.id,
    inviterName: session.user.name,
  });

  return Response.json({
    id: result.id,
    email,
    role,
    expiresAt: result.expiresAt,
    emailError: result.emailError,
  });
}

/**
 * GET /api/org/invitations
 * List all pending invitations for the organization.
 */
export async function handleGetInvitations(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await requireAdmin(env.DB, session.user.id);
  if (!admin.ok) {
    return admin.res;
  }

  // Get all pending invitations
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

  // Build response with inviter names
  const response = invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    invitedBy: inv.invitedBy,
    inviterName: inviterNames.get(inv.invitedBy) || "Unknown",
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
  }));

  return Response.json(response);
}

/**
 * DELETE /api/org/invitations/:id
 * Revoke a pending invitation.
 */
export async function handleRevokeInvitation(
  request: Request,
  env: Env,
  invitationId: string
): Promise<Response> {
  const session = await getSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await requireAdmin(env.DB, session.user.id);
  if (!admin.ok) {
    return admin.res;
  }

  // Verify the invitation belongs to this org
  const invitation = await env.DB.prepare(
    `SELECT org_id FROM invitations WHERE id = ?`
  )
    .bind(invitationId)
    .first<{ org_id: string }>();

  if (!invitation || invitation.org_id !== admin.orgId) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }

  // Revoke it
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
 * DELETE /api/org/members/:userId
 * Remove a member from the organization.
 */
export async function handleRemoveMember(
  request: Request,
  env: Env,
  targetUserId: string
): Promise<Response> {
  const session = await getSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await requireAdmin(env.DB, session.user.id);
  if (!admin.ok) {
    return admin.res;
  }

  // Can't remove yourself
  if (targetUserId === session.user.id) {
    return Response.json(
      { error: "Cannot remove yourself. Use leave organization instead." },
      { status: 400 }
    );
  }

  // Attempt removal
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
    const status = statusCodes[result.error] || 500;
    return Response.json({ error: result.message }, { status });
  }

  return Response.json({ success: true });
}

/**
 * PATCH /api/org/members/:userId
 * Update a member's role.
 */
export async function handleUpdateMemberRole(
  request: Request,
  env: Env,
  targetUserId: string
): Promise<Response> {
  const session = await getSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await requireAdmin(env.DB, session.user.id);
  if (!admin.ok) {
    return admin.res;
  }

  // Parse body
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

  // Check target user exists and is in this org
  const targetMember = await getOrgMembership(
    env.DB,
    targetUserId,
    admin.orgId
  );
  if (!targetMember) {
    return Response.json({ error: "User is not a member" }, { status: 404 });
  }

  // Can't change owner's role
  if (targetMember.isOwner) {
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
 * Transfer organization ownership to another admin.
 */
export async function handleTransferOwnership(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await requireAdmin(env.DB, session.user.id);
  if (!admin.ok) {
    return admin.res;
  }

  // Only the owner can transfer ownership
  if (!admin.isOwner) {
    return Response.json(
      { error: "Only the owner can transfer ownership" },
      { status: 403 }
    );
  }

  // Parse body
  let body: { toUserId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.toUserId) {
    return Response.json(
      { error: "Target user ID is required" },
      { status: 400 }
    );
  }

  // Perform the transfer
  const result = await transferOwnership(
    env.DB,
    admin.orgId,
    session.user.id,
    body.toUserId
  );

  if (!result.success) {
    const statusCodes: Record<string, number> = {
      not_owner: 403,
      target_not_member: 404,
      target_not_admin: 400,
      db_error: 500,
    };
    const status = statusCodes[result.error] || 500;
    return Response.json({ error: result.message }, { status });
  }

  return Response.json({ success: true });
}

/**
 * GET /api/invitations/:id
 * Get invitation details (public, no auth required).
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
 * POST /api/invitations/:id/accept
 * Accept an invitation to join an organization.
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

  // Check if user is already in an org
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

  // Verify the email matches
  const userEmail = session.user.email.toLowerCase();
  const invitedEmail = invitation.email.toLowerCase();

  if (userEmail !== invitedEmail) {
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

  if (!result) {
    return Response.json(
      { error: "Failed to accept invitation" },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    orgId: result.orgId,
    role: result.role,
  });
}
