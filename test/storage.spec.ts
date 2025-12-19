import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { R2Paths } from "../src/storage/r2-paths";
import { applyMigrations } from "./migrations";

describe("D1 Storage Schema", () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });
  it("has all required tables", async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();

    const tables = result.results.map((r: { name: string }) => r.name);

    // Auth tables
    expect(tables).toContain("user");
    expect(tables).toContain("session");
    expect(tables).toContain("account");
    expect(tables).toContain("verification");

    // Org tables
    expect(tables).toContain("org");
    expect(tables).toContain("workspace_bindings");
    expect(tables).toContain("channel_user_links");
    expect(tables).toContain("invitations");
    expect(tables).toContain("api_keys");

    // Subscription tables
    expect(tables).toContain("org_members");
    expect(tables).toContain("subscriptions");
    expect(tables).toContain("tier_limits");
    expect(tables).toContain("role_permissions");

    // KB tables
    expect(tables).toContain("kb_chunks");
    expect(tables).toContain("kb_formulas");
    expect(tables).toContain("kb_benchmarks");
    expect(tables).toContain("org_context_chunks");
  });

  it("enforces role constraints on org_members", async () => {
    // Insert test org
    await env.DB.prepare(
      "INSERT OR IGNORE INTO org (id, name) VALUES (?, ?)"
    )
      .bind("test-org-role", "Test Org")
      .run();

    // Insert test user
    await env.DB.prepare(
      "INSERT OR IGNORE INTO user (id, email, name, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind("test-user-role", "role-test@example.com", "Test User", 0, Date.now(), Date.now())
      .run();

    // Valid role should work
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

    // Invalid role should fail (CHECK constraint)
    await expect(
      env.DB.prepare(
        "INSERT INTO org_members (id, user_id, org_id, role) VALUES (?, ?, ?, ?)"
      )
        .bind("om-role-2", "test-user-role", "test-org-role", "superuser")
        .run()
    ).rejects.toThrow();
  });

  it("has seeded tier limits", async () => {
    const tiers = await env.DB.prepare(
      "SELECT tier FROM tier_limits ORDER BY tier"
    ).all();

    expect(tiers.results).toHaveLength(4);
    expect(tiers.results.map((t: { tier: string }) => t.tier)).toEqual([
      "enterprise",
      "free",
      "professional",
      "starter",
    ]);
  });

  it("has correct tier limit values", async () => {
    const free = await env.DB.prepare(
      "SELECT * FROM tier_limits WHERE tier = ?"
    )
      .bind("free")
      .first<{
        tier: string;
        max_users: number;
        max_queries_per_day: number;
        clio_write: number;
      }>();

    expect(free?.max_users).toBe(1);
    expect(free?.max_queries_per_day).toBe(25);
    expect(free?.clio_write).toBe(0);

    const enterprise = await env.DB.prepare(
      "SELECT * FROM tier_limits WHERE tier = ?"
    )
      .bind("enterprise")
      .first<{ max_users: number; clio_write: number }>();

    expect(enterprise?.max_users).toBe(-1); // unlimited
    expect(enterprise?.clio_write).toBe(1);
  });

  it("has seeded role permissions", async () => {
    const perms = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM role_permissions"
    ).first<{ count: number }>();

    // 3 roles × 8 permissions = 24
    expect(perms?.count).toBe(24);
  });

  it("has correct permission values by role", async () => {
    // Owner can delete
    const ownerDelete = await env.DB.prepare(
      "SELECT allowed FROM role_permissions WHERE role = ? AND permission = ?"
    )
      .bind("owner", "clio_delete")
      .first<{ allowed: number }>();
    expect(ownerDelete?.allowed).toBe(1);

    // Admin can delete
    const adminDelete = await env.DB.prepare(
      "SELECT allowed FROM role_permissions WHERE role = ? AND permission = ?"
    )
      .bind("admin", "clio_delete")
      .first<{ allowed: number }>();
    expect(adminDelete?.allowed).toBe(1);

    // Member cannot delete
    const memberDelete = await env.DB.prepare(
      "SELECT allowed FROM role_permissions WHERE role = ? AND permission = ?"
    )
      .bind("member", "clio_delete")
      .first<{ allowed: number }>();
    expect(memberDelete?.allowed).toBe(0);

    // Member can read
    const memberRead = await env.DB.prepare(
      "SELECT allowed FROM role_permissions WHERE role = ? AND permission = ?"
    )
      .bind("member", "clio_read")
      .first<{ allowed: number }>();
    expect(memberRead?.allowed).toBe(1);
  });
});

