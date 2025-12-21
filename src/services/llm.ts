/**
 * LLM Service
 *
 * Handles Workers AI inference for message processing.
 * Uses Llama 3.1 8B Instruct with a single clioQuery tool.
 */

import type { Env } from "../index";

// ============================================================================
// Types
// ============================================================================

export interface ClioQueryParams {
  object_type: string;
  operation: "read" | "create" | "update" | "delete";
  id?: number;
  params?: Record<string, unknown>;
  fields?: string[];
}

export interface ToolCall {
  name: "clioQuery";
  arguments: ClioQueryParams;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  text: string | null;
  toolCall: ToolCall | null;
  finishReason: string;
}

export interface ConfirmationClassification {
  intent: "approve" | "reject" | "modify" | "unrelated";
  modifications?: Record<string, unknown>;
}

export interface PendingOperation {
  id: string;
  action: string;
  objectType: string;
  params: Record<string, unknown>;
  description?: string;
}

// Error codes from Workers AI
const RETRYABLE_ERRORS = [3040, 3043]; // Capacity exceeded, internal error
const DAILY_LIMIT_ERROR = 3036;
const MODEL_NOT_FOUND_ERROR = 5007;

// ============================================================================
// Tool Definition
// ============================================================================

const CLIO_QUERY_TOOL = {
  type: "function" as const,
  function: {
    name: "clioQuery",
    description:
      "Query or modify Clio case management data. Use for reading matters, contacts, tasks, calendar entries, time entries, and documents. For create/update/delete operations, the system will ask for user confirmation first.",
    parameters: {
      type: "object",
      properties: {
        object_type: {
          type: "string",
          enum: [
            "matters",
            "contacts",
            "tasks",
            "calendar_entries",
            "time_entries",
            "documents",
            "practice_areas",
            "activity_descriptions",
            "users",
          ],
          description: "The Clio object type to query",
        },
        operation: {
          type: "string",
          enum: ["read", "create", "update", "delete"],
          description: "The operation to perform",
        },
        id: {
          type: "number",
          description: "The ID of the record (required for read single, update, delete)",
        },
        params: {
          type: "object",
          description:
            "Query parameters for read (filters, pagination) or data for create/update",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Specific fields to return (for read operations)",
        },
      },
      required: ["object_type", "operation"],
    },
  },
};

// ============================================================================
// System Prompt
// ============================================================================

const BASE_SYSTEM_PROMPT = `You are Docket, a case management assistant for legal teams using Clio.

**Tone:** Helpful, competent, deferential. You assist—you don't lead.

**Instructions:**
- Use the Knowledge Base and Firm Context for case management best practices
- Query Clio using the clioQuery tool when users ask about their data
- For write operations (create, update, delete), the system will ask for confirmation first
- NEVER give legal advice—you manage cases, not law
- Stay in scope: case management, Clio operations, firm procedures
- Be concise and direct in your responses`;

export function buildSystemPrompt(
  kbContext: string,
  orgContext: string,
  clioSchema: string
): string {
  const sections: string[] = [BASE_SYSTEM_PROMPT];

  if (kbContext) {
    sections.push(`\n**Knowledge Base Context:**\n${kbContext}`);
  }

  if (orgContext) {
    sections.push(`\n**Firm Context (This Firm's Practices):**\n${orgContext}`);
  }

  if (clioSchema) {
    sections.push(`\n**Clio Schema Reference:**\n${clioSchema}`);
  }

  return sections.join("\n");
}

// ============================================================================
// Message Formatting
// ============================================================================

export function formatMessagesForLLM(
  systemPrompt: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  currentMessage: string
): LLMMessage[] {
  const messages: LLMMessage[] = [{ role: "system", content: systemPrompt }];

  // Add conversation history (already limited to 15 messages by caller)
  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current user message
  messages.push({ role: "user", content: currentMessage });

  return messages;
}

// ============================================================================
// Confirmation Prompt
// ============================================================================

const CONFIRMATION_SYSTEM_PROMPT = `You are classifying a user's response to a pending Clio operation confirmation.

The user was asked to confirm this operation:
{PENDING_OPERATION}

Classify their response as one of:
- "approve": They confirm (yes, do it, looks good, proceed, ok, sure)
- "reject": They decline (no, cancel, nevermind, don't do that)
- "modify": They want changes (yes but change X, make it Y instead)
- "unrelated": Different topic, ignoring the pending operation

Respond with ONLY a JSON object:
{"intent": "approve|reject|modify|unrelated", "modifications": {...}}

Include "modifications" only for "modify" intent with the requested changes.`;

export function buildConfirmationPrompt(pending: PendingOperation): string {
  const description =
    pending.description ||
    `${pending.action} ${pending.objectType} with params: ${JSON.stringify(pending.params)}`;

  return CONFIRMATION_SYSTEM_PROMPT.replace("{PENDING_OPERATION}", description);
}

// ============================================================================
// LLM Inference
// ============================================================================

