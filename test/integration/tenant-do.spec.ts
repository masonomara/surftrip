/**
 * TenantDO Integration Tests
 *
 * Tests the TenantDO endpoints directly using the Durable Object stub.
 * These tests verify request handling, permission checks, and data operations.
 */

import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:test";

// Flag to enable/disable tests that need DO SQLite (not yet supported in test pool)
const doSqliteSupported = false;

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock tool call response from the AI model.
 */
function createMockToolCallResponse(
  calls: Array<{ name: string; arguments: object }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return { tool_calls: calls };
}

/**
 * Creates a channel message payload for testing.
 */
function createChannelMessage(
  orgId: string,
  overrides: Record<string, unknown> = {}
): string {
  const defaultMessage = {
    channel: "teams",
    orgId,
    userId: "user-1",
    userRole: "member",
    conversationId: "conv-1",
    conversationScope: "personal",
    message: "Hello",
    jurisdictions: ["CA"],
    practiceTypes: ["general"],
    firmSize: "small",
  };

  return JSON.stringify({
    ...defaultMessage,
    ...overrides,
  });
}

/**
 * Gets a TenantDO stub for the given org ID.
 */
function getTenantDO(orgId: string): DurableObjectStub {
  return env.TENANT.get(env.TENANT.idFromName(orgId));
}

/**
 * Makes a POST request to a TenantDO endpoint.
 */
