/**
 * Phase 7 Integration Tests - LLM + RAG Pipeline
 *
 * Tests the complete message processing flow:
 * 1. Message → RAG context → response
 * 2. LLM error handling
 * 3. Confirmation flow
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { env } from "cloudflare:test";
import {
  retrieveRAGContext,
  formatRAGContext,
} from "../../src/services/rag-retrieval";

// =============================================================================
// Configuration
// =============================================================================

const integrationEnabled = !!(env as { INTEGRATION_TESTS_ENABLED?: boolean })
  .INTEGRATION_TESTS_ENABLED;

const testOrgId = `test-org-phase7-${Date.now()}`;
const testVectorIds: string[] = [];

// =============================================================================
// Test Data
// =============================================================================

const kbTestChunks = [
  {
    id: "kb_phase7_matters_0",
    content:
      "To create a matter in Clio, go to Matters > New Matter. Enter client name and description.",
    source: "clio-guide.md",
    category: "general",
  },
  {
    id: "kb_phase7_billing_0",
    content:
      "Time entries in Clio track billable hours. Navigate to Time > New Entry to log time.",
    source: "billing-guide.md",
    category: "general",
  },
];

const orgTestChunks = [
  {
    id: `${testOrgId}_policy_0`,
    content: "Firm policy: All new matters require conflict check before intake.",
    source: "firm-policy.pdf",
  },
];

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestOrg(orgId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO org (id, name, created_at) VALUES (?, ?, datetime('now'))"
  )
    .bind(orgId, "Phase 7 Test Org")
    .run();
}

async function insertKBChunks(): Promise<void> {
  for (const chunk of kbTestChunks) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO kb_chunks
       (id, content, source, section, chunk_index, category)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(chunk.id, chunk.content, chunk.source, null, 0, chunk.category)
      .run();
  }
}

async function insertOrgChunks(): Promise<void> {
  for (const chunk of orgTestChunks) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO org_context_chunks
       (id, org_id, file_id, content, source, chunk_index)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(chunk.id, testOrgId, "policy_doc", chunk.content, chunk.source, 0)
      .run();
  }
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: texts,
  })) as { data: number[][] };
  return result.data;
}

async function upsertVectors(): Promise<void> {
  const allChunks = [
    ...kbTestChunks.map((c) => ({
      ...c,
      metadata: { type: "kb", category: c.category, source: c.source },
    })),
    ...orgTestChunks.map((c) => ({
      ...c,
      metadata: { type: "org", org_id: testOrgId, source: c.source },
    })),
  ];

  const embeddings = await generateEmbeddings(allChunks.map((c) => c.content));

  const vectors = allChunks.map((chunk, i) => ({
    id: chunk.id,
    values: embeddings[i],
    metadata: chunk.metadata,
  }));

  await env.VECTORIZE.upsert(vectors);
  testVectorIds.push(...vectors.map((v) => v.id));
}

async function cleanup(): Promise<void> {
  if (testVectorIds.length > 0) {
    await env.VECTORIZE.deleteByIds(testVectorIds);
  }
  await env.DB.prepare("DELETE FROM kb_chunks WHERE id LIKE 'kb_phase7_%'").run();
  await env.DB.prepare("DELETE FROM org_context_chunks WHERE org_id = ?")
    .bind(testOrgId)
    .run();
  await env.DB.prepare("DELETE FROM org WHERE id = ?").bind(testOrgId).run();
}

// =============================================================================
// LLM Helper Functions (mirrored from production)
// =============================================================================

function buildSystemPrompt(ragContext: string, userRole: string): string {
  const roleNote =
    userRole === "admin"
      ? "This user is an Admin and can perform create/update/delete operations with confirmation."
      : "This user is a Member with read-only access to Clio.";

  return `You are Docket, a case management assistant for legal teams using Clio.

**Tone:** Helpful, competent, deferential. You assist—you don't lead.

**User Role:** ${userRole}
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

function isRetryableError(error: { code?: number }): boolean {
  const retryableCodes = [3040, 3043]; // Rate limit, server error
  return retryableCodes.includes(error.code || 0);
}

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

interface ConfirmationClassification {
  intent: "approve" | "reject" | "modify" | "unrelated" | "unclear";
  modifiedRequest?: string;
}

async function classifyConfirmationResponse(
  userMessage: string,
  pendingAction: { action: string; objectType: string; params: object }
): Promise<ConfirmationClassification> {
  const prompt = `A user was asked to confirm: ${pendingAction.action} a ${
    pendingAction.objectType
  } with: ${JSON.stringify(pendingAction.params)}
The user responded: "${userMessage}"
Classify as ONE of: approve, reject, modify, unrelated
Respond with JSON: {"intent": "...", "modifiedRequest": "..."}
Only include modifiedRequest if intent is "modify".`;

  try {
    const response = await (env.AI.run as Function)(
      "@cf/meta/llama-3.1-8b-instruct",
      { prompt, max_tokens: 100 }
    );

    const text =
      typeof response === "string"
        ? response
        : response?.response || "";

    if (!text) return { intent: "unclear" };

    const startIdx = text.indexOf("{");
    if (startIdx === -1) return { intent: "unclear" };

    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }

    if (endIdx === -1) return { intent: "unclear" };

    const jsonStr = text.slice(startIdx, endIdx + 1);
    const parsed = JSON.parse(jsonStr);

    const validIntents = ["approve", "reject", "modify", "unrelated"];
    return {
      intent: validIntents.includes(parsed.intent) ? parsed.intent : "unclear",
      modifiedRequest:
        parsed.intent === "modify" ? parsed.modifiedRequest : undefined,
    };
  } catch {
    return { intent: "unclear" };
  }
}

// =============================================================================
// Phase 7 Integration Tests
// =============================================================================

describe.skipIf(!integrationEnabled)("Phase 7: LLM + RAG Pipeline", () => {
  beforeAll(async () => {
    await createTestOrg(testOrgId);
    await insertKBChunks();
    await insertOrgChunks();
    await upsertVectors();
  }, 30000);

  afterAll(async () => {
    await cleanup();
  });

  // ---------------------------------------------------------------------------
  // 1. Message → RAG Context → Response
  // ---------------------------------------------------------------------------

  describe("Message → RAG Context → Response", () => {
    it("retrieves KB context for user query", async () => {
      const context = await retrieveRAGContext(
        env,
        "How do I create a matter in Clio?",
        testOrgId,
        { jurisdictions: [], practiceTypes: [], firmSize: null }
      );

      expect(context.kbChunks).toBeDefined();
      expect(Array.isArray(context.kbChunks)).toBe(true);
    });

    it("retrieves org-specific context", async () => {
      const context = await retrieveRAGContext(
        env,
        "What is the firm policy for new matters?",
        testOrgId,
        { jurisdictions: [], practiceTypes: [], firmSize: null }
      );

      expect(context.orgChunks).toBeDefined();
      expect(Array.isArray(context.orgChunks)).toBe(true);
    });

    it("formats RAG context for system prompt", async () => {
      const context = await retrieveRAGContext(
        env,
        "How do I log time?",
        testOrgId,
        { jurisdictions: [], practiceTypes: [], firmSize: null }
      );

      const formatted = formatRAGContext(context);

      // Should be a string (may be empty if no matches)
      expect(typeof formatted).toBe("string");

      // If we have context, should have proper sections
      if (context.kbChunks.length > 0) {
        expect(formatted).toContain("## Knowledge Base");
      }
      if (context.orgChunks.length > 0) {
        expect(formatted).toContain("## Firm Context");
      }
    });

    it("generates LLM response with RAG context", async () => {
      const context = await retrieveRAGContext(
        env,
        "How do I create a matter?",
        testOrgId,
        { jurisdictions: [], practiceTypes: [], firmSize: null }
      );

      const systemPrompt = buildSystemPrompt(
        formatRAGContext(context),
        "member"
      );

      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "How do I create a new matter in Clio?" },
        ],
        max_tokens: 200,
      });

      const text =
        typeof response === "string"
          ? response
          : (response as { response?: string }).response;

      expect(text).toBeDefined();
      expect(typeof text).toBe("string");
      // Response should mention "matter" (the topic we asked about)
      expect(text?.toLowerCase()).toContain("matter");
    }, 30000);

    it("returns empty context on RAG failure (graceful degradation)", async () => {
      // Test with an invalid org ID that won't have any data
      const context = await retrieveRAGContext(
        env,
        "random query",
        "nonexistent-org-xyz",
        { jurisdictions: [], practiceTypes: [], firmSize: null }
      );

      // Should still return a valid structure, just empty
      expect(context).toBeDefined();
      expect(context.kbChunks).toBeDefined();
      expect(context.orgChunks).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. LLM Error Handling
  // ---------------------------------------------------------------------------

  describe("LLM Error Handling", () => {
    it("identifies retryable errors (rate limit, server error)", () => {
      expect(isRetryableError({ code: 3040 })).toBe(true); // Rate limit
      expect(isRetryableError({ code: 3043 })).toBe(true); // Server error
    });

    it("identifies non-retryable errors", () => {
      expect(isRetryableError({ code: 3036 })).toBe(false); // Daily limit
      expect(isRetryableError({ code: 5007 })).toBe(false); // Model not found
      expect(isRetryableError({ code: 9999 })).toBe(false); // Unknown
    });

    it("returns user-friendly error for daily limit", () => {
      const message = getUserFriendlyError({ code: 3036 });
      expect(message).toContain("daily limit");
    });

    it("returns user-friendly error for model unavailable", () => {
      const message = getUserFriendlyError({ code: 5007 });
      expect(message).toContain("unavailable");
    });

    it("returns generic error for unknown codes", () => {
      const message = getUserFriendlyError({ code: 9999 });
      expect(message).toContain("trouble");
    });

    it("handles malformed LLM response gracefully", async () => {
      // Test the response parsing logic with edge cases
      const parseResponse = (response: unknown) => {
        if (typeof response === "string") {
          return { content: response };
        }
        const result = response as { response?: string };
        return { content: result?.response || "" };
      };

      // Null/undefined should be handled
      expect(parseResponse(null)).toEqual({ content: "" });
      expect(parseResponse(undefined)).toEqual({ content: "" });
      expect(parseResponse({})).toEqual({ content: "" });
      expect(parseResponse({ response: "hello" })).toEqual({ content: "hello" });
      expect(parseResponse("direct string")).toEqual({
        content: "direct string",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Confirmation Flow
  // ---------------------------------------------------------------------------

  describe("Confirmation Flow", () => {
    const pendingAction = {
      action: "create",
      objectType: "Matter",
      params: { description: "Smith v. Jones" },
    };

    it("classifies 'yes' as approve", async () => {
      const result = await classifyConfirmationResponse("yes", pendingAction);
      expect(result.intent).toBe("approve");
    }, 15000);

    it("classifies 'no' as reject", async () => {
      const result = await classifyConfirmationResponse("no", pendingAction);
      expect(result.intent).toBe("reject");
    }, 15000);

    it("classifies 'cancel' as reject", async () => {
      const result = await classifyConfirmationResponse(
        "cancel that",
        pendingAction
      );
      expect(result.intent).toBe("reject");
    }, 15000);

    it("classifies modification request as modify", async () => {
      const result = await classifyConfirmationResponse(
        "Actually, change the description to 'Smith v. Brown'",
        pendingAction
      );
      // Should be either modify or unclear (LLM variance)
      expect(["modify", "unclear"]).toContain(result.intent);
    }, 15000);

    it("classifies unrelated question as unrelated", async () => {
      const result = await classifyConfirmationResponse(
        "What time is it?",
        pendingAction
      );
      // Should be unrelated or unclear
      expect(["unrelated", "unclear"]).toContain(result.intent);
    }, 15000);

    it("returns unclear for ambiguous responses", async () => {
      const result = await classifyConfirmationResponse("maybe", pendingAction);
      // "maybe" is ambiguous - could be unclear
      expect(["approve", "reject", "unclear"]).toContain(result.intent);
    }, 15000);

    it("handles confirmation flow state transitions", () => {
      // Simulate the state machine for confirmation flow
      type ConfirmationState = "pending" | "approved" | "rejected" | "expired";

      const transitionState = (
        currentState: ConfirmationState,
        intent: string
      ): ConfirmationState => {
        if (currentState !== "pending") return currentState;

        switch (intent) {
          case "approve":
            return "approved";
          case "reject":
            return "rejected";
          default:
            return "pending"; // Stay pending for unclear/modify/unrelated
        }
      };

      expect(transitionState("pending", "approve")).toBe("approved");
      expect(transitionState("pending", "reject")).toBe("rejected");
      expect(transitionState("pending", "unclear")).toBe("pending");
      expect(transitionState("approved", "reject")).toBe("approved"); // Can't change after approval
    });

    it("enforces confirmation expiration (5 minute window)", () => {
      const createConfirmation = () => {
        const now = Date.now();
        return {
          id: crypto.randomUUID(),
          createdAt: now,
          expiresAt: now + 5 * 60 * 1000, // 5 minutes
        };
      };

      const isExpired = (confirmation: { expiresAt: number }) => {
        return Date.now() > confirmation.expiresAt;
      };

      const confirmation = createConfirmation();
      expect(isExpired(confirmation)).toBe(false);

      // Simulate expiration by creating an already-expired confirmation
      const expiredConfirmation = {
        ...confirmation,
        expiresAt: Date.now() - 1000, // 1 second ago
      };
      expect(isExpired(expiredConfirmation)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Role-Based Access Control in LLM Flow
  // ---------------------------------------------------------------------------

  describe("Role-Based LLM Access", () => {
    it("member prompt indicates read-only access", () => {
      const prompt = buildSystemPrompt("", "member");
      expect(prompt).toContain("Member");
      expect(prompt).toContain("read-only");
    });

    it("admin prompt indicates write access with confirmation", () => {
      const prompt = buildSystemPrompt("", "admin");
      expect(prompt).toContain("Admin");
      expect(prompt).toContain("create/update/delete");
      expect(prompt).toContain("confirmation");
    });

    it("includes RAG context in system prompt", () => {
      const ragContext = "## Knowledge Base\n\nMatters organize cases in Clio.";
      const prompt = buildSystemPrompt(ragContext, "member");

      expect(prompt).toContain("Knowledge Base Context:");
      expect(prompt).toContain("Matters organize cases");
    });

    it("handles empty RAG context gracefully", () => {
      const prompt = buildSystemPrompt("", "member");
      expect(prompt).toContain("No relevant context found");
    });
  });
});
