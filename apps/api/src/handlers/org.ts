import { getAuth } from "../lib/auth";
import type { Env } from "../types/env";
import type { OrgMemberRow } from "../types";
import { orgMemberRowToEntity } from "../types";

/**
 * Expected request body for creating an organization.
 */
interface CreateOrgBody {
  name?: string;
  firmSize?: string;
  jurisdictions?: string[];
  practiceTypes?: string[];
}

/**
 * Validates the session and returns the authenticated user.
 * Returns null if the session is invalid or expired.
 */
async function getAuthenticatedSession(request: Request, env: Env) {
  try {
    const auth = getAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    return session;
  } catch (error) {
    console.error("Session validation error:", error);
    return null;
  }
}

/**
 * Checks if a user already belongs to an organization.
 */
async function userHasOrganization(
  db: D1Database,
  userId: string
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT org_id FROM org_members WHERE user_id = ?")
    .bind(userId)
    .first();

  return existing !== null;
}

/**
 * Parses and validates the request body for organization creation.
 */
async function parseCreateOrgBody(
  request: Request
): Promise<{ body: CreateOrgBody } | { error: string }> {
  let body: CreateOrgBody;

  try {
    body = await request.json();
  } catch {
    return { error: "Invalid JSON body" };
  }

  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return { error: "Organization name is required" };
  }

  return { body };
}

/**
 * Creates a new organization with the current user as owner.
 *
 * POST /api/org
 */
export async function handleCreateOrg(
  request: Request,
  env: Env
): Promise<Response> {
  // Verify the user is authenticated
  const session = await getAuthenticatedSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Check if user already belongs to an org
  const alreadyHasOrg = await userHasOrganization(env.DB, userId);
  if (alreadyHasOrg) {
    return Response.json(
      { error: "User already belongs to an organization" },
      { status: 400 }
    );
  }

  // Parse and validate the request body
  const parseResult = await parseCreateOrgBody(request);
  if ("error" in parseResult) {
    return Response.json({ error: parseResult.error }, { status: 400 });
  }

  const { body } = parseResult;
  const orgName = body.name!.trim();
  const orgId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const now = Date.now();

  // Create the org and add the user as owner in a single transaction
  try {
    const createOrgStatement = env.DB.prepare(
      `INSERT INTO org (id, name, jurisdictions, practice_types, firm_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orgId,
      orgName,
      body.jurisdictions ? JSON.stringify(body.jurisdictions) : null,
      body.practiceTypes ? JSON.stringify(body.practiceTypes) : null,
      body.firmSize || null,
      now,
      now
    );

    const createMemberStatement = env.DB.prepare(
      `INSERT INTO org_members (id, user_id, org_id, role, is_owner, created_at)
       VALUES (?, ?, ?, 'admin', 1, ?)`
    ).bind(memberId, userId, orgId, now);

    await env.DB.batch([createOrgStatement, createMemberStatement]);

    return Response.json({
      org: { id: orgId, name: orgName },
      membership: { role: "admin", isOwner: true },
    });
  } catch (error) {
    console.error("Failed to create org:", error);
    return Response.json(
      { error: "Failed to create organization" },
      { status: 500 }
    );
  }
}

/**
 * Gets the current user's organization membership.
 *
 * GET /api/user/org
 */
export async function handleGetUserOrg(
  request: Request,
  env: Env
): Promise<Response> {
  // Verify the user is authenticated
  const session = await getAuthenticatedSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Query for the user's org membership with org details
  const row = await env.DB.prepare(
    `SELECT
       om.id,
       om.user_id,
       om.org_id,
       om.role,
       om.is_owner,
       om.created_at,
       o.name as org_name
     FROM org_members om
     JOIN org o ON o.id = om.org_id
     WHERE om.user_id = ?`
  )
    .bind(session.user.id)
    .first<OrgMemberRow & { org_name: string }>();

  // User doesn't belong to any org
  if (!row) {
    return Response.json(null);
  }

  // Convert the database row to a clean response
  const membership = orgMemberRowToEntity(row);

  return Response.json({
    org: {
      id: membership.orgId,
      name: row.org_name,
    },
    role: membership.role,
    isOwner: membership.isOwner,
  });
}
