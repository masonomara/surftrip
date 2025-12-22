/**
 * Schema Validation Unit Tests
 *
 * Tests the ChannelMessageSchema used to validate incoming messages
 * from Teams, Slack, and other channels before processing.
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Schema Tests
// =============================================================================

describe("ChannelMessage Schema", () => {
  /**
   * A valid base message with all required fields.
   * Individual tests can override specific fields to test validation.
   */
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

  // ---------------------------------------------------------------------------
  // Valid Message Tests
  // ---------------------------------------------------------------------------

  it("accepts a valid message with all required fields", async () => {
    const { ChannelMessageSchema } = await import("../../src/types");

    const result = ChannelMessageSchema.safeParse({
      ...validBaseMessage,
      message: "Hello, Docket!",
      jurisdictions: ["CA"],
      firmSize: "small",
    });

    expect(result.success).toBe(true);
  });

  it("allows empty jurisdiction and practice type arrays", async () => {
    const { ChannelMessageSchema } = await import("../../src/types");

    const result = ChannelMessageSchema.safeParse({
      ...validBaseMessage,
      message: "Hello",
      userRole: "admin",
      conversationScope: "api",
    });

    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Invalid Message Tests
  // ---------------------------------------------------------------------------

  it("rejects invalid channel types", async () => {
    const { ChannelMessageSchema } = await import("../../src/types");

    const result = ChannelMessageSchema.safeParse({
      ...validBaseMessage,
      channel: "invalid-channel", // Not a valid channel
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty message content", async () => {
    const { ChannelMessageSchema } = await import("../../src/types");

    const result = ChannelMessageSchema.safeParse({
      ...validBaseMessage,
      message: "", // Empty message not allowed
    });

    expect(result.success).toBe(false);
  });
});
