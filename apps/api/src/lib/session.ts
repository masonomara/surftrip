import { getAuth } from "./auth";
import { logAuthzFailure } from "./logger";
import type { Env } from "../types/env";

export async function getSession(request: Request, env: Env) {
  try {
    return await getAuth(env).api.getSession({ headers: request.headers });
  } catch {
    return null;
  }
}

interface MembershipRow {
  org_id: string;
  role: string;
  is_owner: number;
}

export async function getMembership(
  db: D1Database,
  userId: string,
  requireAdmin = false
) {
  const query = requireAdmin
    ? `SELECT org_id, role, is_owner FROM org_members WHERE user_id = ? AND role = 'admin'`
    : `SELECT org_id, role, is_owner FROM org_members WHERE user_id = ?`;
  return db.prepare(query).bind(userId).first<MembershipRow>();
}

// ============================================================================
// Admin Authentication Helper
// ============================================================================

export interface AdminUser {
  userId: string;
  userName: string;
  orgId: string;
  isOwner: boolean;
}

/**
 * Checks if the request is from an authenticated admin user.
 * Returns the user info if authenticated, or an error Response if not.
 */
export async function requireAdmin(
  request: Request,
  env: Env
): Promise<AdminUser | Response> {
  const session = await getSession(request, env);
  const path = new URL(request.url).pathname;

  if (!session?.user) {
    logAuthzFailure("requireAdmin", "No session", { path });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getMembership(env.DB, session.user.id, true);

  if (!membership) {
    logAuthzFailure("requireAdmin", "Not admin", {
      userId: session.user.id,
      path,
    });
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  return {
    userId: session.user.id,
    userName: session.user.name,
    orgId: membership.org_id,
    isOwner: membership.is_owner === 1,
  };
}

/**
 * Type guard to check if the auth result is an error response.
 */
export function isAuthError(result: AdminUser | Response): result is Response {
  return result instanceof Response;
}

/**
 * Checks if the request is from the organization owner.
 * Returns the user info if authenticated, or an error Response if not.
 */
export async function requireOwner(
  request: Request,
  env: Env
): Promise<AdminUser | Response> {
  const session = await getSession(request, env);
  const path = new URL(request.url).pathname;

  if (!session?.user) {
    logAuthzFailure("requireOwner", "No session", { path });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await env.DB.prepare(
    `SELECT org_id, role, is_owner FROM org_members WHERE user_id = ?`
  )
    .bind(session.user.id)
    .first<{ org_id: string; role: string; is_owner: number }>();

  if (!membership) {
    logAuthzFailure("requireOwner", "No organization", {
      userId: session.user.id,
      path,
    });
    return Response.json({ error: "No organization found" }, { status: 404 });
  }

  if (!membership.is_owner) {
    logAuthzFailure("requireOwner", "Not owner", {
      userId: session.user.id,
      orgId: membership.org_id,
      path,
    });
    return Response.json(
      { error: "Only the owner can perform this action" },
      { status: 403 }
    );
  }

  return {
    userId: session.user.id,
    userName: session.user.name,
    orgId: membership.org_id,
    isOwner: true,
  };
}
