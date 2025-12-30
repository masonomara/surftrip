/**
 * Organization Membership Service
 *
 * Manages user membership in organizations:
 * - Looking up memberships
 * - Removing users from orgs
 * - Transferring ownership
 */

import {
  type OrgRole,
  type OrgMembership,
  type OrgMemberRow,
  orgMemberRowToEntity,
} from "../types";

// Re-export types for convenience
export type { OrgRole, OrgMembership };

// =============================================================================
// Lookup Functions
// =============================================================================

/**
 * Gets a user's membership in an organization.
 * Returns null if the user is not a member.
 */
export async function getOrgMembership(
  db: D1Database,
  userId: string,
  orgId: string
): Promise<OrgMembership | null> {
  const row = await db
    .prepare(`SELECT * FROM org_members WHERE user_id = ? AND org_id = ?`)
    .bind(userId, orgId)
    .first<OrgMemberRow>();

  if (!row) {
    return null;
  }

  return orgMemberRowToEntity(row);
}

/**
 * Gets all members of an organization.
 * Returned in order of when they joined (created_at).
 */
export async function getOrgMembers(
  db: D1Database,
  orgId: string
): Promise<OrgMembership[]> {
  const result = await db
    .prepare(`SELECT * FROM org_members WHERE org_id = ? ORDER BY created_at`)
    .bind(orgId)
    .all<OrgMemberRow>();

  return result.results.map(orgMemberRowToEntity);
}

// =============================================================================
// Member Removal
// =============================================================================

type RemoveResult =
  | { success: true }
  | {
      success: false;
      error: "user_not_member" | "is_owner" | "db_error";
      message: string;
    };

/**
 * Removes a user from an organization.
 *
 * Rules:
 * - User must be a member
 * - Owners cannot leave (must transfer ownership first)
 *
 * Also cleans up any pending confirmations in the TenantDO.
 */
export async function removeUserFromOrg(
  db: D1Database,
  userId: string,
  orgId: string,
  tenant?: DurableObjectNamespace
): Promise<RemoveResult> {
  // Check current membership
  const membership = await getOrgMembership(db, userId, orgId);

  if (!membership) {
    return {
      success: false,
      error: "user_not_member",
      message: "User is not a member of this organization.",
    };
  }

  // Owners cannot leave directly
  if (membership.isOwner) {
    return {
      success: false,
      error: "is_owner",
      message: "Owner cannot leave. Transfer ownership first.",
    };
  }

  // Remove from database
  try {
    await db
      .prepare(`DELETE FROM org_members WHERE user_id = ? AND org_id = ?`)
      .bind(userId, orgId)
      .run();

    // Clean up any pending confirmations in the DO
    if (tenant) {
      const doStub = tenant.get(tenant.idFromName(orgId));
      await doStub.fetch(
        new Request("https://do/remove-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        })
      );
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: "db_error",
      message: `Database error: ${error}`,
    };
  }
}

// =============================================================================
// Ownership Transfer
// =============================================================================

type TransferResult =
  | { success: true }
  | {
      success: false;
      error:
        | "not_owner"
        | "target_not_member"
        | "target_not_admin"
        | "db_error";
      message: string;
    };

/**
 * Transfers ownership of an organization to another user.
 *
 * Rules:
 * - Only the current owner can transfer ownership
 * - Target must be an existing member with admin role
 * - The old owner remains as an admin after transfer
 */
export async function transferOwnership(
  db: D1Database,
  orgId: string,
  fromUserId: string,
  toUserId: string
): Promise<TransferResult> {
  // Verify current user is the owner
  const currentOwner = await getOrgMembership(db, fromUserId, orgId);

  if (!currentOwner?.isOwner) {
    return {
      success: false,
      error: "not_owner",
      message: "Only the current owner can transfer ownership.",
    };
  }

  // Verify target is a member
  const targetMember = await getOrgMembership(db, toUserId, orgId);

  if (!targetMember) {
    return {
      success: false,
      error: "target_not_member",
      message: "Target user is not a member of this organization.",
    };
  }

  // Target must be an admin (promotion path: member -> admin -> owner)
  if (targetMember.role !== "admin") {
    return {
      success: false,
      error: "target_not_admin",
      message: "Ownership can only be transferred to an admin.",
    };
  }

  // D1 batch() is atomic: all statements succeed or all rollback on failure
  try {
    const results = await db.batch([
      db
        .prepare(
          `UPDATE org_members SET is_owner = 0 WHERE user_id = ? AND org_id = ?`
        )
        .bind(fromUserId, orgId),
      db
        .prepare(
          `UPDATE org_members SET is_owner = 1 WHERE user_id = ? AND org_id = ?`
        )
        .bind(toUserId, orgId),
    ]);

    // Verify both updates affected exactly one row each
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
      return {
        success: false,
        error: "db_error",
        message: "Ownership transfer failed: unexpected row count.",
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: "db_error",
      message: `Database error: ${error}`,
    };
  }
}
