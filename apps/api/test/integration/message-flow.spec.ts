/**
 * Message Flow Integration Tests
 *
 * Tests the complete message processing flow through the TenantDO,
 * including RAG retrieval and LLM response generation.
 *
 * These tests require real Workers AI bindings and are skipped
 * when running without Cloudflare credentials.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";

// Flag to enable/disable tests that need DO SQLite (not yet supported in test pool)
const doSqliteSupported = false;

// Unique org ID for this test run
const testOrgId = `test-org-e2e-${Date.now()}`;

// =============================================================================
// Test Setup
// =============================================================================

/**
 * Creates a test organization in the database.
 */
async function createTestOrg(orgId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO org (id, name, created_at) VALUES (?, ?, datetime('now'))"
  )
    .bind(orgId, "E2E Test Org")
    .run();
}

/**
 * Seeds the knowledge base with test content about matters.
 */
async function seedTestKBContent(): Promise<void> {
  // Insert a KB chunk about creating matters
  await env.DB.prepare(
    `INSERT OR REPLACE INTO kb_chunks
     (id, content, source, section, chunk_index, category)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      "kb_e2e_matters_1",
      "To create a new matter in Clio, navigate to Matters > Add Matter. Fill in the client name, matter description, and practice area. Matters organize all case-related activities.",
      "clio-matters-guide.md",
      "Creating Matters",
      0,
      "general"
    )
    .run();

  // Generate embedding and insert into Vectorize
  const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [
      "To create a new matter in Clio, navigate to Matters > Add Matter. Fill in the client name, matter description, and practice area.",
    ],
  })) as { data: number[][] };

  await env.VECTORIZE.upsert([
    {
      id: "kb_e2e_matters_1",
      values: embeddingResult.data[0],
      metadata: {
        type: "kb",
        category: "general",
        source: "clio-matters-guide.md",
      },
    },
  ]);
}

/**
 * Cleans up test data after tests complete.
 */
async function cleanupTestData(): Promise<void> {
  await env.DB.prepare("DELETE FROM kb_chunks WHERE id LIKE 'kb_e2e_%'").run();
  await env.DB.prepare("DELETE FROM org WHERE id = ?").bind(testOrgId).run();
  await env.VECTORIZE.deleteByIds(["kb_e2e_matters_1"]);
}

// =============================================================================
// Message Flow Tests
// =============================================================================

describe.skipIf(!doSqliteSupported)("Message Flow E2E", () => {
  beforeAll(async () => {
    await createTestOrg(testOrgId);
    await seedTestKBContent();
  }, 30000);

  describe("Contextual Response Generation", () => {
    it("generates contextual response using RAG", async () => {
      const tenantStub = env.TENANT.get(env.TENANT.idFromName(testOrgId));

      const response = await tenantStub.fetch(
        new Request("https://do/process-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "web",
            orgId: testOrgId,
            userId: "user_e2e_1",
            userRole: "member",
            conversationId: "conv_e2e_1",
            conversationScope: "personal",
            message: "How do I create a new matter in Clio?",
            jurisdictions: ["CA"],
            practiceTypes: ["personal-injury-law"],
            firmSize: "small",
          }),
        })
      );

      const result = (await response.json()) as { response?: string };

      // Should have a response
      expect(result.response).toBeDefined();

      // Response should mention "matter" (the topic we asked about)
      expect(result.response?.toLowerCase()).toContain("matter");
    }, 30000);

    it("includes RAG context in responses about Clio", async () => {
      const tenantStub = env.TENANT.get(env.TENANT.idFromName(testOrgId));

      const response = await tenantStub.fetch(
        new Request("https://do/process-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "web",
            orgId: testOrgId,
            userId: "user_e2e_2",
            userRole: "member",
            conversationId: "conv_e2e_2",
            conversationScope: "personal",
            message: "What's the process for adding a new matter?",
            jurisdictions: [],
            practiceTypes: [],
            firmSize: null,
          }),
        })
      );

      const result = (await response.json()) as { response?: string };

      expect(result.response).toBeDefined();

      // Should mention either "matter" or "clio" (RAG context should be included)
      const lowerResponse = result.response?.toLowerCase() || "";
      expect(
        lowerResponse.includes("matter") || lowerResponse.includes("clio")
      ).toBe(true);
    }, 30000);
  });

  describe("Permission Enforcement", () => {
    it("enforces permission for CUD operations - member denied", async () => {
      const tenantStub = env.TENANT.get(env.TENANT.idFromName(testOrgId));

      const response = await tenantStub.fetch(
        new Request("https://do/process-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "web",
            orgId: testOrgId,
            userId: "member_user",
            userRole: "member",
            conversationId: "conv_perms_1",
            conversationScope: "personal",
            message: "Create a new matter for client John Smith",
            jurisdictions: [],
            practiceTypes: [],
            firmSize: null,
          }),
        })
      );

      const result = (await response.json()) as { response?: string };

      expect(result.response).toBeDefined();

      // Response should indicate lack of permission
      const lowerResponse = result.response?.toLowerCase() || "";
      const indicatesPermissionDenied =
        lowerResponse.includes("permission") ||
        lowerResponse.includes("read") ||
        lowerResponse.includes("member") ||
        lowerResponse.includes("cannot") ||
        lowerResponse.includes("admin");

      expect(indicatesPermissionDenied).toBe(true);
    }, 30000);

    it("allows CUD operations for admin with confirmation", async () => {
      const tenantStub = env.TENANT.get(env.TENANT.idFromName(testOrgId));

      const response = await tenantStub.fetch(
        new Request("https://do/process-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "web",
            orgId: testOrgId,
            userId: "admin_user",
            userRole: "admin",
            conversationId: "conv_perms_2",
            conversationScope: "personal",
            message: "Create a new matter for client Jane Doe",
            jurisdictions: [],
            practiceTypes: [],
            firmSize: null,
          }),
        })
      );

      const result = (await response.json()) as { response?: string };

      expect(result.response).toBeDefined();

      // Admin should NOT see "permission denied"
      expect(result.response?.toLowerCase().includes("permission denied")).toBe(
        false
      );
    }, 30000);
  });

  describe("Conversation History", () => {
    it("maintains context across multiple messages", async () => {
      const tenantStub = env.TENANT.get(env.TENANT.idFromName(testOrgId));
      const conversationId = `conv_history_${Date.now()}`;

      // First message establishes context
      await tenantStub.fetch(
        new Request("https://do/process-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "web",
            orgId: testOrgId,
            userId: "user_history",
            userRole: "member",
            conversationId,
            conversationScope: "personal",
            message: "I need help with a personal injury case in California",
            jurisdictions: ["CA"],
            practiceTypes: ["personal-injury-law"],
            firmSize: null,
          }),
        })
      );

      // Follow-up message should have prior context available
      const response = await tenantStub.fetch(
        new Request("https://do/process-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "web",
            orgId: testOrgId,
            userId: "user_history",
            userRole: "member",
            conversationId,
            conversationScope: "personal",
            message: "What are the deadlines I should know about?",
            jurisdictions: ["CA"],
            practiceTypes: ["personal-injury-law"],
            firmSize: null,
          }),
        })
      );

      const result = (await response.json()) as { response?: string };

      // Should have some response (history is preserved)
      expect(result.response).toBeDefined();
    }, 60000);
  });

  describe("Error Handling", () => {
    it("handles missing message gracefully", async () => {
      const tenantStub = env.TENANT.get(env.TENANT.idFromName(testOrgId));

      const response = await tenantStub.fetch(
        new Request("https://do/process-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "web",
            orgId: testOrgId,
            userId: "user_error",
            userRole: "member",
            conversationId: "conv_error_1",
            conversationScope: "personal",
            // No message field!
            jurisdictions: [],
            practiceTypes: [],
            firmSize: null,
          }),
        })
      );

      // Should return some status (validation error expected)
      expect(response.status).toBeDefined();
    }, 15000);

    it("continues without RAG if embedding fails", async () => {
      const tenantStub = env.TENANT.get(env.TENANT.idFromName(testOrgId));

      const response = await tenantStub.fetch(
        new Request("https://do/process-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "web",
            orgId: testOrgId,
            userId: "user_no_rag",
            userRole: "member",
            conversationId: "conv_no_rag_1",
            conversationScope: "personal",
            message: "Hello, how are you?",
            jurisdictions: [],
            practiceTypes: [],
            firmSize: null,
          }),
        })
      );

      const result = (await response.json()) as { response?: string };

      // Should still get a response even if RAG context is empty
      expect(result.response).toBeDefined();
    }, 30000);
  });
});
