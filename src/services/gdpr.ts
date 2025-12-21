/**
 * GDPR data deletion service.
 *
 * Handles user data deletion requests including:
 * - Checking for sole ownership blocking conditions
 * - Deleting user records from D1 (cascades via foreign keys)
 * - Anonymizing audit logs in R2
 */

export interface GdprDeleteResult {
  success: boolean;
  deletedRecords: {
    user: boolean;
    sessions: number;
    accounts: number;
    channelLinks: number;
    orgMemberships: number;
  };
  anonymizedAuditLogs: number;
  errors: string[];
}

export interface SoleOwnershipError {
  type: "sole_owner";
  orgIds: string[];
  message: string;
}

/**
 * Generate a consistent, truncated hash for anonymizing user IDs in audit logs.
 * Uses SHA-256 and returns first 16 hex characters.
 */
export async function hashUserId(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert to hex string and truncate to 16 chars
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex.substring(0, 16);
}

/**
 * Find all organizations where the user is the sole owner.
 * These orgs would be orphaned if the user is deleted.
 */
export async function checkSoleOwnerships(
  db: D1Database,
  userId: string
): Promise<string[]> {
  // Get all orgs where this user is an owner
  const ownershipsQuery = `
    SELECT org_id FROM org_members
    WHERE user_id = ? AND is_owner = 1
  `;
  const ownerships = await db
    .prepare(ownershipsQuery)
    .bind(userId)
    .all<{ org_id: string }>();

  const soleOwnerOrgs: string[] = [];

  // For each owned org, check if there are other owners
  for (const { org_id: orgId } of ownerships.results) {
    const otherOwnersQuery = `
      SELECT COUNT(*) as count FROM org_members
      WHERE org_id = ? AND is_owner = 1 AND user_id != ?
    `;
    const otherOwners = await db
      .prepare(otherOwnersQuery)
      .bind(orgId, userId)
      .first<{ count: number }>();

    if (otherOwners?.count === 0) {
      soleOwnerOrgs.push(orgId);
    }
  }

  return soleOwnerOrgs;
}

/**
 * Replace user IDs with anonymized hashes in R2 audit logs.
 * Processes all audit log files and rewrites those containing the user's ID.
 */
export async function anonymizeAuditLogs(
  r2: R2Bucket,
  userId: string
): Promise<number> {
  const hashedId = `REDACTED-${await hashUserId(userId)}`;
  let count = 0;
  let cursor: string | undefined;

  // Paginate through all audit log files
  do {
    const listResult = await r2.list({
      prefix: "orgs/",
      cursor,
      limit: 100,
    });

    for (const obj of listResult.objects) {
      // Skip non-audit files
      if (!obj.key.includes("/audit/")) {
        continue;
      }

      const content = await r2.get(obj.key);
      if (!content) {
        continue;
      }

      try {
        const entry = (await content.json()) as { user_id?: string };

        // Only rewrite files that contain this user's ID
        if (entry.user_id === userId) {
          entry.user_id = hashedId;
          await r2.put(obj.key, JSON.stringify(entry), {
            httpMetadata: { contentType: "application/json" },
          });
          count++;
        }
      } catch {
        // Skip malformed JSON files
      }
    }

    cursor = listResult.truncated ? listResult.cursor : undefined;
  } while (cursor);

  return count;
}

/**
 * Delete all user records from D1.
 * Returns counts of deleted related records (for reporting).
 * Note: Actual deletion cascades via foreign keys, but we count first for the report.
 */
async function deleteUserFromD1(
  db: D1Database,
  userId: string
): Promise<{
  sessions: number;
  accounts: number;
  channelLinks: number;
  orgMemberships: number;
}> {
  // Count related records before deletion (for reporting)
  const [sessions, accounts, channelLinks, orgMemberships] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) as count FROM session WHERE user_id = ?`)
      .bind(userId)
      .first<{ count: number }>(),
    db
      .prepare(`SELECT COUNT(*) as count FROM account WHERE user_id = ?`)
      .bind(userId)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as count FROM channel_user_links WHERE user_id = ?`
      )
      .bind(userId)
      .first<{ count: number }>(),
    db
      .prepare(`SELECT COUNT(*) as count FROM org_members WHERE user_id = ?`)
      .bind(userId)
      .first<{ count: number }>(),
  ]);

  // Delete the user - related records cascade via foreign keys
  await db.prepare(`DELETE FROM user WHERE id = ?`).bind(userId).run();

  return {
    sessions: sessions?.count ?? 0,
    accounts: accounts?.count ?? 0,
    channelLinks: channelLinks?.count ?? 0,
    orgMemberships: orgMemberships?.count ?? 0,
  };
}

