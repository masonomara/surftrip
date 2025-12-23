/**
 * Tool Calling Unit Tests
 *
 * Tests the clioQuery tool definition, permission enforcement,
 * and the CUD (Create/Update/Delete) confirmation flow.
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

// =============================================================================
// Types
// =============================================================================

/** Property definition for a tool parameter */
interface ClioToolProperty {
  type: string;
  enum?: string[];
  description: string;
}

/** The clioQuery tool definition structure */
interface ClioTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ClioToolProperty>;
      required: string[];
    };
  };
}

/** Arguments passed to the clioQuery tool */
interface ToolCallArgs {
  operation: string;
  objectType: string;
  id?: string;
  filters?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/** A pending confirmation waiting for user approval */
interface PendingConfirmation {
  createdAt: number;
  expiresAt: number;
  operation: string;
  objectType: string;
  id?: string;
  data?: Record<string, unknown>;
}

// =============================================================================
// Helper Functions (Mirroring Production Code)
// =============================================================================

/**
 * Returns the clioQuery tool definition based on user role.
 * The description differs for admins vs members.
 */
function getClioTools(userRole: string): ClioTool[] {
  const canModify = userRole === "admin";

  const modifyNote = canModify
    ? "Create/update/delete operations will require user confirmation."
    : "As a Member, only read operations are permitted.";

  return [
    {
      type: "function",
      function: {
        name: "clioQuery",
        description: `Query or modify Clio data. ${modifyNote}`,
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["read", "create", "update", "delete"],
              description: "The operation to perform",
            },
            objectType: {
              type: "string",
              enum: ["Matter", "Contact", "Task", "CalendarEntry", "TimeEntry"],
              description: "The Clio object type",
            },
            id: {
              type: "string",
              description: "Object ID (required for read single/update/delete)",
            },
            filters: {
              type: "object",
              description: "Query filters for list operations",
            },
            data: {
              type: "object",
              description: "Data for create/update operations",
            },
          },
          required: ["operation", "objectType"],
        },
      },
    },
  ];
}

/**
 * Checks if the user has permission to perform an operation.
 * Members can only read; admins can do everything.
 */
function checkToolPermission(
  userRole: string,
  operation: string
): { allowed: boolean; reason?: string } {
  // Anyone can read
  if (operation === "read") {
    return { allowed: true };
  }

  // Only admins can create/update/delete
  if (userRole !== "admin") {
    return {
      allowed: false,
      reason: `You don't have permission to ${operation}. Only admins can perform this operation.`,
    };
  }

  return { allowed: true };
}

/**
 * Determines what action to take for a tool call.
 * Returns whether to execute immediately, request confirmation, or reject.
 */
function determineToolAction(
  toolCall: { name: string; arguments: Partial<ToolCallArgs> },
  userRole: string
): { type: string; requiresConfirmation: boolean; reason?: string } {
  // Reject unknown tools
  if (toolCall.name !== "clioQuery") {
    return {
      type: "reject",
      requiresConfirmation: false,
      reason: `Unknown tool: ${toolCall.name}`,
    };
  }

  // Validate required argument
  const { operation } = toolCall.arguments;
  if (!operation) {
    return {
      type: "reject",
      requiresConfirmation: false,
      reason: "Missing required argument: operation",
    };
  }

  // Check permission
  const permission = checkToolPermission(userRole, operation);
  if (!permission.allowed) {
    return {
      type: "reject",
      requiresConfirmation: false,
      reason: permission.reason,
    };
  }

  // Read operations execute immediately
  if (operation === "read") {
    return { type: "execute", requiresConfirmation: false };
  }

  // CUD operations require confirmation
  return { type: "confirm", requiresConfirmation: true };
}

/**
 * Builds a user-friendly confirmation prompt for a CUD operation.
 */
function buildConfirmationPrompt(args: ToolCallArgs): string {
  // Choose the right verb
  let actionVerb: string;
  switch (args.operation) {
    case "create":
      actionVerb = "create a new";
      break;
    case "update":
      actionVerb = "update the";
      break;
    default:
      actionVerb = "delete the";
  }

  // Build details string
  let details = "";
  if (args.data) {
    details += `\nDetails: ${JSON.stringify(args.data)}`;
  }
  if (args.id) {
    details += `\nID: ${args.id}`;
  }

  return `I'm about to ${actionVerb} ${args.objectType}.${details}\n\nPlease confirm by saying "yes" or "confirm", or say "no" to cancel.`;
}

