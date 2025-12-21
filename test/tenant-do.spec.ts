import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker, { type Env } from "../src/index";
import {
  validateChannelMessage,
  type ChannelMessage,
} from "../src/types/channel";

// =============================================================================
// ChannelMessage Validation Tests
// =============================================================================

describe("ChannelMessage Validation", () => {
  const validMessage: ChannelMessage = {
    channel: "teams",
    orgId: "org-123",
    userId: "user-456",
    userRole: "admin",
    conversationId: "conv-789",
    conversationScope: "personal",
    message: "Hello, world!",
    jurisdiction: "CA",
    practiceType: "litigation",
    firmSize: "small",
  };

  it("validates a correct ChannelMessage", () => {
    expect(validateChannelMessage(validMessage)).toBe(true);
  });

  it("validates with null optional fields", () => {
    const msg = {
      ...validMessage,
      jurisdiction: null,
      practiceType: null,
      firmSize: null,
    };
    expect(validateChannelMessage(msg)).toBe(true);
  });

  it("validates with metadata", () => {
    const msg = {
      ...validMessage,
      metadata: { threadId: "thread-1", teamsChannelId: "channel-1" },
    };
    expect(validateChannelMessage(msg)).toBe(true);
  });

  it("rejects invalid channel type", () => {
    const msg = { ...validMessage, channel: "invalid" };
    expect(validateChannelMessage(msg)).toBe(false);
  });

  it("rejects empty orgId", () => {
    const msg = { ...validMessage, orgId: "" };
    expect(validateChannelMessage(msg)).toBe(false);
  });

  it("rejects invalid userRole", () => {
    const msg = { ...validMessage, userRole: "superadmin" };
    expect(validateChannelMessage(msg)).toBe(false);
  });

  it("rejects invalid conversationScope", () => {
    const msg = { ...validMessage, conversationScope: "public" };
    expect(validateChannelMessage(msg)).toBe(false);
  });

  it("rejects invalid firmSize", () => {
    const msg = { ...validMessage, firmSize: "huge" };
    expect(validateChannelMessage(msg)).toBe(false);
  });

  it("rejects null input", () => {
    expect(validateChannelMessage(null)).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateChannelMessage("string")).toBe(false);
  });
});

// =============================================================================
// Worker Route Tests
// =============================================================================

describe("Worker Routes", () => {
  it("/demo/tenant-do returns HTML page", async () => {
    const request = new Request("http://localhost/demo/tenant-do");
    const response = await worker.fetch(request, env as Env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    const html = await response.text();
    expect(html).toContain("Tenant Durable Object");
    expect(html).toContain("Process Message");
  });

  it("routes list includes /demo/tenant-do", async () => {
    const request = new Request("http://localhost/unknown");
    const response = await worker.fetch(request, env as Env);
    const data = (await response.json()) as { routes: string[] };

    expect(data.routes).toContain("/demo/tenant-do");
  });
});

// =============================================================================
// DO Route Tests (Skipped - requires DO setup with SQLite auth)
// =============================================================================

describe.skip("DO Route Integration", () => {
  it("/do/:orgId/status returns stats", async () => {
    const request = new Request("http://localhost/do/non-existent/status");
    const response = await worker.fetch(request, env as Env);

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      orgId: string;
      stats: { conversations: number };
    };
    expect(data.stats.conversations).toBe(0);
  });

  it("/do/:orgId/unknown returns 404", async () => {
    const request = new Request("http://localhost/do/org-1/unknown");
    const response = await worker.fetch(request, env as Env);

    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe("Unknown action");
  });
});

// =============================================================================
// TenantDO Integration Tests (Skipped - requires DO SQLite auth)
// Test manually via /demo/tenant-do endpoint
// =============================================================================

