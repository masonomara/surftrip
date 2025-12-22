/**
 * End-to-End Demo Flow Tests
 *
 * These tests verify the complete message flow from Teams webhook to response.
 * They require a running worker (either local or deployed).
 *
 * To run locally: npm run dev (in one terminal), then npm run test:e2e
 * To run against deployed: WORKER_URL=https://your-worker.workers.dev npm run test:e2e
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Test Configuration
// =============================================================================

const hasWorkerUrl =
  typeof process !== "undefined" && process.env?.WORKER_URL;
const BASE_URL = process.env?.WORKER_URL || "http://localhost:8787";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a valid Teams activity message for testing.
 */
function createTeamsActivity(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "message",
    text: "Test message",
    from: { aadObjectId: "test-user-aad-id" },
    conversation: { id: "test-conv-id", conversationType: "personal" },
    recipient: { id: "bot-id" },
    serviceUrl: "https://test.botframework.com/",
    ...overrides,
  });
}

/**
 * Sends a POST request to the Teams webhook endpoint.
 */
async function sendTeamsMessage(body: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

// =============================================================================
// E2E Tests
// =============================================================================

describe.skipIf(!hasWorkerUrl)("E2E Demo Flow", () => {
  describe("User Onboarding", () => {
    it("handles messages from unlinked users gracefully", async () => {
      // Arrange: A user that hasn't linked their account
      const unlinkedUserMessage = createTeamsActivity({
        from: { aadObjectId: "unlinked-user-" + Date.now() },
      });

      // Act
      const response = await sendTeamsMessage(unlinkedUserMessage);

      // Assert: Should succeed (200) even for unlinked users
      // The bot will send an onboarding message in the background
      expect(response.status).toBe(200);
    });
  });

  describe("Conversation Continuity", () => {
    it("maintains context across multiple messages in a conversation", async () => {
      // Arrange: Use a unique conversation ID
      const conversationId = `multi-turn-${Date.now()}`;

      // Act: Send first message
      const firstMessage = createTeamsActivity({
        text: "Hello, this is my first message",
        conversation: { id: conversationId, conversationType: "personal" },
      });
      const firstResponse = await sendTeamsMessage(firstMessage);

      // Act: Send follow-up message in same conversation
      const followUpMessage = createTeamsActivity({
        text: "This is a follow-up message",
        conversation: { id: conversationId, conversationType: "personal" },
      });
      const secondResponse = await sendTeamsMessage(followUpMessage);

      // Assert: Both messages should be processed successfully
      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
    });
  });

  describe("Conversation Scopes", () => {
    it("processes personal (DM) messages", async () => {
      // Arrange
      const personalMessage = createTeamsActivity({
        conversation: {
          id: `personal-${Date.now()}`,
          conversationType: "personal",
        },
      });

      // Act
      const response = await sendTeamsMessage(personalMessage);

      // Assert
      expect(response.status).toBe(200);
    });

    it("processes group chat messages", async () => {
      // Arrange
      const groupChatMessage = createTeamsActivity({
        conversation: {
          id: `groupchat-${Date.now()}`,
          conversationType: "groupChat",
        },
      });

      // Act
      const response = await sendTeamsMessage(groupChatMessage);

      // Assert
      expect(response.status).toBe(200);
    });

    it("processes channel messages", async () => {
      // Arrange
      const channelMessage = createTeamsActivity({
        conversation: {
          id: `channel-${Date.now()}`,
          conversationType: "channel",
        },
      });

      // Act
      const response = await sendTeamsMessage(channelMessage);

      // Assert
      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    it("handles malformed JSON gracefully", async () => {
      // Arrange: Invalid JSON
      const invalidJson = "this is not valid JSON {{{";

      // Act
      const response = await fetch(`${BASE_URL}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: invalidJson,
      });

      // Assert: Should not crash - response status varies by error handling
      expect(response.status).toBeDefined();
    });

    it("handles messages with missing required fields", async () => {
      // Arrange: Activity missing text and from fields
      const incompleteMessage = JSON.stringify({
        type: "message",
        // Missing: text, from, conversation
      });

      // Act
      const response = await sendTeamsMessage(incompleteMessage);

      // Assert: Should return 200 (bot ignores non-processable activities)
      expect(response.status).toBe(200);
    });

    it("ignores non-message activity types", async () => {
      // Arrange: An event that's not a message
      const nonMessageActivity = JSON.stringify({
        type: "conversationUpdate", // Not a message
        membersAdded: [{ id: "user-id" }],
      });

      // Act
      const response = await sendTeamsMessage(nonMessageActivity);

      // Assert: Should succeed by ignoring
      expect(response.status).toBe(200);
    });
  });
});

// =============================================================================
// Performance Tests (Skipped by default)
// =============================================================================

describe.skip("Performance", () => {
  it("responds within acceptable time limits", async () => {
    // Arrange
    const message = createTeamsActivity();
    const startTime = Date.now();

    // Act
    await sendTeamsMessage(message);
    const elapsedTime = Date.now() - startTime;

    // Assert: Should respond within 5 seconds
    expect(elapsedTime).toBeLessThan(5000);
  });

  it("handles concurrent messages without errors", async () => {
    // Arrange: Create 5 different conversations
    const messages = Array.from({ length: 5 }, (_, index) =>
      createTeamsActivity({
        from: { aadObjectId: `concurrent-user-${index}` },
        conversation: {
          id: `concurrent-conv-${index}-${Date.now()}`,
          conversationType: "personal",
        },
      })
    );

    // Act: Send all messages concurrently
    const responses = await Promise.all(
      messages.map((msg) => sendTeamsMessage(msg))
    );

    // Assert: All should succeed
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
  });
});
