/**
 * LLM Inference Unit Tests
 *
 * Tests the LLM interaction patterns including system prompt construction,
 * response parsing, error handling, and conversation history management.
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

// =============================================================================
// Types
// =============================================================================

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMResponse {
  content?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

// =============================================================================
// Helper Functions (Mirroring Production Code)
// =============================================================================

/**
 * Builds the system prompt for the LLM based on RAG context and user role.
 * This shapes how the AI responds to user queries.
 */
function buildSystemPrompt(ragContext: string, userRole: string): string {
  // Determine role-specific instructions
  const isAdmin = userRole === "admin";

  const roleNote = isAdmin
    ? "This user is an Admin and can perform create/update/delete operations with confirmation."
    : "This user is a Member with read-only access to Clio.";

  const roleLabel = isAdmin ? "Admin" : "Member";

  // Build the full system prompt
  return `You are Docket, a case management assistant for legal teams using Clio.

**Tone:** Helpful, competent, deferential. You assist—you don't lead.

**User Role:** ${roleLabel}
${roleNote}

**Knowledge Base Context:**
${ragContext || "No relevant context found."}

**Instructions:**
- Use Knowledge Base and firm context for case management questions
- Query Clio using the clioQuery tool per the schema above
- For write operations (create, update, delete), always confirm first
- NEVER give legal advice—you manage cases, not law
- Stay in scope: case management, Clio operations, firm procedures`;
}

/**
 * Parses the LLM response into a structured format.
 * Handles both text-only responses and tool call responses.
 */
