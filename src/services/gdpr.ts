/**
 * GDPR Data Deletion Service
 *
 * Handles the "right to be forgotten" - complete deletion of a user's data
 * across all storage locations (D1, DOs, R2 audit logs).
 */

// =============================================================================
// Types
// =============================================================================

/** Result of purging user data from a single Durable Object */
export interface DOPurgeResult {
  orgId: string;
  messages: number;
  pendingConfirmations: number;
  clioToken: boolean;
}

/** Complete result of a GDPR deletion request */
export interface GdprDeleteResult {
  success: boolean;
  deletedRecords: {
    user: boolean;
    sessions: number;
    accounts: number;
    channelLinks: number;
    orgMemberships: number;
  };
  purgedFromDOs: DOPurgeResult[];
  anonymizedAuditLogs: number;
  errors: string[];
}

/** Error returned when user is sole owner of organization(s) */
export interface SoleOwnershipError {
  type: "sole_owner";
  orgIds: string[];
  message: string;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Creates a truncated hash of a user ID for audit log anonymization.
 * We keep a hash rather than deleting entirely so we can still correlate
 * actions by "the same deleted user" without knowing who they were.
 */
export async function hashUserId(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert to hex string and take first 16 chars
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const fullHash = hashArray
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return fullHash.substring(0, 16);
}

// =============================================================================
// Pre-Deletion Checks
// =============================================================================

/**
 * Checks if a user is the sole owner of any organizations.
 * Users cannot delete their account if they're the only owner - they must
 * transfer ownership first or delete the organization.
 */
export async function checkSoleOwnerships(
  db: D1Database,
  userId: string
): Promise<string[]> {
  // Find all orgs where this user is an owner
  const ownerships = await db
    .prepare(
      `SELECT org_id FROM org_members WHERE user_id = ? AND is_owner = 1`
    )
    .bind(userId)
    .all<{ org_id: string }>();

  const soleOwnerOrgs: string[] = [];

  // For each owned org, check if there are other owners
  for (const { org_id: orgId } of ownerships.results) {
    const otherOwners = await db
      .prepare(
        `SELECT COUNT(*) as count FROM org_members
         WHERE org_id = ? AND is_owner = 1 AND user_id != ?`
      )
      .bind(orgId, userId)
      .first<{ count: number }>();

    if (otherOwners?.count === 0) {
      soleOwnerOrgs.push(orgId);
    }
  }

  return soleOwnerOrgs;
}

// =============================================================================
// Audit Log Anonymization
// =============================================================================

/**
 * Anonymizes audit logs in R2 by replacing the user_id with a hash.
 * This preserves audit trail integrity while removing PII.
 */
export async function anonymizeAuditLogs(
  r2: R2Bucket,
  userId: string
): Promise<number> {
  const hashedId = `REDACTED-${await hashUserId(userId)}`;
  let anonymizedCount = 0;
  let cursor: string | undefined;

  // Paginate through all audit logs
  do {
    const listResult = await r2.list({
      prefix: "orgs/",
      cursor,
      limit: 100,
    });

    for (const obj of listResult.objects) {
      // Only process audit log files
      if (!obj.key.includes("/audit/")) {
        continue;
      }

      const content = await r2.get(obj.key);
      if (!content) {
        continue;
      }

      try {
        const entry = (await content.json()) as { user_id?: string };

        // Only update if this user's audit entry
        if (entry.user_id === userId) {
          entry.user_id = hashedId;

          await r2.put(obj.key, JSON.stringify(entry), {
            httpMetadata: { contentType: "application/json" },
          });

          anonymizedCount++;
        }
      } catch {
        // Skip malformed entries
      }
    }

    cursor = listResult.truncated ? listResult.cursor : undefined;
  } while (cursor);

  return anonymizedCount;
}

// =============================================================================
// D1 Record Deletion
// =============================================================================

/**
 * Deletes all user records from D1 database.
 * Relies on CASCADE deletes for related records (sessions, accounts, etc).
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
  // Count records before deletion for reporting
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

  // Delete the user - CASCADE handles related records
  await db.prepare(`DELETE FROM user WHERE id = ?`).bind(userId).run();

  return {
    sessions: sessions?.count ?? 0,
    accounts: accounts?.count ?? 0,
    channelLinks: channelLinks?.count ?? 0,
    orgMemberships: orgMemberships?.count ?? 0,
  };
}

// =============================================================================
// Main Deletion Function
// =============================================================================

/**
 * Deletes all data associated with a user (GDPR "right to be forgotten").
 *
 * Process:
 * 1. Check for sole ownership (must transfer first)
 * 2. Purge user data from each org's Durable Object
 * 3. Delete user record from D1 (cascades to sessions, accounts, etc)
 * 4. Anonymize audit logs in R2
 */
export async function deleteUserData(
  db: D1Database,
  r2: R2Bucket,
  userId: string,
  tenant?: DurableObjectNamespace
): Promise<GdprDeleteResult | SoleOwnershipError> {
  // Step 1: Check for sole ownership
  const soleOwnerOrgs = await checkSoleOwnerships(db, userId);

  if (soleOwnerOrgs.length > 0) {
    return {
      type: "sole_owner",
      orgIds: soleOwnerOrgs,
      message: `User is sole owner of ${soleOwnerOrgs.length} organization(s). Transfer ownership first.`,
    };
  }

  // Step 2: Verify user exists
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
      purgedFromDOs: [],
      anonymizedAuditLogs: 0,
      errors: ["User not found"],
    };
  }

  const errors: string[] = [];

  // Step 3: Get all orgs the user belongs to
  const orgMemberships = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ?`)
    .bind(userId)
    .all<{ org_id: string }>();

  const orgIds = orgMemberships.results.map((row) => row.org_id);

  // Step 4: Purge user data from each org's Durable Object
  const purgedFromDOs: DOPurgeResult[] = [];

  if (tenant && orgIds.length > 0) {
    for (const orgId of orgIds) {
      try {
        const doStub = tenant.get(tenant.idFromName(orgId));
        const response = await doStub.fetch(
          new Request("https://do/purge-user-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          })
        );

        if (response.ok) {
          const result = (await response.json()) as {
            purged: {
              messages: number;
              pendingConfirmations: number;
              clioToken: boolean;
            };
          };

          purgedFromDOs.push({
            orgId,
            messages: result.purged.messages,
            pendingConfirmations: result.purged.pendingConfirmations,
            clioToken: result.purged.clioToken,
          });
        } else {
          errors.push(`DO purge failed for org ${orgId}: ${response.status}`);
        }
      } catch (error) {
        errors.push(`DO purge failed for org ${orgId}: ${error}`);
      }
    }
  }

  // Step 5: Delete user from D1
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
      purgedFromDOs,
      anonymizedAuditLogs: 0,
      errors: [`D1 deletion failed: ${error}`],
    };
  }

  // Step 6: Anonymize audit logs
  let anonymizedCount = 0;
  try {
    anonymizedCount = await anonymizeAuditLogs(r2, userId);
  } catch (error) {
    errors.push(`Audit log anonymization failed: ${error}`);
  }

  // Return result
  return {
    success: errors.length === 0,
    deletedRecords: {
      user: true,
      ...deletedRecords,
    },
    purgedFromDOs,
    anonymizedAuditLogs: anonymizedCount,
    errors,
  };
}

// =============================================================================
// Preview Function
// =============================================================================

/**
 * Returns a preview of what data would be deleted for a user.
 * Useful for confirmation dialogs before actual deletion.
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

  // Check sole ownerships separately
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
