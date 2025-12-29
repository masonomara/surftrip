/**
 * Organization Deletion Service
 *
 * Handles complete deletion of an organization and all its data
 * across D1, R2, and Durable Objects.
 */

import { getOrgMembership } from "./org-membership";

// =============================================================================
// Types
// =============================================================================

export interface OrgDeletionPreview {
  org: { id: string; name: string } | null;
  members: number;
  invitations: number;
  workspaceBindings: number;
  apiKeys: number;
  subscriptions: number;
  orgContextChunks: number;
}

interface DODeletionResult {
  conversations: number;
  messages: number;
  pendingConfirmations: number;
  kvEntries: number;
}

type DeleteOrgResult =
  | {
      success: true;
      deletedRecords: {
        org: true;
        members: number;
        invitations: number;
        workspaceBindings: number;
        apiKeys: number;
        subscriptions: number;
        orgContextChunks: number;
      };
      deletedR2Objects: number;
      deletedDO: DODeletionResult | null;
      errors: string[];
    }
  | {
      success: false;
      deletedRecords: {
        org: true;
        members: number;
        invitations: number;
        workspaceBindings: number;
        apiKeys: number;
        subscriptions: number;
        orgContextChunks: number;
      };
      deletedR2Objects: number;
      deletedDO: DODeletionResult | null;
      errors: string[];
    }
  | {
      success: false;
      error: "org_not_found" | "not_owner" | "db_error";
      message: string;
    };

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Counts records in a table for a specific org.
 *
 * SECURITY: Table name is interpolated directly into SQL. Only call with
 * hardcoded table names - never pass user input as the table parameter.
 */
async function countRecords(
  db: D1Database,
  table: string,
  orgId: string
): Promise<number> {
  const result = await db
    .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE org_id = ?`)
    .bind(orgId)
    .first<{ count: number }>();

  return result?.count ?? 0;
}

/**
 * Deletes all R2 objects for an organization.
 * Objects are stored under: orgs/{orgId}/...
 */
async function deleteOrgR2Objects(
  r2: R2Bucket,
  orgId: string
): Promise<number> {
  let deletedCount = 0;
  let cursor: string | undefined;

  // Paginate through all objects under this org's prefix
  do {
    const listResult = await r2.list({
      prefix: `orgs/${orgId}/`,
      cursor,
      limit: 100,
    });

    if (listResult.objects.length > 0) {
      // Batch delete
      const keys = listResult.objects.map((obj) => obj.key);
      await r2.delete(keys);
      deletedCount += listResult.objects.length;
    }

    cursor = listResult.truncated ? listResult.cursor : undefined;
  } while (cursor);

  return deletedCount;
}

// =============================================================================
// Preview Function
// =============================================================================

/**
 * Returns a preview of what would be deleted for an organization.
 * Useful for confirmation dialogs.
 */
export async function getOrgDeletionPreview(
  db: D1Database,
  orgId: string
): Promise<OrgDeletionPreview> {
  // Fetch org info and all counts in parallel
  const [
    org,
    members,
    invitations,
    workspaceBindings,
    apiKeys,
    subscriptions,
    orgContextChunks,
  ] = await Promise.all([
    db
      .prepare(`SELECT id, name FROM org WHERE id = ?`)
      .bind(orgId)
      .first<{ id: string; name: string }>(),
    countRecords(db, "org_members", orgId),
    countRecords(db, "invitations", orgId),
    countRecords(db, "workspace_bindings", orgId),
    countRecords(db, "api_keys", orgId),
    countRecords(db, "subscriptions", orgId),
    countRecords(db, "org_context_chunks", orgId),
  ]);

  return {
    org: org ?? null,
    members,
    invitations,
    workspaceBindings,
    apiKeys,
    subscriptions,
    orgContextChunks,
  };
}

// =============================================================================
// Main Deletion Function
// =============================================================================

/**
 * Deletes an organization and all its data.
 *
 * Process:
 * 1. Verify org exists
 * 2. Verify requesting user is an owner
 * 3. Delete org from D1 (CASCADE handles related tables)
 * 4. Delete R2 objects (audit logs, archived conversations, etc)
 * 5. Clear Durable Object storage
 *
 * Note: Only owners can delete an organization.
 */
export async function deleteOrg(
  db: D1Database,
  r2: R2Bucket,
  orgId: string,
  requestingUserId: string,
  tenant?: DurableObjectNamespace
): Promise<DeleteOrgResult> {
  // Step 1: Verify org exists
  const orgExists = await db
    .prepare(`SELECT id FROM org WHERE id = ?`)
    .bind(orgId)
    .first();

  if (!orgExists) {
    return {
      success: false,
      error: "org_not_found",
      message: "Organization not found.",
    };
  }

  // Step 2: Verify requesting user is an owner
  const membership = await getOrgMembership(db, requestingUserId, orgId);

  if (!membership?.isOwner) {
    return {
      success: false,
      error: "not_owner",
      message: "Only the owner can delete the organization.",
    };
  }

  // Step 3: Get preview counts before deletion
  const preview = await getOrgDeletionPreview(db, orgId);
  const errors: string[] = [];

  // Step 4: Delete org from D1 (CASCADE deletes related records)
  try {
    await db.prepare(`DELETE FROM org WHERE id = ?`).bind(orgId).run();
  } catch (error) {
    return {
      success: false,
      error: "db_error",
      message: `Database error: ${error}`,
    };
  }

  // Step 5: Delete R2 objects
  let deletedR2Objects = 0;
  try {
    deletedR2Objects = await deleteOrgR2Objects(r2, orgId);
  } catch (error) {
    errors.push(`R2 deletion failed: ${error}`);
  }

  // Step 6: Clear Durable Object storage
  let deletedDO: DODeletionResult | null = null;

  if (tenant) {
    try {
      const doStub = tenant.get(tenant.idFromName(orgId));
      const response = await doStub.fetch(
        new Request("https://do/delete-org", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );

      if (response.ok) {
        const result = (await response.json()) as {
          deleted: DODeletionResult;
        };
        deletedDO = result.deleted;
      } else {
        errors.push(`DO deletion failed: ${response.status}`);
      }
    } catch (error) {
      errors.push(`DO deletion failed: ${error}`);
    }
  }

  // Build the result
  const deletedRecords = {
    org: true as const,
    members: preview.members,
    invitations: preview.invitations,
    workspaceBindings: preview.workspaceBindings,
    apiKeys: preview.apiKeys,
    subscriptions: preview.subscriptions,
    orgContextChunks: preview.orgContextChunks,
  };

  if (errors.length > 0) {
    return {
      success: false,
      deletedRecords,
      deletedR2Objects,
      deletedDO,
      errors,
    };
  }

  return {
    success: true,
    deletedRecords,
    deletedR2Objects,
    deletedDO,
    errors,
  };
}
