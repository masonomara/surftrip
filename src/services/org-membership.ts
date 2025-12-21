import {
  type OrgRole,
  type OrgMembership,
  type OrgMemberRow,
  orgMemberRowToEntity,
} from "../types";

export type { OrgRole, OrgMembership };

/**
 * Get a user's membership in a specific org.
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
 * Get all members of an org.
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

// Result types for operations that can fail

type RemoveResult =
  | { success: true }
  | {
      success: false;
      error: "user_not_member" | "is_owner" | "db_error";
      message: string;
    };

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
 * Remove a user from an org.
 * Fails if the user is the owner - they must transfer ownership first.
 */
export async function removeUserFromOrg(
  db: D1Database,
  userId: string,
  orgId: string
): Promise<RemoveResult> {
  const membership = await getOrgMembership(db, userId, orgId);

  if (!membership) {
    return {
      success: false,
      error: "user_not_member",
      message: "User is not a member of this organization.",
    };
  }

  if (membership.isOwner) {
    return {
      success: false,
      error: "is_owner",
      message: "Owner cannot leave. Transfer ownership first.",
    };
  }

  try {
    await db
      .prepare(`DELETE FROM org_members WHERE user_id = ? AND org_id = ?`)
      .bind(userId, orgId)
      .run();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: "db_error",
      message: `Database error: ${error}`,
    };
  }
}

/**
 * Transfer org ownership from one user to another.
 * The target must already be an admin of the org.
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

  // Verify target user is a member
  const target = await getOrgMembership(db, toUserId, orgId);
  if (!target) {
    return {
      success: false,
      error: "target_not_member",
      message: "Target user is not a member of this organization.",
    };
  }

  // Target must be an admin
  if (target.role !== "admin") {
    return {
      success: false,
      error: "target_not_admin",
      message: "Ownership can only be transferred to an admin.",
    };
  }

  // Perform the transfer atomically
  try {
    await db.batch([
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

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: "db_error",
      message: `Database error: ${error}`,
    };
  }
}