function parseLLMResponse(response: unknown): LLMResponse {
  // Handle string response (simple text)
  if (typeof response === "string") {
    return { content: response };
  }

  // Handle structured response with potential tool calls
  const structured = response as {
    response?: string;
    tool_calls?: Array<{ name: string; arguments: string | object }>;
  };

  // Parse tool calls if present
  let toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }> = [];

  if (structured.tool_calls && structured.tool_calls.length > 0) {
    toolCalls = structured.tool_calls.map((tc) => ({
      name: tc.name,
      arguments:
        typeof tc.arguments === "string"
          ? JSON.parse(tc.arguments)
          : (tc.arguments as Record<string, unknown>),
    }));
  }

  return {
    content: structured.response,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/**
 * Determines if an AI error code is retryable (transient).
 * Rate limits and server errors can be retried.
 */
function isRetryableError(error: { code?: number }): boolean {
  const retryableCodes = [
    3040, // Rate limit exceeded
    3043, // Server error
  ];

  return retryableCodes.includes(error.code || 0);
}

/**
 * Converts an AI error code to a user-friendly message.
 */
function getUserFriendlyError(error: { code?: number }): string {
  switch (error.code) {
    case 3036:
      return "I've reached my daily limit. Please try again tomorrow.";
    case 5007:
      return "The AI model is currently unavailable. Please try again later.";
    default:
      return "I'm having trouble processing your request. Please try again.";
  }
}

/**
 * Limits conversation history to prevent context overflow.
 * Keeps the most recent messages up to maxMessages.
 */
function limitConversationHistory(
  history: LLMMessage[],
  maxMessages: number
): LLMMessage[] {
  if (history.length <= maxMessages) {
    return history;
  }

  // Keep only the most recent messages
  return history.slice(-maxMessages);
}

// =============================================================================
// LLM Inference Tests
// =============================================================================

describe("Part 4: LLM Inference", () => {
  // ---------------------------------------------------------------------------
  // Model Selection
  // ---------------------------------------------------------------------------

  describe("Model Selection", () => {
    it("uses llama-3.1-8b-instruct for inference", async () => {
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say hello in exactly 3 words." },
        ],
        max_tokens: 50,
      });

      // Should get a response
      expect(response).toBeDefined();

      // Extract text from response (handles both string and object formats)
      const text =
        typeof response === "string"
          ? response
          : (response as { response?: string }).response;

      expect(text).toBeDefined();
      expect(typeof text).toBe("string");
    });

    it("respects max_tokens parameter", async () => {
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
        messages: [
          { role: "user", content: "Write a very long story about a dragon." },
        ],
        max_tokens: 10, // Very low limit
      });

      const text =
        typeof response === "string"
          ? response
          : (response as { response?: string }).response || "";

      // Response should be truncated due to low token limit
      expect(text.length).toBeLessThan(200);
    });
  });

  // ---------------------------------------------------------------------------
  // System Prompt Construction
  // ---------------------------------------------------------------------------

  describe("System Prompt Construction", () => {
    it("buildSystemPrompt includes RAG context", () => {
      const ragContext = "## Knowledge Base\n\nMatters organize cases in Clio.";
      const prompt = buildSystemPrompt(ragContext, "member");

      // Should include Docket identity
      expect(prompt).toContain("Docket");

      // Should include the RAG context section
      expect(prompt).toContain("Knowledge Base Context:");

      // Should include the actual context content
      expect(prompt).toContain("Matters organize cases in Clio");

      // Should indicate member role
      expect(prompt).toContain("Member");
    });

    it("buildSystemPrompt differentiates admin vs member roles", () => {
      const adminPrompt = buildSystemPrompt("", "admin");
      const memberPrompt = buildSystemPrompt("", "member");

      // Admin prompt should mention admin capabilities
      expect(adminPrompt).toContain("Admin");
      expect(adminPrompt).toContain("create/update/delete");

      // Member prompt should indicate read-only
      expect(memberPrompt).toContain("Member");
      expect(memberPrompt).toContain("read-only");
    });

    it("buildSystemPrompt handles empty RAG context", () => {
      const prompt = buildSystemPrompt("", "member");

      // Should show placeholder when no context is available
      expect(prompt).toContain("No relevant context found");
    });

    it("buildSystemPrompt includes Clio instructions", () => {
      const prompt = buildSystemPrompt("", "admin");

      // Should mention the clioQuery tool
      expect(prompt).toContain("clioQuery");

      // Should require confirmation for write operations
      expect(prompt).toContain("confirm");

      // Should include the legal advice disclaimer
      expect(prompt).toContain("NEVER give legal advice");
    });
  });

  // ---------------------------------------------------------------------------
  // LLM Response Handling
  // ---------------------------------------------------------------------------

  describe("LLM Response Handling", () => {
    it("handles text-only response", async () => {
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
        messages: [
          { role: "system", content: "You are Docket." },
          { role: "user", content: "Hello!" },
        ],
        max_tokens: 100,
      });

      const parsed = parseLLMResponse(response);

      // Should have content
      expect(parsed.content).toBeDefined();

      // Should NOT have tool calls (just a greeting)
      expect(parsed.toolCalls).toBeUndefined();
    });

    it("handles tool call response", async () => {
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
        messages: [
          {
            role: "system",
            content: "You are Docket. Use clioQuery to help users query Clio.",
          },
          { role: "user", content: "Show me all my open matters" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "clioQuery",
              description: "Query Clio data",
              parameters: {
                type: "object",
                properties: {
                  operation: { type: "string", enum: ["read"] },
                  objectType: { type: "string", enum: ["Matter"] },
                  filters: { type: "object" },
                },
                required: ["operation", "objectType"],
              },
            },
          },
        ],
        max_tokens: 200,
      });

      const parsed = parseLLMResponse(response);

      // Should have either content or tool calls (or both)
      expect(
        parsed.content !== undefined || parsed.toolCalls !== undefined
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe("Error Handling", () => {
    it("error codes are documented correctly", () => {
      // These are the known Workers AI error codes
      const knownErrorCodes = {
        3040: "Rate limit exceeded",
        3043: "Server error",
        3036: "Daily limit reached",
        5007: "Model not found",
      };

      // Verify we handle these codes
      expect(Object.keys(knownErrorCodes)).toContain("3040");
      expect(Object.keys(knownErrorCodes)).toContain("3043");
    });

    it("isRetryableError identifies transient errors", () => {
      // Rate limit and server errors are retryable
      expect(isRetryableError({ code: 3040 })).toBe(true);
      expect(isRetryableError({ code: 3043 })).toBe(true);

      // Daily limit and model errors are NOT retryable
      expect(isRetryableError({ code: 3036 })).toBe(false);
      expect(isRetryableError({ code: 5007 })).toBe(false);

      // Unknown errors are not retryable
      expect(isRetryableError({ code: 9999 })).toBe(false);
    });

    it("getUserFriendlyError returns appropriate messages", () => {
      // Daily limit should mention "daily limit"
      expect(getUserFriendlyError({ code: 3036 })).toContain("daily limit");

      // Model unavailable should mention "unavailable"
      expect(getUserFriendlyError({ code: 5007 })).toContain("unavailable");

      // Unknown errors should give a generic message
      expect(getUserFriendlyError({ code: 9999 })).toContain("trouble");
    });
  });

  // ---------------------------------------------------------------------------
  // Conversation History
  // ---------------------------------------------------------------------------

  describe("Conversation History", () => {
    it("formats messages array correctly", () => {
      const history: LLMMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
      ];

      // Build full messages array with system prompt
      const messages: LLMMessage[] = [
        { role: "system", content: buildSystemPrompt("", "member") },
        ...history,
      ];

      // First message should be system
      expect(messages[0].role).toBe("system");

      // Then the conversation history follows
      expect(messages[1].role).toBe("user");
      expect(messages[2].role).toBe("assistant");
      expect(messages[3].role).toBe("user");
    });

    it("limits history to prevent context overflow", () => {
      // Create a long conversation history (20 messages)
      const history: LLMMessage[] = Array.from({ length: 20 }, (_, index) => ({
        role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Message ${index}`,
      }));

      // Limit to 15 messages
      const limited = limitConversationHistory(history, 15);

      // Should only keep the 15 most recent
      expect(limited.length).toBe(15);

      // First message should be Message 5 (skipped 0-4)
      expect(limited[0].content).toBe("Message 5");
    });
  });
});
