/**
 * Storage Layer Tests
 *
 * Tests for D1 schema, R2 path helpers, and Vectorize operations.
 */

import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { R2Paths } from "../src/storage/r2-paths";
import { applyMigrations } from "./migrations";

// ============================================================================
// D1 Database Schema Tests
// ============================================================================

describe("D1 Storage Schema", () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it("creates all required tables", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();

    const tables = (results as { name: string }[]).map((r) => r.name);

    const expectedTables = [
      // Auth tables
      "user",
      "session",
      "account",
      "verification",
      // Org tables
      "org",
      "workspace_bindings",
      "channel_user_links",
      "invitations",
      "api_keys",
      // Subscription tables
      "org_members",
      "subscriptions",
      "tier_limits",
      "role_permissions",
      // Knowledge base tables
      "kb_chunks",
      "kb_formulas",
      "kb_benchmarks",
      "org_context_chunks",
    ];

    for (const table of expectedTables) {
      expect(tables).toContain(table);
    }
  });

  it("enforces role constraints on org_members", async () => {
    // Create test org and user
    await env.DB.prepare("INSERT OR IGNORE INTO org (id, name) VALUES (?, ?)")
      .bind("test-org-role", "Test Org")
      .run();

    await env.DB.prepare(
      "INSERT OR IGNORE INTO user (id, email, name, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(
        "test-user-role",
        "role-test@example.com",
        "Test User",
        0,
        Date.now(),
        Date.now()
      )
      .run();

    // Valid role should succeed
    await env.DB.prepare(
      "INSERT OR IGNORE INTO org_members (id, user_id, org_id, role) VALUES (?, ?, ?, ?)"
    )
      .bind("om-role-1", "test-user-role", "test-org-role", "admin")
      .run();

    const member = await env.DB.prepare(
      "SELECT role FROM org_members WHERE id = ?"
    )
      .bind("om-role-1")
      .first<{ role: string }>();

    expect(member?.role).toBe("admin");

    // Invalid role should fail
    await expect(
      env.DB.prepare(
        "INSERT INTO org_members (id, user_id, org_id, role) VALUES (?, ?, ?, ?)"
      )
        .bind("om-role-2", "test-user-role", "test-org-role", "superuser")
        .run()
    ).rejects.toThrow();
  });

  it("seeds tier limits with correct values", async () => {
    // Check all tiers exist
    const { results } = await env.DB.prepare(
      "SELECT tier FROM tier_limits ORDER BY tier"
    ).all();

    const tiers = (results as { tier: string }[]).map((t) => t.tier);
    expect(tiers).toEqual(["enterprise", "free", "professional", "starter"]);

    // Check free tier limits
    const freeTier = await env.DB.prepare(
      "SELECT * FROM tier_limits WHERE tier = ?"
    )
      .bind("free")
      .first<{
        max_users: number;
        max_queries_per_day: number;
        clio_write: number;
      }>();

    expect(freeTier).toMatchObject({
      max_users: 1,
      max_queries_per_day: 25,
      clio_write: 0,
    });

    // Check enterprise tier (unlimited)
    const enterpriseTier = await env.DB.prepare(
      "SELECT * FROM tier_limits WHERE tier = ?"
    )
      .bind("enterprise")
      .first<{ max_users: number; clio_write: number }>();

    expect(enterpriseTier).toMatchObject({
      max_users: -1,
      clio_write: 1,
    });
  });

  it("seeds role permissions with correct values", async () => {
    // Should have 24 permission entries (3 roles × 8 permissions)
    const count = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM role_permissions"
    ).first<{ count: number }>();

    expect(count?.count).toBe(24);

    // Helper to check permission
    async function checkPermission(
      role: string,
      permission: string
    ): Promise<number | undefined> {
      const result = await env.DB.prepare(
        "SELECT allowed FROM role_permissions WHERE role = ? AND permission = ?"
      )
        .bind(role, permission)
        .first<{ allowed: number }>();

      return result?.allowed;
    }

    // Owner and admin can delete from Clio
    expect(await checkPermission("owner", "clio_delete")).toBe(1);
    expect(await checkPermission("admin", "clio_delete")).toBe(1);

    // Member cannot delete but can read
    expect(await checkPermission("member", "clio_delete")).toBe(0);
    expect(await checkPermission("member", "clio_read")).toBe(1);
  });
});

// ============================================================================
// R2 Path Helper Tests
// ============================================================================

describe("R2 Path Helpers", () => {
  it("generates correct org document paths", () => {
    const path = R2Paths.orgDoc("acme-law", "doc-123");
    expect(path).toBe("orgs/acme-law/docs/doc-123");
  });

  it("generates correct audit log prefixes with zero-padding", () => {
    // Month only
    expect(R2Paths.auditLogPrefix("acme-law", 2025, 1)).toBe(
      "orgs/acme-law/audit/2025/01/"
    );

    // With day
    expect(R2Paths.auditLogPrefix("acme-law", 2025, 12, 5)).toBe(
      "orgs/acme-law/audit/2025/12/05/"
    );
  });

  it("generates correct archived conversation paths", () => {
    const path = R2Paths.archivedConversation("acme-law", "conv-456");
    expect(path).toBe("orgs/acme-law/conversations/conv-456.json");
  });
});