async function postToDO(
  stub: DurableObjectStub,
  path: string,
  body: string
): Promise<Response> {
  return stub.fetch(
    new Request(`https://do${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
  );
}

// =============================================================================
// TenantDO Tests
// =============================================================================

describe.skipIf(!doSqliteSupported)("TenantDO", () => {
  describe("Message Processing", () => {
    it("rejects messages for a different org", async () => {
      const response = await postToDO(
        getTenantDO("org-123"),
        "/process-message",
        createChannelMessage("different-org") // Wrong org ID!
      );

      expect(response.status).toBe(403);

      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("Organization mismatch");
    });

    it("creates a new conversation for valid messages", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(
        getTenantDO(orgId),
        "/process-message",
        createChannelMessage(orgId)
      );

      expect(response.status).toBe(200);
    });

    it("rejects invalid message format", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(
        getTenantDO(orgId),
        "/process-message",
        JSON.stringify({ channel: "teams" }) // Missing required fields
      );

      expect(response.status).toBe(400);
    });

    it("rejects GET requests to process-message", async () => {
      const orgId = `org-${Date.now()}`;
      const stub = getTenantDO(orgId);

      // GET instead of POST
      const response = await stub.fetch(
        new Request("https://do/process-message")
      );

      expect(response.status).toBe(405);
    });
  });

  describe("Permission Checks", () => {
    it("denies CUD operations for members", async () => {
      const orgId = `org-${Date.now()}`;

      // Mock AI to return a create tool call
      vi.spyOn(env.AI, "run").mockResolvedValueOnce(
        createMockToolCallResponse([
          {
            name: "clioQuery",
            arguments: { operation: "create", objectType: "Task", data: {} },
          },
        ])
      );

      const response = await postToDO(
        getTenantDO(orgId),
        "/process-message",
        createChannelMessage(orgId, { userRole: "member" })
      );

      const body = (await response.json()) as { response: string };

      // Should mention lack of permission
      expect(body.response).toContain("don't have permission");

      vi.restoreAllMocks();
    });

    it("allows read operations for members", async () => {
      const orgId = `org-${Date.now()}`;

      // Mock AI to return a read tool call
      vi.spyOn(env.AI, "run").mockResolvedValueOnce(
        createMockToolCallResponse([
          {
            name: "clioQuery",
            arguments: { operation: "read", objectType: "Matter" },
          },
        ])
      );

      const response = await postToDO(
        getTenantDO(orgId),
        "/process-message",
        createChannelMessage(orgId, { userRole: "member" })
      );

      expect(response.status).toBe(200);

      vi.restoreAllMocks();
    });

    it("prompts for confirmation for admin CUD operations", async () => {
      const orgId = `org-${Date.now()}`;

      // Mock AI to return a create tool call
      vi.spyOn(env.AI, "run").mockResolvedValueOnce(
        createMockToolCallResponse([
          {
            name: "clioQuery",
            arguments: { operation: "create", objectType: "Task", data: {} },
          },
        ])
      );

      const response = await postToDO(
        getTenantDO(orgId),
        "/process-message",
        createChannelMessage(orgId, { userRole: "admin" })
      );

      const body = (await response.json()) as { response: string };

      // Admin should be asked to confirm
      expect(body.response).toContain("confirm");

      vi.restoreAllMocks();
    });
  });

  describe("Audit Logging", () => {
    it("creates audit entries for valid input", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(
        getTenantDO(orgId),
        "/audit",
        JSON.stringify({
          user_id: "user-123",
          action: "create",
          object_type: "matter",
          params: {},
          result: "success",
        })
      );

      expect(response.status).toBe(200);

      const body = (await response.json()) as { id: string };
      expect(body.id).toBeDefined();
    });

    it("rejects invalid audit entries", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(
        getTenantDO(orgId),
        "/audit",
        JSON.stringify({ user_id: "user-123" }) // Missing required fields
      );

      expect(response.status).toBe(400);
    });
  });

  describe("Schema Refresh", () => {
    it("refreshes schema cache successfully", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(
        getTenantDO(orgId),
        "/refresh-schema",
        "{}"
      );

      expect(response.status).toBe(200);

      const body = (await response.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });
  });

  describe("Routing", () => {
    it("returns 404 for unknown paths", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await getTenantDO(orgId).fetch(
        new Request("https://do/unknown")
      );

      expect(response.status).toBe(404);
    });
  });

  describe("Remove User", () => {
    it("expires pending confirmations for removed user", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(
        getTenantDO(orgId),
        "/remove-user",
        JSON.stringify({ userId: "user-to-remove" })
      );

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        success: boolean;
        userId: string;
        expiredConfirmations: number;
      };

      expect(body.success).toBe(true);
      expect(body.userId).toBe("user-to-remove");
      expect(body.expiredConfirmations).toBeGreaterThanOrEqual(0);
    });

    it("rejects requests without userId", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(
        getTenantDO(orgId),
        "/remove-user",
        JSON.stringify({})
      );

      expect(response.status).toBe(400);

      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("userId");
    });

    it("rejects GET requests", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await getTenantDO(orgId).fetch(
        new Request("https://do/remove-user")
      );

      expect(response.status).toBe(405);
    });
  });

  describe("Delete Org", () => {
    it("clears all DO data and returns counts", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(getTenantDO(orgId), "/delete-org", "{}");

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        success: boolean;
        deleted: {
          conversations: number;
          messages: number;
          pendingConfirmations: number;
          kvEntries: number;
        };
      };

      expect(body.success).toBe(true);
      expect(body.deleted).toBeDefined();
      expect(body.deleted.conversations).toBeGreaterThanOrEqual(0);
    });

    it("rejects GET requests", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await getTenantDO(orgId).fetch(
        new Request("https://do/delete-org")
      );

      expect(response.status).toBe(405);
    });
  });

  describe("Purge User Data (GDPR)", () => {
    it("purges user messages and confirmations", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(
        getTenantDO(orgId),
        "/purge-user-data",
        JSON.stringify({ userId: "user-to-purge" })
      );

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        success: boolean;
        purged: {
          messages: number;
          pendingConfirmations: number;
          clioToken: boolean;
        };
      };

      expect(body.success).toBe(true);
      expect(body.purged).toBeDefined();
      expect(typeof body.purged.clioToken).toBe("boolean");
    });

    it("rejects requests without userId", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await postToDO(
        getTenantDO(orgId),
        "/purge-user-data",
        JSON.stringify({})
      );

      expect(response.status).toBe(400);

      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("userId");
    });

    it("rejects GET requests", async () => {
      const orgId = `org-${Date.now()}`;

      const response = await getTenantDO(orgId).fetch(
        new Request("https://do/purge-user-data")
      );

      expect(response.status).toBe(405);
    });
  });
});