/**
 * Main GDPR deletion entry point.
 *
 * 1. Checks for sole ownership (blocks deletion if found)
 * 2. Deletes user and related records from D1
 * 3. Anonymizes audit logs in R2
 */
export async function deleteUserData(
  db: D1Database,
  r2: R2Bucket,
  userId: string
): Promise<GdprDeleteResult | SoleOwnershipError> {
  // Block deletion if user is sole owner of any org
  const soleOwnerOrgs = await checkSoleOwnerships(db, userId);
  if (soleOwnerOrgs.length > 0) {
    return {
      type: "sole_owner",
      orgIds: soleOwnerOrgs,
      message: `User is sole owner of ${soleOwnerOrgs.length} organization(s). Transfer ownership first.`,
    };
  }

  // Verify user exists
  const user = await db
    .prepare(`SELECT id FROM user WHERE id = ?`)
    .bind(userId)
    .first<{ id: string }>();

  if (!user) {
    return {
      success: false,
      deletedRecords: {
        user: false,
        sessions: 0,
        accounts: 0,
        channelLinks: 0,
        orgMemberships: 0,
      },
      anonymizedAuditLogs: 0,
      errors: ["User not found"],
    };
  }

  // Delete from D1
  const errors: string[] = [];
  let deletedRecords;

  try {
    deletedRecords = await deleteUserFromD1(db, userId);
  } catch (error) {
    return {
      success: false,
      deletedRecords: {
        user: false,
        sessions: 0,
        accounts: 0,
        channelLinks: 0,
        orgMemberships: 0,
      },
      anonymizedAuditLogs: 0,
      errors: [`D1 deletion failed: ${error}`],
    };
  }

  // Anonymize audit logs (non-blocking failure)
  let anonymizedCount = 0;
  try {
    anonymizedCount = await anonymizeAuditLogs(r2, userId);
  } catch (error) {
    errors.push(`Audit log anonymization failed: ${error}`);
  }

  return {
    success: errors.length === 0,
    deletedRecords: {
      user: true,
      ...deletedRecords,
    },
    anonymizedAuditLogs: anonymizedCount,
    errors,
  };
}

/**
 * Preview what would be deleted without actually deleting.
 * Used to show the user what data exists before they confirm deletion.
 */
export async function getDataDeletionPreview(
  db: D1Database,
  userId: string
): Promise<{
  user: { email: string; name: string } | null;
  sessions: number;
  accounts: number;
  channelLinks: number;
  orgMemberships: number;
  soleOwnerOrgs: string[];
}> {
  // Fetch all counts in parallel
  const [user, sessions, accounts, channelLinks, orgMemberships] =
    await Promise.all([
      db
        .prepare(`SELECT email, name FROM user WHERE id = ?`)
        .bind(userId)
        .first<{ email: string; name: string }>(),
      db
        .prepare(`SELECT COUNT(*) as count FROM session WHERE user_id = ?`)
        .bind(userId)
        .first<{ count: number }>(),
      db
        .prepare(`SELECT COUNT(*) as count FROM account WHERE user_id = ?`)
        .bind(userId)
        .first<{ count: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) as count FROM channel_user_links WHERE user_id = ?`
        )
        .bind(userId)
        .first<{ count: number }>(),
      db
        .prepare(`SELECT COUNT(*) as count FROM org_members WHERE user_id = ?`)
        .bind(userId)
        .first<{ count: number }>(),
    ]);

  // Check for blocking conditions
  const soleOwnerOrgs = await checkSoleOwnerships(db, userId);

  return {
    user: user ?? null,
    sessions: sessions?.count ?? 0,
    accounts: accounts?.count ?? 0,
    channelLinks: channelLinks?.count ?? 0,
    orgMemberships: orgMemberships?.count ?? 0,
    soleOwnerOrgs,
  };
}