describe.skip("TenantDO Integration", () => {
  const testOrgId = `test-org-${Date.now()}`;
  const testUserId = "test-user-1";
  const testConvId = "test-conv-1";

  beforeEach(async () => {
    // Ensure org exists
    await (env as Env).DB.prepare(
      "INSERT OR IGNORE INTO org (id, name) VALUES (?, ?)"
    )
      .bind(testOrgId, "Test Org")
      .run();
  });

  it("processes a valid message and stores it", async () => {
    const message: ChannelMessage = {
      channel: "web",
      orgId: testOrgId,
      userId: testUserId,
      userRole: "admin",
      conversationId: testConvId,
      conversationScope: "personal",
      message: "Test message",
      jurisdiction: null,
      practiceType: null,
      firmSize: null,
    };

    const request = new Request("http://localhost/demo/tenant-do", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "process-message",
        orgId: testOrgId,
        message,
      }),
    });

    const response = await worker.fetch(request, env as Env);
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      success: boolean;
      conversationId: string;
      responseText: string;
    };
    expect(data.success).toBe(true);
    expect(data.conversationId).toBe(testConvId);
    expect(data.responseText).toContain("Phase 7");
  });

  it("maintains conversation history", async () => {
    const message1: ChannelMessage = {
      channel: "web",
      orgId: testOrgId,
      userId: testUserId,
      userRole: "admin",
      conversationId: `history-${Date.now()}`,
      conversationScope: "personal",
      message: "First message",
      jurisdiction: null,
      practiceType: null,
      firmSize: null,
    };

    // Send first message
    await worker.fetch(
      new Request("http://localhost/demo/tenant-do", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process-message",
          orgId: testOrgId,
          message: message1,
        }),
      }),
      env as Env
    );

    // Send second message
    const message2 = { ...message1, message: "Second message" };
    const response = await worker.fetch(
      new Request("http://localhost/demo/tenant-do", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process-message",
          orgId: testOrgId,
          message: message2,
        }),
      }),
      env as Env
    );

    const data = (await response.json()) as {
      success: boolean;
      data: { historyCount: number };
    };
    expect(data.success).toBe(true);
    // Should have 3 messages: user1, assistant1, user2
    expect(data.data.historyCount).toBe(3);
  });

  it("rejects messages with mismatched orgId", async () => {
    const message: ChannelMessage = {
      channel: "web",
      orgId: "wrong-org-id", // Mismatched
      userId: testUserId,
      userRole: "admin",
      conversationId: testConvId,
      conversationScope: "personal",
      message: "Test",
      jurisdiction: null,
      practiceType: null,
      firmSize: null,
    };

    const request = new Request("http://localhost/demo/tenant-do", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "process-message",
        orgId: testOrgId,
        message,
      }),
    });

    const response = await worker.fetch(request, env as Env);
    const data = (await response.json()) as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toBe("Organization mismatch");
  });

  it("returns DO status with stats", async () => {
    const request = new Request("http://localhost/demo/tenant-do", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", orgId: testOrgId }),
    });

    const response = await worker.fetch(request, env as Env);
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      orgId: string;
      stats: { conversations: number; messages: number };
    };
    expect(data.stats).toBeDefined();
    expect(typeof data.stats.conversations).toBe("number");
    expect(typeof data.stats.messages).toBe("number");
  });

  it("handles user leave org", async () => {
    // First send a message to create some data
    const message: ChannelMessage = {
      channel: "web",
      orgId: testOrgId,
      userId: testUserId,
      userRole: "admin",
      conversationId: `leave-${Date.now()}`,
      conversationScope: "personal",
      message: "Before leave",
      jurisdiction: null,
      practiceType: null,
      firmSize: null,
    };

    await worker.fetch(
      new Request("http://localhost/demo/tenant-do", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process-message",
          orgId: testOrgId,
          message,
        }),
      }),
      env as Env
    );

    // Now trigger user leave
    const leaveRequest = new Request("http://localhost/demo/tenant-do", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "user-leave",
        orgId: testOrgId,
        userId: testUserId,
      }),
    });

    const response = await worker.fetch(leaveRequest, env as Env);
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      success: boolean;
      message: string;
    };
    expect(data.success).toBe(true);
    expect(data.message).toContain("User removed from org");
  });

  it("handles GDPR purge", async () => {
    const gdprUserId = `gdpr-user-${Date.now()}`;
    const message: ChannelMessage = {
      channel: "web",
      orgId: testOrgId,
      userId: gdprUserId,
      userRole: "member",
      conversationId: `gdpr-${Date.now()}`,
      conversationScope: "personal",
      message: "Delete me",
      jurisdiction: null,
      practiceType: null,
      firmSize: null,
    };

    // Create some messages
    await worker.fetch(
      new Request("http://localhost/demo/tenant-do", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process-message",
          orgId: testOrgId,
          message,
        }),
      }),
      env as Env
    );

    // Trigger GDPR purge
    const purgeRequest = new Request("http://localhost/demo/tenant-do", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "gdpr-purge",
        orgId: testOrgId,
        userId: gdprUserId,
      }),
    });

    const response = await worker.fetch(purgeRequest, env as Env);
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      success: boolean;
      message: string;
      data: { deletedMessages: number };
    };
    expect(data.success).toBe(true);
    expect(data.message).toContain("Purged user data");
    expect(data.data.deletedMessages).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Permission Enforcement Tests (Skipped - requires DO SQLite auth)