// ============================================================================
// R2 Storage Operations Tests
// ============================================================================

describe("R2 Storage Operations", () => {
  it("stores and retrieves documents", async () => {
    const path = R2Paths.orgDoc("test-org-r2", crypto.randomUUID());
    const content = "test document content";

    await env.R2.put(path, content, {
      httpMetadata: { contentType: "text/plain" },
    });

    const retrieved = await env.R2.get(path);
    expect(await retrieved!.text()).toBe(content);
  });

  it("isolates documents between organizations", async () => {
    // Store documents for two different orgs
    await env.R2.put("orgs/org-a-iso/docs/file1", "org a content");
    await env.R2.put("orgs/org-b-iso/docs/file1", "org b content");

    // List files for org A only
    const orgAFiles = await env.R2.list({ prefix: "orgs/org-a-iso/" });
    const keys = orgAFiles.objects.map((o) => o.key);

    expect(keys).toContain("orgs/org-a-iso/docs/file1");
    expect(keys).not.toContain("orgs/org-b-iso/docs/file1");
  });
});

// ============================================================================
// TenantDO Audit Log Tests
// Skipped: vitest-pool-workers has isolated storage issues with DOs that
// access both ctx.storage and R2. See:
// https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage
// ============================================================================

describe.skip("TenantDO Audit Log", () => {
  it("appends audit entries via DO endpoint", async () => {
    const orgId = `audit-test-${Date.now()}`;
    const id = env.TENANT.idFromName(orgId);
    const stub = env.TENANT.get(id);

    const entry = {
      user_id: "user-123",
      action: "clio_create",
      object_type: "matter",
      params: { name: "Test Matter" },
      result: "success" as const,
    };

    const response = await stub.fetch("http://do/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });

    const result = (await response.json()) as { id: string };
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
  });

  it("stores each entry as separate R2 object", async () => {
    const orgId = `separate-test-${Date.now()}`;
    const id = env.TENANT.idFromName(orgId);
    const stub = env.TENANT.get(id);

    // Append two entries
    await stub.fetch("http://do/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "user-1",
        action: "test",
        object_type: "test",
        params: {},
        result: "success",
      }),
    });

    await stub.fetch("http://do/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "user-2",
        action: "test",
        object_type: "test",
        params: {},
        result: "success",
      }),
    });

    // List audit entries from R2
    const now = new Date();
    const prefix = R2Paths.auditLogPrefix(
      id.toString(),
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate()
    );

    const list = await env.R2.list({ prefix });
    expect(list.objects.length).toBe(2);
  });
});

// ============================================================================
// Vectorize Tests (Skipped - requires live Workers AI)
// ============================================================================

describe.skip("Vectorize Metadata Filtering", () => {
  it("generates embeddings and stores with metadata", async () => {
    const { data } = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: "test document",
    })) as { data: number[][] };

    expect(data[0].length).toBe(768);

    const testId = `vec-test-${Date.now()}`;
    await env.VECTORIZE.upsert([
      {
        id: testId,
        values: data[0],
        metadata: { type: "test", source: "integration-test" },
      },
    ]);

    const results = await env.VECTORIZE.query(data[0], {
      topK: 1,
      returnMetadata: "all",
    });

    expect(results.matches.length).toBeGreaterThan(0);
  });

  it("filters org context by org_id", async () => {
    const { data } = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: "firm billing",
    })) as { data: number[][] };

    const timestamp = Date.now();

    // Store vectors for two orgs
    await env.VECTORIZE.upsert([
      {
        id: `org_acme_${timestamp}`,
        values: data[0],
        metadata: { type: "org_context", org_id: "acme" },
      },
      {
        id: `org_beta_${timestamp}`,
        values: data[0],
        metadata: { type: "org_context", org_id: "beta" },
      },
    ]);

    // Query with org filter
    const results = await env.VECTORIZE.query(data[0], {
      topK: 10,
      filter: { org_id: "acme" },
      returnMetadata: "all",
    });

    const orgIds = results.matches.map((m) => m.metadata?.org_id);
    expect(orgIds).toContain("acme");
    expect(orgIds).not.toContain("beta");
  });

  it("retrieves KB content without org filter", async () => {
    const { data } = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: "clio workflow",
    })) as { data: number[][] };

    await env.VECTORIZE.upsert([
      {
        id: `kb_shared_${Date.now()}`,
        values: data[0],
        metadata: { type: "kb", source: "clio-workflows.md" },
      },
    ]);

    // Query KB content (shared across all orgs)
    const results = await env.VECTORIZE.query(data[0], {
      topK: 5,
      filter: { type: "kb" },
      returnMetadata: "all",
    });

    const types = results.matches.map((m) => m.metadata?.type);
    expect(types).toContain("kb");
  });
});
