/**
 * Organization Handlers
 *
 * HTTP handlers for organization management:
 * - Creating a new organization
 * - Getting the current user's organization
 * - Updating organization settings
 * - Getting deletion preview
 * - Deleting an organization
 */

import { getSession, requireAdmin, requireOwner, isAuthError } from "../lib/session";
import type { Env } from "../types/env";
import type { OrgMemberRow } from "../types";
import { orgMemberRowToEntity } from "../types";
import { getOrgDeletionPreview, deleteOrg } from "../services/org-deletion";

interface CreateOrgBody {
  name?: string;
  firmSize?: string;
  jurisdictions?: string[];
  practiceTypes?: string[];
}

/**
 * Checks if a user already belongs to an organization.
 * Users can only be in one organization at a time.
 */
async function userHasOrganization(
  db: D1Database,
  userId: string
): Promise<boolean> {
  const membership = await db
    .prepare("SELECT org_id FROM org_members WHERE user_id = ?")
    .bind(userId)
    .first();

  return membership !== null;
}

/**
 * POST /api/org
 *
 * Creates a new organization and makes the current user the owner.
 *
 * Users can only belong to one organization, so this fails if the user
 * is already a member of any organization.
 *
 * Request body: { name: string, firmSize?: string, jurisdictions?: string[], practiceTypes?: string[] }
 *
 * Response: { org: { id, name }, membership: { role: "admin", isOwner: true } }
 */
export async function handleCreateOrg(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getSession(request, env);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if user already has an organization
  if (await userHasOrganization(env.DB, session.user.id)) {
    return Response.json(
      { error: "User already belongs to an organization" },
      { status: 400 }
    );
  }

  // Parse request body
  let body: CreateOrgBody;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  if (!body.name?.trim()) {
    return Response.json(
      { error: "Organization name is required" },
      { status: 400 }
    );
  }

  // Generate IDs and timestamp
  const orgId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const now = Date.now();

  try {
    // Create org and membership in a single transaction
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO org (id, name, jurisdictions, practice_types, firm_size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        orgId,
        body.name.trim(),
        body.jurisdictions ? JSON.stringify(body.jurisdictions) : null,
        body.practiceTypes ? JSON.stringify(body.practiceTypes) : null,
        body.firmSize || null,
        now,
        now
      ),
      env.DB.prepare(
        `INSERT INTO org_members (id, user_id, org_id, role, is_owner, created_at)
         VALUES (?, ?, ?, 'admin', 1, ?)`
      ).bind(memberId, session.user.id, orgId, now),
    ]);

    return Response.json({
      org: { id: orgId, name: body.name.trim() },
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
 * GET /api/user/org
 *
 * Returns the current user's organization and membership details.
 * Returns null if the user doesn't belong to any organization.
 *
 * Response: { org: { id, name, ... }, role: string, isOwner: boolean } | null
 */
export async function handleGetUserOrg(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getSession(request, env);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get membership with org details in one query
  const row = await env.DB.prepare(
    `SELECT
       om.id, om.user_id, om.org_id, om.role, om.is_owner, om.created_at,
       o.name as org_name,
       o.jurisdictions as org_jurisdictions,
       o.practice_types as org_practice_types,
       o.firm_size as org_firm_size
     FROM org_members om
     JOIN org o ON o.id = om.org_id
     WHERE om.user_id = ?`
  )
    .bind(session.user.id)
    .first<
      OrgMemberRow & {
        org_name: string;
        org_jurisdictions: string | null;
        org_practice_types: string | null;
        org_firm_size: string | null;
      }
    >();

  // User doesn't belong to any organization
  if (!row) {
    return Response.json(null);
  }

  const membership = orgMemberRowToEntity(row);

  return Response.json({
    org: {
      id: membership.orgId,
      name: row.org_name,
      jurisdictions: row.org_jurisdictions
        ? JSON.parse(row.org_jurisdictions)
        : [],
      practiceTypes: row.org_practice_types
        ? JSON.parse(row.org_practice_types)
        : [],
      firmSize: row.org_firm_size || undefined,
    },
    role: membership.role,
    isOwner: membership.isOwner,
  });
}

/**
 * PATCH /api/org
 *
 * Updates organization settings. Requires admin access.
 *
 * Request body: { name?: string, jurisdictions?: string[], practiceTypes?: string[], firmSize?: string }
 *
 * Response: { success: true }
 */
export async function handleUpdateOrg(
  request: Request,
  env: Env
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (isAuthError(admin)) {
    return admin;
  }

  // Parse request body
  let body: {
    name?: string;
    jurisdictions?: string[];
    practiceTypes?: string[];
    firmSize?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // SECURITY: Dynamic query construction with parameterized values.
  // Column names are hardcoded - never interpolate user input as column names.
  // All values use ? placeholders and .bind() to prevent SQL injection.
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return Response.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    updates.push("name = ?");
    values.push(body.name.trim());
  }

  if (body.jurisdictions !== undefined) {
    updates.push("jurisdictions = ?");
    values.push(JSON.stringify(body.jurisdictions));
  }

  if (body.practiceTypes !== undefined) {
    updates.push("practice_types = ?");
    values.push(JSON.stringify(body.practiceTypes));
  }

  if (body.firmSize !== undefined) {
    updates.push("firm_size = ?");
    values.push(body.firmSize || null);
  }

  // At least one field must be updated
  if (updates.length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  // Always update the updated_at timestamp
  updates.push("updated_at = ?");
  values.push(String(Date.now()));

  // Add org_id as the WHERE clause parameter
  values.push(admin.orgId);

  try {
    await env.DB.prepare(`UPDATE org SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();

    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to update org:", error);
    return Response.json(
      { error: "Failed to update organization" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/org/deletion-preview
 *
 * Returns a summary of what will be deleted when the organization is deleted.
 * Only the owner can view this.
 *
 * Response includes counts of:
 * - Members who will be removed
 * - Documents that will be deleted
 * - Messages that will be deleted
 * - Audit logs that will be deleted
 */
export async function handleGetOrgDeletionPreview(
  request: Request,
  env: Env
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (isAuthError(owner)) {
    return owner;
  }

  const preview = await getOrgDeletionPreview(env.DB, owner.orgId);
  return Response.json(preview);
}

/**
 * DELETE /api/org
 *
 * Permanently deletes the organization and all associated data.
 * Requires the user to be the owner and confirm by typing the org name.
 *
 * Request body: { confirmName: string }
 *
 * Response: { deleted: { ... counts ... } }
 */
export async function handleDeleteOrg(
  request: Request,
  env: Env
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (isAuthError(owner)) {
    return owner;
  }

  // Parse request body
  let body: { confirmName?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Get the org name for confirmation
  const org = await env.DB.prepare(`SELECT name FROM org WHERE id = ?`)
    .bind(owner.orgId)
    .first<{ name: string }>();

  if (!org) {
    return Response.json({ error: "Organization not found" }, { status: 404 });
  }

  // Verify the confirmation name matches
  if (body.confirmName !== org.name) {
    return Response.json(
      { error: "Organization name does not match" },
      { status: 400 }
    );
  }

  // Delete the organization and all data
  const result = await deleteOrg(
    env.DB,
    env.R2,
    owner.orgId,
    owner.userId,
    env.TENANT
  );

  if ("error" in result) {
    return Response.json({ error: result.message }, { status: 400 });
  }

  return Response.json(result);
}