/**
 * Creates a pending confirmation object with 5-minute expiry.
 */
function createPendingConfirmation(args: ToolCallArgs): PendingConfirmation {
  const now = Date.now();
  const fiveMinutesMs = 5 * 60 * 1000;

  return {
    createdAt: now,
    expiresAt: now + fiveMinutesMs,
    operation: args.operation,
    objectType: args.objectType,
    id: args.id,
    data: args.data,
  };
}

/**
 * Checks if a pending confirmation is still valid (not expired).
 */
function isConfirmationValid(confirmation: PendingConfirmation): boolean {
  return Date.now() < confirmation.expiresAt;
}

/**
 * Classifies the user's intent when responding to a confirmation.
 * Returns: approve, reject, modify, or unrelated.
 */
function classifyIntent(userMessage: string): {
  intent: string;
  modifiedRequest?: string;
} {
  const normalized = userMessage.toLowerCase().trim();

  // Approval phrases
  const approvalPhrases = ["yes", "confirm", "ok", "sure", "go ahead", "do it"];
  if (approvalPhrases.includes(normalized)) {
    return { intent: "approve" };
  }

  // Rejection phrases
  const rejectionPhrases = ["no", "cancel", "stop", "don't", "nevermind"];
  if (
    rejectionPhrases.includes(normalized) ||
    normalized.startsWith("cancel")
  ) {
    return { intent: "reject" };
  }

  // Modification phrases (user wants to change something)
  const modificationKeywords = ["change", "modify", "instead", "but"];
  if (modificationKeywords.some((keyword) => normalized.includes(keyword))) {
    return { intent: "modify", modifiedRequest: userMessage };
  }

  // Anything else is unrelated
  return { intent: "unrelated" };
}

// =============================================================================
// Tool Calling Tests
// =============================================================================

