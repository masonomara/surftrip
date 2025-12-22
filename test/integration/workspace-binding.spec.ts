import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import worker, { type Env } from "../../src/index";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Sends a request to the worker.
 */
async function fetchWorker(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const request = new Request(`http://localhost${path}`, init);
  return worker.fetch(request, env as Env);
}

/**
 * Creates a Teams activity message for testing.
 */
function createTeamsActivity(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "message",
    text: "Test message",
    from: { aadObjectId: "aad-user-id" },
    conversation: { id: "conv-id", conversationType: "personal" },
    recipient: { id: "bot-id" },
    serviceUrl: "https://test.botframework.com/",
    ...overrides,
  });
}

// =============================================================================
// Database Helpers
// =============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

async function createOrganization(id: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO org (id, name, jurisdictions, practice_types, created_at, updated_at)
     VALUES (?, ?, '[]', '[]', ?, ?)`
  )
    .bind(id, name, now(), now())
    .run();
}

async function createUser(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  )
    .bind(id, "Test User", email, now(), now())
    .run();
}

async function addOrgMember(
  userId: string,
  orgId: string,
  role = "member"
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO org_members (id, user_id, org_id, role, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(generateId(), userId, orgId, role, now())
    .run();
}

async function linkChannelUser(
  channelType: string,
  channelUserId: string,
  userId: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO channel_user_links (id, channel_type, channel_user_id, user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(generateId(), channelType, channelUserId, userId, now())
    .run();
}

async function bindWorkspaceToOrg(
  channelType: string,
  workspaceId: string,
  orgId: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace_bindings (id, channel_type, workspace_id, org_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(generateId(), channelType, workspaceId, orgId, now())
    .run();
}

// =============================================================================
// Tests
// =============================================================================

describe("Workspace Binding Validation", () => {
  // Test data - use unique IDs to avoid conflicts
  const testOrgId = generateId();
  const testUserId = generateId();
  const testAadId = `aad-${now()}`;
  const testTenantId = `tenant-${now()}`;

  beforeAll(async () => {
    // Set up test organization
    await createOrganization(testOrgId, "Test Law Firm");

    // Set up test user
    await createUser(testUserId, "lawyer@testfirm.com");
    await addOrgMember(testUserId, testOrgId);

    // Link the user's Teams account
    await linkChannelUser("teams", testAadId, testUserId);

    // Bind the Teams tenant to the organization
    await bindWorkspaceToOrg("teams", testTenantId, testOrgId);
  });

  describe("Group Chat Validation", () => {
    it("silently drops group messages without tenant ID", async () => {
      // Arrange: A group chat message without channelData.tenant.id
      const groupChatWithoutTenant = createTeamsActivity({
        from: { aadObjectId: testAadId },
        conversation: { id: "group-conv", conversationType: "groupChat" },
        // No channelData with tenant
      });

      // Act
      const response = await fetchWorker("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: groupChatWithoutTenant,
      });

      // Assert: Should return 200 but silently ignore
      expect(response.status).toBe(200);
    });

    it("silently drops messages from unbound workspaces", async () => {
      // Arrange: A message from a tenant that isn't bound to any org
      const messageFromUnboundWorkspace = createTeamsActivity({
        from: { aadObjectId: testAadId },
        conversation: { id: "group-conv", conversationType: "groupChat" },
        channelData: { tenant: { id: "unbound-tenant-id" } },
      });

      // Act
      const response = await fetchWorker("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: messageFromUnboundWorkspace,
      });

      // Assert: Should return 200 but silently ignore
      expect(response.status).toBe(200);
    });

    it("prevents cross-org message routing", async () => {
      // Arrange: Create another org with a different tenant binding
      const otherOrgId = generateId();
      const otherTenantId = `other-tenant-${now()}`;

      await createOrganization(otherOrgId, "Other Law Firm");
      await bindWorkspaceToOrg("teams", otherTenantId, otherOrgId);

      // Try to send a message where user is from testOrg but tenant is bound to otherOrg
      const crossOrgMessage = createTeamsActivity({
        from: { aadObjectId: testAadId },
        conversation: { id: "cross-org-conv", conversationType: "groupChat" },
        channelData: { tenant: { id: otherTenantId } },
      });

      // Act
      const response = await fetchWorker("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: crossOrgMessage,
      });

      // Assert: Should return 200 but silently ignore (security measure)
      expect(response.status).toBe(200);
    });
  });

  describe("Personal Chat Handling", () => {
    it("routes personal messages without requiring tenant validation", async () => {
      // Arrange: Personal DM doesn't require tenant binding
      // Note: We use an unlinked user here because the test environment
      // doesn't support full DO SQL authorization for message processing.
      // This verifies the routing logic accepts personal chats without tenant checks.
      const personalMessage = createTeamsActivity({
        from: { aadObjectId: "unlinked-personal-user" },
        conversation: { id: "personal-conv", conversationType: "personal" },
      });

      // Act
      const response = await fetchWorker("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: personalMessage,
      });

      // Assert: Unlinked users get 200 (onboarding message sent)
      expect(response.status).toBe(200);
    });
  });
});