describe("R2 Path Helpers", () => {
  it("generates correct document paths", () => {
    const path = R2Paths.orgDoc("acme-law", "doc-123");
    expect(path).toBe("orgs/acme-law/docs/doc-123");
  });

  it("generates correct audit log paths with zero-padded months", () => {
    const jan = R2Paths.auditLog("acme-law", 2025, 1);
    expect(jan).toBe("orgs/acme-law/audit/2025/01.jsonl");

    const dec = R2Paths.auditLog("acme-law", 2025, 12);
    expect(dec).toBe("orgs/acme-law/audit/2025/12.jsonl");
  });

  it("generates correct archived conversation paths", () => {
    const path = R2Paths.archivedConversation("acme-law", "conv-456");
    expect(path).toBe("orgs/acme-law/conversations/conv-456.json");
  });
});

describe("R2 Storage Operations", () => {
  it("stores documents in correct paths", async () => {
    const orgId = "test-org-r2";
    const fileId = crypto.randomUUID();
    const path = R2Paths.orgDoc(orgId, fileId);

    await env.R2.put(path, "test document content", {
      httpMetadata: { contentType: "text/plain" },
    });

    const obj = await env.R2.get(path);
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe("test document content");
  });

  it("isolates orgs in separate paths", async () => {
    // Store doc for org A
    await env.R2.put("orgs/org-a-iso/docs/file1", "org a content");

    // Store doc for org B
    await env.R2.put("orgs/org-b-iso/docs/file1", "org b content");

    // List org A's docs - should not see org B
    const list = await env.R2.list({ prefix: "orgs/org-a-iso/" });
    const keys = list.objects.map((o) => o.key);

    expect(keys).toContain("orgs/org-a-iso/docs/file1");
    expect(keys).not.toContain("orgs/org-b-iso/docs/file1");
  });
});

// Integration tests - require remote access to Workers AI and Vectorize
// Run with: npm test -- --remote test/storage.spec.ts
// These tests will fail locally due to authentication requirements
describe.skip("Vectorize Metadata Filtering", () => {
  it("generates embeddings with correct dimensions", async () => {
    const { data } = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: "test document content",
    })) as { data: number[][] };

    expect(data[0].length).toBe(768);
  });

  it("stores and retrieves vectors with metadata", async () => {
    const { data } = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: "legal document about contracts",
    })) as { data: number[][] };

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
      text: "firm specific billing procedures",
    })) as { data: number[][] };

    const embedding = data[0];
    const timestamp = Date.now();

    // Insert org context for two different orgs
    await env.VECTORIZE.upsert([
      {
        id: `org_acme_${timestamp}`,
        values: embedding,
        metadata: { type: "org_context", org_id: "acme" },
      },
      {
        id: `org_beta_${timestamp}`,
        values: embedding,
        metadata: { type: "org_context", org_id: "beta" },
      },
    ]);

    // Query with org filter - should only get acme's context
    const results = await env.VECTORIZE.query(embedding, {
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
      text: "clio workflow procedures",
    })) as { data: number[][] };

    const embedding = data[0];
    const timestamp = Date.now();

    // Insert shared KB chunk (no org_id)
    await env.VECTORIZE.upsert([
      {
        id: `kb_shared_${timestamp}`,
        values: embedding,
        metadata: { type: "kb", source: "clio-workflows.md" },
      },
    ]);

    // Query for KB content
    const results = await env.VECTORIZE.query(embedding, {
      topK: 5,
      filter: { type: "kb" },
      returnMetadata: "all",
    });

    expect(results.matches.length).toBeGreaterThan(0);
    const types = results.matches.map((m) => m.metadata?.type);
    expect(types).toContain("kb");
  });
});
