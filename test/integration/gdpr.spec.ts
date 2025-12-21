import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  hashUserId,
  checkSoleOwnerships,
  deleteUserData,
  getDataDeletionPreview,
  type SoleOwnershipError,
} from "../../src/services/gdpr";

// Helper to generate unique test emails
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}@test.com`;
}

// Database helper functions

async function insertUser(
  id: string,
  email: string,
  name = "Test"
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  )
    .bind(id, name, email, now, now)
    .run();
}

async function insertOrg(id: string, name: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO org (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(id, name, now, now)
    .run();
}

async function insertOwner(orgId: string, userId: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO org_members (id, org_id, user_id, role, is_owner, created_at)
     VALUES (?, ?, ?, 'admin', 1, ?)`
  )
    .bind(crypto.randomUUID(), orgId, userId, now)
    .run();
}

describe("GDPR Deletion", () => {
  describe("hashUserId", () => {
    it("produces consistent 16-char hex hash", async () => {
      const hash1 = await hashUserId("user-123");
      const hash2 = await hashUserId("user-123");

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{16}$/);
    });

    it("produces different hashes for different users", async () => {
      const hash1 = await hashUserId("user-123");
      const hash2 = await hashUserId("user-456");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("checkSoleOwnerships", () => {
    it("returns empty when user owns no orgs", async () => {
      const userId = crypto.randomUUID();
      await insertUser(userId, uniqueEmail("no-orgs"));

      const result = await checkSoleOwnerships(env.DB, userId);

      expect(result).toEqual([]);
    });

    it("returns org ID when user is sole owner", async () => {
      const userId = crypto.randomUUID();
      const orgId = crypto.randomUUID();

      await insertUser(userId, uniqueEmail("sole"));
      await insertOrg(orgId, "Sole Org");
      await insertOwner(orgId, userId);

      const result = await checkSoleOwnerships(env.DB, userId);

      expect(result).toContain(orgId);
    });

    it("returns empty when multiple owners exist", async () => {
      const userId1 = crypto.randomUUID();
      const userId2 = crypto.randomUUID();
      const orgId = crypto.randomUUID();
      const now = Date.now();

      // Create two users
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`
        ).bind(userId1, "Owner 1", uniqueEmail("o1"), now, now),
        env.DB.prepare(
          `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`
        ).bind(userId2, "Owner 2", uniqueEmail("o2"), now, now),
      ]);

      // Create org with both as owners
      await insertOrg(orgId, "Multi-Owner Org");
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO org_members (id, org_id, user_id, role, is_owner, created_at)
           VALUES (?, ?, ?, 'admin', 1, ?)`
        ).bind(crypto.randomUUID(), orgId, userId1, now),
        env.DB.prepare(
          `INSERT INTO org_members (id, org_id, user_id, role, is_owner, created_at)
           VALUES (?, ?, ?, 'admin', 1, ?)`
        ).bind(crypto.randomUUID(), orgId, userId2, now),
      ]);

      const result = await checkSoleOwnerships(env.DB, userId1);

      expect(result).toEqual([]);
    });
  });

  describe("deleteUserData", () => {
    it("deletes user and related records", async () => {
      const userId = crypto.randomUUID();
      const now = Date.now();

      // Create user with related records
      await insertUser(userId, uniqueEmail("delete"), "Delete Me");

      await env.DB.prepare(
        `INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), userId, "tok", now + 86400000, now, now)
        .run();

      await env.DB.prepare(
        `INSERT INTO account (id, user_id, account_id, provider_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), userId, "acc", "credential", now, now)
        .run();

      await env.DB.prepare(
        `INSERT INTO channel_user_links (id, channel_type, channel_user_id, user_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), "teams", "29:test", userId, now)
        .run();

      // Delete the user
      const result = (await deleteUserData(env.DB, env.R2, userId)) as {
        success: boolean;
        deletedRecords: { user: boolean; sessions: number };
      };

      expect(result.success).toBe(true);
      expect(result.deletedRecords.user).toBe(true);
      expect(result.deletedRecords.sessions).toBe(1);

      // Verify user is gone
      const userCheck = await env.DB.prepare(`SELECT id FROM user WHERE id = ?`)
        .bind(userId)
        .first();

      expect(userCheck).toBeNull();
    });

    it("fails when user is sole owner", async () => {
      const userId = crypto.randomUUID();
      const orgId = crypto.randomUUID();

      await insertUser(userId, uniqueEmail("sole-del"));
      await insertOrg(orgId, "Sole Del Org");
      await insertOwner(orgId, userId);

      const result = (await deleteUserData(
        env.DB,
        env.R2,
        userId
      )) as SoleOwnershipError;

      expect(result.type).toBe("sole_owner");

      // Verify user still exists
      const userCheck = await env.DB.prepare(`SELECT id FROM user WHERE id = ?`)
        .bind(userId)
        .first();

      expect(userCheck).not.toBeNull();
    });

    it("returns error for non-existent user", async () => {
      const result = (await deleteUserData(
        env.DB,
        env.R2,
        crypto.randomUUID()
      )) as { success: boolean; errors: string[] };

      expect(result.success).toBe(false);
      expect(result.errors).toContain("User not found");
    });
  });

  describe("getDataDeletionPreview", () => {
    it("returns count of records", async () => {
      const userId = crypto.randomUUID();
      const email = uniqueEmail("preview");
      const now = Date.now();

      await insertUser(userId, email, "Preview");

      // Add two sessions
      await env.DB.prepare(
        `INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), userId, "t1", now + 86400000, now, now)
        .run();

      await env.DB.prepare(
        `INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), userId, "t2", now + 86400000, now, now)
        .run();

      const preview = await getDataDeletionPreview(env.DB, userId);

      expect(preview.user?.email).toBe(email);
      expect(preview.sessions).toBe(2);
    });

    it("returns null user for non-existent", async () => {
      const preview = await getDataDeletionPreview(env.DB, crypto.randomUUID());

      expect(preview.user).toBeNull();
    });

    it("includes sole owner orgs in preview", async () => {
      const userId = crypto.randomUUID();
      const orgId = crypto.randomUUID();

      await insertUser(userId, uniqueEmail("prev-sole"));
      await insertOrg(orgId, "Preview Org");
      await insertOwner(orgId, userId);

      const preview = await getDataDeletionPreview(env.DB, userId);

      expect(preview.soleOwnerOrgs).toContain(orgId);
    });
  });
});
