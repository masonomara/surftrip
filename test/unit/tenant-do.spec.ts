import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:test";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock tool call response from the AI.
 * Uses 'any' to bypass complex AI response type unions in tests.
 */
function createMockToolCallResponse(
  calls: Array<{ name: string; arguments: object }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return { tool_calls: calls };
}

/**
 * Creates a valid channel message for testing.
 */
function createChannelMessage(orgId: string, overrides = {}) {
  return JSON.stringify({
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
    ...overrides,
  });
}

/**
 * Gets a Durable Object stub for a given org.
 */
function getTenantDO(orgId: string) {
  return env.TENANT.get(env.TENANT.idFromName(orgId));
}

/**
 * Sends a POST request to a Durable Object endpoint.
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

describe.skip("TenantDO", () => {
  describe("Message Processing", () => {
    it("rejects messages for a different org", async () => {
      // Arrange
      const doStub = getTenantDO("org-123");
      const messageForDifferentOrg = createChannelMessage("different-org");

      // Act
      const response = await postToDO(
        doStub,
        "/process-message",
        messageForDifferentOrg
      );

      // Assert
      expect(response.status).toBe(403);

      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("Organization mismatch");
    });

    it("creates a new conversation for valid messages", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);
      const message = createChannelMessage(orgId);

      // Act
      const response = await postToDO(doStub, "/process-message", message);

      // Assert
      expect(response.status).toBe(200);
    });

    it("rejects invalid message format", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);
      const invalidMessage = JSON.stringify({ channel: "teams" }); // Missing required fields

      // Act
      const response = await postToDO(
        doStub,
        "/process-message",
        invalidMessage
      );

      // Assert
      expect(response.status).toBe(400);
    });

    it("rejects GET requests to process-message", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);

      // Act
      const response = await doStub.fetch(
        new Request("https://do/process-message")
      );

      // Assert
      expect(response.status).toBe(405);
    });
  });

  describe("Permission Checks", () => {
    it("denies CUD operations for members", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);
      const message = createChannelMessage(orgId, { userRole: "member" });

      // Mock AI to return a create tool call
      vi.spyOn(env.AI, "run").mockResolvedValueOnce(
        createMockToolCallResponse([
          {
            name: "clioQuery",
            arguments: { operation: "create", objectType: "Task", data: {} },
          },
        ])
      );

      // Act
      const response = await postToDO(doStub, "/process-message", message);
      const body = (await response.json()) as { response: string };

      // Assert
      expect(body.response).toContain("don't have permission");

      // Cleanup
      vi.restoreAllMocks();
    });

    it("allows read operations for members", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);
      const message = createChannelMessage(orgId, { userRole: "member" });

      // Mock AI to return a read tool call
      vi.spyOn(env.AI, "run").mockResolvedValueOnce(
        createMockToolCallResponse([
          {
            name: "clioQuery",
            arguments: { operation: "read", objectType: "Matter" },
          },
        ])
      );

      // Act
      const response = await postToDO(doStub, "/process-message", message);

      // Assert
      expect(response.status).toBe(200);

      // Cleanup
      vi.restoreAllMocks();
    });

    it("prompts for confirmation for admin CUD operations", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);
      const message = createChannelMessage(orgId, { userRole: "admin" });

      // Mock AI to return a create tool call
      vi.spyOn(env.AI, "run").mockResolvedValueOnce(
        createMockToolCallResponse([
          {
            name: "clioQuery",
            arguments: { operation: "create", objectType: "Task", data: {} },
          },
        ])
      );

      // Act
      const response = await postToDO(doStub, "/process-message", message);
      const body = (await response.json()) as { response: string };

      // Assert
      expect(body.response).toContain("confirm");

      // Cleanup
      vi.restoreAllMocks();
    });
  });

  describe("Audit Logging", () => {
    it("creates audit entries for valid input", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);
      const auditEntry = JSON.stringify({
        user_id: "user-123",
        action: "create",
        object_type: "matter",
        params: {},
        result: "success",
      });

      // Act
      const response = await postToDO(doStub, "/audit", auditEntry);

      // Assert
      expect(response.status).toBe(200);

      const body = (await response.json()) as { id: string };
      expect(body.id).toBeDefined();
    });

    it("rejects invalid audit entries", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);
      const invalidEntry = JSON.stringify({ user_id: "user-123" }); // Missing required fields

      // Act
      const response = await postToDO(doStub, "/audit", invalidEntry);

      // Assert
      expect(response.status).toBe(400);
    });
  });

  describe("Schema Refresh", () => {
    it("refreshes schema cache successfully", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);

      // Act
      const response = await postToDO(doStub, "/refresh-schema", "{}");

      // Assert
      expect(response.status).toBe(200);

      const body = (await response.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });
  });

  describe("Routing", () => {
    it("returns 404 for unknown paths", async () => {
      // Arrange
      const orgId = `org-${Date.now()}`;
      const doStub = getTenantDO(orgId);

      // Act
      const response = await doStub.fetch(new Request("https://do/unknown"));

      // Assert
      expect(response.status).toBe(404);
    });
  });
});

// =============================================================================
// ChannelMessage Schema Tests
// =============================================================================

describe("ChannelMessage Schema", () => {
  // Base valid message for testing variations
  const validBaseMessage = {
    channel: "teams",
    orgId: "org-123",
    userId: "user-456",
    userRole: "member",
    conversationId: "conv-789",
    conversationScope: "personal",
    message: "Hello",
    jurisdictions: [],
    practiceTypes: [],
    firmSize: null,
  };

  it("accepts a valid message with all required fields", async () => {
    // Arrange
    const { ChannelMessageSchema } = await import("../../src/types");
    const message = {
      ...validBaseMessage,
      message: "Hello, Docket!",
      jurisdictions: ["CA"],
      firmSize: "small",
    };

    // Act
    const result = ChannelMessageSchema.safeParse(message);

    // Assert
    expect(result.success).toBe(true);
  });

  it("rejects invalid channel types", async () => {
    // Arrange
    const { ChannelMessageSchema } = await import("../../src/types");
    const message = {
      ...validBaseMessage,
      channel: "invalid-channel",
    };

    // Act
    const result = ChannelMessageSchema.safeParse(message);

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects empty message content", async () => {
    // Arrange
    const { ChannelMessageSchema } = await import("../../src/types");
    const message = {
      ...validBaseMessage,
      message: "",
    };

    // Act
    const result = ChannelMessageSchema.safeParse(message);

    // Assert
    expect(result.success).toBe(false);
  });

  it("allows empty jurisdiction and practice type arrays", async () => {
    // Arrange
    const { ChannelMessageSchema } = await import("../../src/types");
    const message = {
      ...validBaseMessage,
      message: "Hello",
      userRole: "admin",
      conversationScope: "api",
    };

    // Act
    const result = ChannelMessageSchema.safeParse(message);

    // Assert
    expect(result.success).toBe(true);
  });
});