// =============================================================================

describe.skip("Permission Enforcement", () => {
  const testOrgId = `perm-org-${Date.now()}`;

  beforeEach(async () => {
    await (env as Env).DB.prepare(
      "INSERT OR IGNORE INTO org (id, name) VALUES (?, ?)"
    )
      .bind(testOrgId, "Perm Test Org")
      .run();
  });

  it("allows member to send read-only messages", async () => {
    const message: ChannelMessage = {
      channel: "web",
      orgId: testOrgId,
      userId: "member-user",
      userRole: "member",
      conversationId: `member-${Date.now()}`,
      conversationScope: "personal",
      message: "What are the deadlines?",
      jurisdiction: null,
      practiceType: null,
      firmSize: null,
    };

    const request = new Request("http://localhost/demo/tenant-do", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "process-message",
        orgId: testOrgId,
        message,
      }),
    });

    const response = await worker.fetch(request, env as Env);
    const data = (await response.json()) as { success: boolean };
    expect(data.success).toBe(true);
  });

  it("allows admin to send messages", async () => {
    const message: ChannelMessage = {
      channel: "web",
      orgId: testOrgId,
      userId: "admin-user",
      userRole: "admin",
      conversationId: `admin-${Date.now()}`,
      conversationScope: "personal",
      message: "Create a new matter",
      jurisdiction: null,
      practiceType: null,
      firmSize: null,
    };

    const request = new Request("http://localhost/demo/tenant-do", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "process-message",
        orgId: testOrgId,
        message,
      }),
    });

    const response = await worker.fetch(request, env as Env);
    const data = (await response.json()) as { success: boolean };
    expect(data.success).toBe(true);
  });
});

// =============================================================================
// Conversation Isolation Tests (Skipped - requires DO SQLite auth)
// =============================================================================

describe.skip("Conversation Isolation", () => {
  const testOrgId = `iso-org-${Date.now()}`;

  beforeEach(async () => {
    await (env as Env).DB.prepare(
      "INSERT OR IGNORE INTO org (id, name) VALUES (?, ?)"
    )
      .bind(testOrgId, "Isolation Test Org")
      .run();
  });

  it("isolates messages between conversations", async () => {
    const conv1 = `conv1-${Date.now()}`;
    const conv2 = `conv2-${Date.now()}`;

    const baseMessage: Omit<ChannelMessage, "conversationId" | "message"> = {
      channel: "web",
      orgId: testOrgId,
      userId: "user-1",
      userRole: "admin",
      conversationScope: "personal",
      jurisdiction: null,
      practiceType: null,
      firmSize: null,
    };

    // Send messages to conv1
    for (let i = 0; i < 3; i++) {
      await worker.fetch(
        new Request("http://localhost/demo/tenant-do", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "process-message",
            orgId: testOrgId,
            message: {
              ...baseMessage,
              conversationId: conv1,
              message: `Conv1 message ${i}`,
            },
          }),
        }),
        env as Env
      );
    }

    // Send one message to conv2
    const response = await worker.fetch(
      new Request("http://localhost/demo/tenant-do", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process-message",
          orgId: testOrgId,
          message: {
            ...baseMessage,
            conversationId: conv2,
            message: "Conv2 first message",
          },
        }),
      }),
      env as Env
    );

    const data = (await response.json()) as {
      data: { historyCount: number };
    };
    // Conv2 should only have 1 message (the one we just sent)
    expect(data.data.historyCount).toBe(1);
  });
});