export async function runLLMInference(
  env: Env,
  messages: LLMMessage[],
  options: {
    useTools?: boolean;
    maxTokens?: number;
  } = {}
): Promise<LLMResponse> {
  const { useTools = true, maxTokens = 1024 } = options;

  const requestBody: {
    messages: LLMMessage[];
    max_tokens: number;
    tools?: typeof CLIO_QUERY_TOOL[];
  } = {
    messages,
    max_tokens: maxTokens,
  };

  if (useTools) {
    requestBody.tools = [CLIO_QUERY_TOOL];
  }

  let retries = 0;
  const maxRetries = 1;

  while (retries <= maxRetries) {
    try {
      // Cast model name to satisfy TypeScript - model is valid at runtime
      const response = (await env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct" as Parameters<typeof env.AI.run>[0],
        requestBody
      )) as {
        response?: string;
        tool_calls?: Array<{
          name: string;
          arguments: Record<string, unknown>;
        }>;
      };

      // Check for tool call
      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolCall = response.tool_calls[0];
        if (toolCall.name === "clioQuery") {
          const args = toolCall.arguments as {
            object_type: string;
            operation: "read" | "create" | "update" | "delete";
            id?: number;
            params?: Record<string, unknown>;
            fields?: string[];
          };
          return {
            text: null,
            toolCall: {
              name: "clioQuery",
              arguments: args,
            },
            finishReason: "tool_calls",
          };
        }
      }

      // Text response
      return {
        text: response.response || "",
        toolCall: null,
        finishReason: "stop",
      };
    } catch (error) {
      const errorCode = extractErrorCode(error);

      // Check for retryable errors
      if (RETRYABLE_ERRORS.includes(errorCode) && retries < maxRetries) {
        retries++;
        await sleep(1000); // Wait 1s before retry
        continue;
      }

      // Daily limit - fail with user message
      if (errorCode === DAILY_LIMIT_ERROR) {
        return {
          text: "I've reached my daily processing limit. Please try again tomorrow.",
          toolCall: null,
          finishReason: "error",
        };
      }

      // Model not found - log and fail
      if (errorCode === MODEL_NOT_FOUND_ERROR) {
        console.error("[LLM] Model not found:", error);
        return {
          text: "I'm having trouble processing your request. Please try again later.",
          toolCall: null,
          finishReason: "error",
        };
      }

      // Other errors - fail gracefully
      console.error("[LLM] Inference error:", error);
      return {
        text: "I'm having trouble connecting. Please try again in a moment.",
        toolCall: null,
        finishReason: "error",
      };
    }
  }

  // Should not reach here, but handle just in case
  return {
    text: "I'm having trouble processing your request. Please try again.",
    toolCall: null,
    finishReason: "error",
  };
}

// ============================================================================
// Confirmation Classification
// ============================================================================

export async function classifyConfirmationResponse(
  env: Env,
  userMessage: string,
  pending: PendingOperation
): Promise<ConfirmationClassification> {
  const systemPrompt = buildConfirmationPrompt(pending);

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  try {
    const response = await runLLMInference(env, messages, {
      useTools: false,
      maxTokens: 256,
    });

    if (response.text) {
      // Parse JSON response
      const jsonMatch = response.text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ConfirmationClassification;
        if (
          ["approve", "reject", "modify", "unrelated"].includes(parsed.intent)
        ) {
          return parsed;
        }
      }
    }
  } catch (error) {
    console.error("[LLM] Confirmation classification error:", error);
  }

  // Default to unrelated if parsing fails
  return { intent: "unrelated" };
}

// ============================================================================
// CUD Operation Description
// ============================================================================

export function buildOperationDescription(
  action: string,
  objectType: string,
  params: Record<string, unknown>
): string {
  const actionVerb = {
    create: "Create",
    update: "Update",
    delete: "Delete",
  }[action] || action;

  const objectName = objectType.replace(/_/g, " ").replace(/s$/, "");

  // Build human-readable description
  const details: string[] = [];

  if (action === "delete" && params.id) {
    return `${actionVerb} ${objectName} #${params.id}`;
  }

  if (params.id) {
    details.push(`#${params.id}`);
  }

  // Extract key fields for description
  const keyFields = ["description", "subject", "name", "display_number"];
  for (const field of keyFields) {
    if (params[field]) {
      details.push(`"${params[field]}"`);
      break;
    }
  }

  if (params.matter_id) {
    details.push(`for matter #${params.matter_id}`);
  }

  if (params.contact_id) {
    details.push(`for contact #${params.contact_id}`);
  }

  if (params.date || params.start_at) {
    const date = (params.date || params.start_at) as string;
    details.push(`on ${date.split("T")[0]}`);
  }

  return `${actionVerb} ${objectName}${details.length ? ": " + details.join(" ") : ""}`;
}

// ============================================================================
// Helpers
// ============================================================================

function extractErrorCode(error: unknown): number {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: number }).code;
  }
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