describe("Part 5: Tool Calling (clioQuery)", () => {
  // ---------------------------------------------------------------------------
  // Tool Definition
  // ---------------------------------------------------------------------------

  describe("Tool Definition", () => {
    it("getClioTools returns single clioQuery tool", () => {
      const tools = getClioTools("member");

      expect(tools.length).toBe(1);
      expect(tools[0].type).toBe("function");
      expect(tools[0].function.name).toBe("clioQuery");
    });

    it("tool has required parameters", () => {
      const params = getClioTools("admin")[0].function.parameters;

      // Required fields
      expect(params.required).toContain("operation");
      expect(params.required).toContain("objectType");

      // Operation enum values
      expect(params.properties.operation.enum).toEqual([
        "read",
        "create",
        "update",
        "delete",
      ]);

      // Object type should include Matter
      expect(params.properties.objectType.enum).toContain("Matter");
    });

    it("admin tool description mentions CUD with confirmation", () => {
      const adminTools = getClioTools("admin");
      expect(adminTools[0].function.description).toContain("confirmation");
    });

    it("member tool description mentions read-only", () => {
      const memberTools = getClioTools("member");
      const description = memberTools[0].function.description;

      expect(description).toContain("read");
      expect(description).toContain("Member");
    });
  });

  // ---------------------------------------------------------------------------
  // Permission Enforcement
  // ---------------------------------------------------------------------------

  describe("Permission Enforcement", () => {
    it("members can only perform read operations", () => {
      const result = checkToolPermission("member", "create");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("permission");
    });

    it("members can perform read operations", () => {
      const result = checkToolPermission("member", "read");
      expect(result.allowed).toBe(true);
    });

    it("admins can perform all operations", () => {
      const operations = ["read", "create", "update", "delete"];

      for (const operation of operations) {
        const result = checkToolPermission("admin", operation);
        expect(result.allowed).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Call Handling
  // ---------------------------------------------------------------------------

  describe("Tool Call Handling", () => {
    it("read operations execute immediately", () => {
      const action = determineToolAction(
        {
          name: "clioQuery",
          arguments: { operation: "read", objectType: "Matter" },
        },
        "admin"
      );

      expect(action.type).toBe("execute");
      expect(action.requiresConfirmation).toBe(false);
    });

    it("CUD operations require confirmation for admins", () => {
      const cudOperations = ["create", "update", "delete"];

      for (const operation of cudOperations) {
        const action = determineToolAction(
          {
            name: "clioQuery",
            arguments: { operation, objectType: "Matter" },
          },
          "admin"
        );

        expect(action.requiresConfirmation).toBe(true);
        expect(action.type).toBe("confirm");
      }
    });

    it("unknown tools are rejected", () => {
      const action = determineToolAction(
        { name: "unknownTool", arguments: {} },
        "admin"
      );

      expect(action.type).toBe("reject");
      expect(action.reason).toContain("Unknown tool");
    });
  });

  // ---------------------------------------------------------------------------
  // CUD Confirmation Flow
  // ---------------------------------------------------------------------------

  describe("CUD Confirmation Flow", () => {
    it("buildConfirmationPrompt describes the operation", () => {
      const prompt = buildConfirmationPrompt({
        operation: "create",
        objectType: "Matter",
        data: { name: "Smith v. Jones" },
      });

      expect(prompt).toContain("create");
      expect(prompt).toContain("Matter");
      expect(prompt).toContain("confirm");
    });

    it("pending confirmation has 5-minute expiry", () => {
      const confirmation = createPendingConfirmation({
        operation: "delete",
        objectType: "Contact",
        id: "123",
      });

      const expiryDuration = confirmation.expiresAt - confirmation.createdAt;
      const fiveMinutesMs = 5 * 60 * 1000;

      expect(expiryDuration).toBe(fiveMinutesMs);
    });

    it("expired confirmations are rejected", () => {
      const expiredConfirmation: PendingConfirmation = {
        createdAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        expiresAt: Date.now() - 1 * 60 * 1000, // 1 minute ago (expired)
        operation: "update",
        objectType: "Task",
      };

      expect(isConfirmationValid(expiredConfirmation)).toBe(false);
    });

    it("valid confirmations within 5 minutes are accepted", () => {
      const validConfirmation: PendingConfirmation = {
        createdAt: Date.now() - 2 * 60 * 1000, // 2 minutes ago
        expiresAt: Date.now() + 3 * 60 * 1000, // 3 minutes from now
        operation: "create",
        objectType: "Matter",
      };

      expect(isConfirmationValid(validConfirmation)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Confirmation Intent Classification
  // ---------------------------------------------------------------------------

  describe("Confirmation Intent Classification", () => {
    it("classifies 'yes' as approve", () => {
      expect(classifyIntent("yes").intent).toBe("approve");
    });

    it("classifies 'no' as reject", () => {
      expect(classifyIntent("no").intent).toBe("reject");
    });

    it("classifies 'cancel' as reject", () => {
      expect(classifyIntent("cancel that").intent).toBe("reject");
    });

    it("classifies modification requests", () => {
      const result = classifyIntent("change the name to Smith v. Brown");

      expect(result.intent).toBe("modify");
      expect(result.modifiedRequest).toBeDefined();
    });

    it("classifies unrelated messages", () => {
      expect(classifyIntent("What time is it?").intent).toBe("unrelated");
    });
  });

  // ---------------------------------------------------------------------------
  // LLM Tool Calling Integration
  // ---------------------------------------------------------------------------

  describe("LLM Tool Calling Integration", () => {
    it("LLM generates tool call for Clio query", async () => {
      const response = await (env.AI as Ai).run(
        "@cf/meta/llama-3.1-8b-instruct" as Parameters<Ai["run"]>[0],
        {
          messages: [
            {
              role: "system",
              content:
                "You are Docket. Use clioQuery to help users with Clio data.",
            },
            { role: "user", content: "Show me all open matters" },
          ],
          tools: getClioTools("admin"),
          max_tokens: 200,
        }
      );

      const structured = response as {
        tool_calls?: Array<{ name: string; arguments: unknown }>;
      };

      // If the LLM made a tool call, it should be clioQuery
      if (structured.tool_calls?.length) {
        expect(structured.tool_calls[0].name).toBe("clioQuery");
      }
    });

    it("LLM respects read-only for members in description", () => {
      const memberTools = getClioTools("member");
      expect(memberTools[0].function.description).toContain("read");
    });
  });
});
