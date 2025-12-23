// =============================================================================
// Docket Worker - Main Entry Point
// =============================================================================
//
// This is the main Cloudflare Worker for the Docket case management assistant.
// It handles:
// - Incoming messages from Teams/Slack
// - OAuth flow for Clio integration
// - Demo page for testing Clio integration
//
// All per-organization state is stored in TenantDO (Durable Object).

import { DurableObject } from "cloudflare:workers";
import { getAuth } from "./lib/auth";
import { AuditEntryInputSchema, type AuditEntryInput } from "./types/requests";
import {
  ChannelMessageSchema,
  type ChannelMessage,
  type PendingConfirmation,
  type LLMResponse,
  type ToolCall,
} from "./types";
import { retrieveRAGContext, formatRAGContext } from "./services/rag-retrieval";
import {
  fetchAllSchemas,
  CLIO_SCHEMA_VERSION,
  schemaNeedsRefresh,
} from "./services/clio-schema";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  verifyState,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  storeClioTokens,
  getClioTokens,
  deleteClioTokens,
  tokenNeedsRefresh,
  refreshAccessToken,
  type ClioTokens,
} from "./services/clio-oauth";
import {
  executeClioCall,
  buildReadQuery,
  buildCreateBody,
  buildUpdateBody,
  buildDeleteEndpoint,
  formatClioResponse,
} from "./services/clio-api";
import { renderClioDemo, type DemoState } from "./demo/clio-demo";
import type { Env } from "./types/env";

export type { Env };

// =============================================================================
// Tenant Durable Object
// =============================================================================
//
// Each organization gets its own TenantDO instance, providing:
// - Complete data isolation between organizations
// - Per-org conversation history
// - Per-org Clio token storage
// - Per-org schema cache

export class TenantDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private orgId: string;
  private schemaCache: Map<string, object> = new Map();
  private schemaVersion: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.orgId = ctx.id.toString();

    // Initialize on first access (runs once)
    ctx.blockConcurrencyWhile(async () => {
      await this.runMigrations();
      await this.loadSchemaCache();
      await this.ensureAlarmIsSet();
    });
  }

  // ===========================================================================
  // Request Router
  // ===========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        // Core functionality
        case "/process-message":
          return this.handleProcessMessage(request);
        case "/audit":
          return this.handleAudit(request);

        // Schema management
        case "/refresh-schema":
          return this.handleRefreshSchema(request);
        case "/provision-schema":
          return this.handleProvisionSchema(request);
        case "/force-schema-refresh":
          return this.handleForceSchemaRefresh(request);

        // User/org management
        case "/remove-user":
          return this.handleRemoveUser(request);
        case "/delete-org":
          return this.handleDeleteOrg(request);
        case "/purge-user-data":
          return this.handlePurgeUserData(request);

        // Clio token management
        case "/store-clio-token":
          return this.handleStoreClioToken(request);

        // Demo endpoints
        case "/demo-status":
          return this.handleDemoStatus(request);
        case "/demo-disconnect":
          return this.handleDemoDisconnect(request);
        case "/demo-refresh-token":
          return this.handleDemoRefreshToken(request);
        case "/demo-test-api":
          return this.handleDemoTestApi(request);

        default:
          return Response.json({ error: "Not found" }, { status: 404 });
      }
    } catch (error) {
      console.error(`[TenantDO:${this.orgId}] Error:`, error);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  }

  // ===========================================================================
  // Message Processing
  // ===========================================================================

  private async handleProcessMessage(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // Validate message format
    const body = await request.json();
    const parseResult = ChannelMessageSchema.safeParse(body);

    if (!parseResult.success) {
      return Response.json(
        { error: "Invalid message format", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const message = parseResult.data;

    // Verify organization matches
    if (message.orgId !== this.orgId) {
      return Response.json({ error: "Organization mismatch" }, { status: 403 });
    }

    // Ensure conversation exists in DB
    await this.ensureConversationExists(message);

    // Check if there's a pending confirmation waiting for response
    const pendingConfirmation = await this.claimPendingConfirmation(
      message.conversationId,
      message.userId
    );

    // Store user message
    await this.storeMessage(message.conversationId, {
      role: "user",
      content: message.message,
      userId: message.userId,
    });

    // Generate response (either handle confirmation or new query)
    const response = pendingConfirmation
      ? await this.handleConfirmationResponse(message, pendingConfirmation)
      : await this.generateAssistantResponse(message);

    // Store assistant response
    await this.storeMessage(message.conversationId, {
      role: "assistant",
      content: response,
      userId: null,
    });

    return Response.json({ response });
  }

  // ===========================================================================
  // LLM Response Generation
  // ===========================================================================

  private async generateAssistantResponse(
    message: ChannelMessage
  ): Promise<string> {
    // Retrieve relevant context from knowledge base
    const ragContext = await retrieveRAGContext(
      this.env,
      message.message,
      this.orgId,
      {
        jurisdictions: message.jurisdictions,
        practiceTypes: message.practiceTypes,
        firmSize: message.firmSize,
      }
    );

    // Get conversation history
    const conversationHistory = await this.getRecentMessages(
      message.conversationId
    );

    // Build system prompt with context
    const systemPrompt = this.buildSystemPrompt(
      formatRAGContext(ragContext),
      message.userRole
    );

    // Prepare messages for LLM
    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
    ];

    // Get available tools based on user role
    const tools = this.getClioTools(message.userRole);

    // Call LLM
    const llmResponse = await this.callLLM(messages, tools);

    // Handle tool calls if any
    if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
      return this.handleToolCalls(message, llmResponse.toolCalls);
    }

    return llmResponse.content;
  }

  private buildSystemPrompt(ragContext: string, userRole: string): string {
    // Format cached schemas for LLM context
    const schemaEntries = [...this.schemaCache].map(
      ([objectType, schema]) =>
        `### ${objectType}\n${JSON.stringify(schema, null, 2)}`
    );

    const roleNote =
      userRole === "admin"
        ? "This user is an Admin and can perform create/update/delete operations with confirmation."
        : "This user is a Member with read-only access to Clio.";

    const schemaSection =
      schemaEntries.length > 0
        ? schemaEntries.join("\n\n")
        : "Schema not yet loaded. User needs to connect Clio first.";

    return `You are Docket, a case management assistant for legal teams using Clio.

**Tone:** Helpful, competent, deferential. You assist—you don't lead.

**User Role:** ${userRole}
${roleNote}

**Knowledge Base Context:**
${ragContext || "No relevant context found."}

**Clio Schema Reference:**
${schemaSection}

**Instructions:**
- Use Knowledge Base and firm context for case management questions
- Query Clio using the clioQuery tool per the schema above
- For write operations (create, update, delete), always confirm first
- NEVER give legal advice—you manage cases, not law
- Stay in scope: case management, Clio operations, firm procedures
- If Clio is not connected, guide user to connect at docket.com/settings`;
  }

  private async callLLM(
    messages: Array<{ role: string; content: string }>,
    tools?: object[],
    isRetry = false
  ): Promise<LLMResponse> {
    try {
      const response = await (this.env.AI.run as Function)(
        "@cf/meta/llama-3.1-8b-instruct",
        {
          messages,
          tools: tools && tools.length > 0 ? tools : undefined,
          max_tokens: 2000,
        }
      );

      // Handle string response
      if (typeof response === "string") {
        return { content: response };
      }

      // Handle object response
      const result = response as {
        response?: string;
        tool_calls?: Array<{
          name: string;
          arguments: string | Record<string, unknown>;
        }>;
      };

      if (!result || typeof result !== "object") {
        return {
          content: "I couldn't process that response. Please try again.",
        };
      }

      // Parse tool calls if present
      let toolCalls: ToolCall[] | undefined;

      if (result.tool_calls && result.tool_calls.length > 0) {
        toolCalls = [];

        for (const tc of result.tool_calls) {
          if (!tc.name) continue;

          try {
            const args =
              typeof tc.arguments === "string"
                ? JSON.parse(tc.arguments)
                : tc.arguments ?? {};

            toolCalls.push({ name: tc.name, arguments: args });
          } catch {
            console.error(
              `[TenantDO:${this.orgId}] Failed to parse tool arguments for ${tc.name}`
            );
          }
        }

        if (toolCalls.length === 0) {
          toolCalls = undefined;
        }
      }

      return {
        content: typeof result.response === "string" ? result.response : "",
        toolCalls,
      };
    } catch (error) {
      const errorCode = (error as { code?: number }).code;

      // Retry on transient errors
      if (!isRetry && (errorCode === 3040 || errorCode === 3043)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.callLLM(messages, tools, true);
      }

      // Handle specific error codes
      if (errorCode === 3036) {
        return {
          content: "I've reached my daily limit. Please try again tomorrow.",
        };
      }

      if (errorCode === 5007) {
        return {
          content:
            "I'm experiencing a configuration issue. Please contact support.",
        };
      }

      return {
        content:
          "I'm having trouble processing your request right now. Please try again in a moment.",
      };
    }
  }

  // ===========================================================================
  // Clio Tool Definitions
  // ===========================================================================

  private getClioTools(userRole: string): object[] {
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
                enum: [
                  "Matter",
                  "Contact",
                  "Task",
                  "CalendarEntry",
                  "TimeEntry",
                ],
                description: "The Clio object type",
              },
              id: {
                type: "string",
                description:
                  "Object ID (required for read single/update/delete)",
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

  // ===========================================================================
  // Tool Call Handling
  // ===========================================================================

  private async handleToolCalls(
    message: ChannelMessage,
    toolCalls: ToolCall[]
  ): Promise<string> {
    const results: string[] = [];

    for (const toolCall of toolCalls) {
      // Only handle clioQuery tool
      if (toolCall.name !== "clioQuery") {
        results.push(`Unknown tool: ${toolCall.name}`);
        continue;
      }

      const args = toolCall.arguments;

      // Check permissions for write operations
      if (args.operation !== "read" && message.userRole !== "admin") {
        results.push(
          `You don't have permission to ${args.operation} ${args.objectType}s. Only Admins can make changes.`
        );
        continue;
      }

      // Handle read operations immediately
      if (args.operation === "read") {
        const readResult = await this.executeClioRead(message.userId, args);
        results.push(readResult);
        continue;
      }

      // For write operations, create a pending confirmation
      await this.createPendingConfirmation(
        message.conversationId,
        message.userId,
        args.operation,
        args.objectType,
        args.data || {}
      );

      const operationDescription = this.describeOperation(args);
      results.push(
        `I'd like to ${operationDescription}.\n\n` +
          `**Please confirm:**\n` +
          `- Reply 'yes' to proceed\n` +
          `- Reply 'no' to cancel\n` +
          `- Or describe any changes you'd like\n\n` +
          `*This request expires in 5 minutes.*`
      );
    }

    return results.join("\n\n");
  }

  private describeOperation(args: ToolCall["arguments"]): string {
    const verbMap: Record<string, string> = {
      create: "create a new",
      update: "update the",
      delete: "delete the",
      read: "query",
    };

    const verb = verbMap[args.operation] || args.operation;
    const objectName = args.objectType.toLowerCase();

    // Include preview of data if available
    if (args.data) {
      const dataEntries = Object.entries(args.data).slice(0, 3);
      const preview = dataEntries
        .map(([key, value]) => `${key}: "${value}"`)
        .join(", ");
      return `${verb} ${objectName} with ${preview}`;
    }

    if (args.id) {
      return `${verb} ${objectName} ${args.id}`;
    }

    return `${verb} ${objectName}`;
  }

  // ===========================================================================
  // Confirmation Flow
  // ===========================================================================

  private async handleConfirmationResponse(
    message: ChannelMessage,
    confirmation: PendingConfirmation
  ): Promise<string> {
    // Use LLM to classify the user's response
    const classification = await this.classifyConfirmationResponse(
      message.message,
      confirmation
    );

    switch (classification.intent) {
      case "approve":
        return this.executeConfirmedOperation(message.userId, confirmation);

      case "reject":
        return "Got it, I've cancelled that operation.";

      case "modify":
        // User wants to modify - regenerate response with their changes
        return this.generateAssistantResponse({
          ...message,
          message: classification.modifiedRequest || message.message,
        });

      case "unrelated":
        // User asked something else - restore confirmation and handle new query
        this.restorePendingConfirmation(
          message.conversationId,
          message.userId,
          confirmation
        );
        return this.generateAssistantResponse(message);

      default:
        // Unclear response - restore confirmation and ask for clarification
        this.restorePendingConfirmation(
          message.conversationId,
          message.userId,
          confirmation
        );
        return "I'm not sure if you want to proceed. Please reply 'yes' to confirm or 'no' to cancel.";
    }
  }

  private async classifyConfirmationResponse(
    userMessage: string,
    confirmation: PendingConfirmation
  ): Promise<{ intent: string; modifiedRequest?: string }> {
    const prompt = `A user was asked to confirm: ${confirmation.action} a ${
      confirmation.objectType
    } with: ${JSON.stringify(confirmation.params)}
The user responded: "${userMessage}"
Classify as ONE of: approve, reject, modify, unrelated
Respond with JSON: {"intent": "...", "modifiedRequest": "..."}
Only include modifiedRequest if intent is "modify".`;

    try {
      const response = await (this.env.AI.run as Function)(
        "@cf/meta/llama-3.1-8b-instruct",
        { prompt, max_tokens: 100 }
      );

      const text =
        typeof response === "string" ? response : response?.response ?? "";

      if (!text) {
        return { intent: "unclear" };
      }

      // Extract JSON from response
      const startIdx = text.indexOf("{");
      if (startIdx === -1) {
        return { intent: "unclear" };
      }

      // Find matching closing brace
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

      if (endIdx === -1) {
        return { intent: "unclear" };
      }

      // Parse and validate
      const parsed = JSON.parse(text.slice(startIdx, endIdx + 1)) as Record<
        string,
        unknown
      >;

      const validIntents = ["approve", "reject", "modify", "unrelated"];
      const intent =
        typeof parsed.intent === "string" &&
        validIntents.includes(parsed.intent)
          ? parsed.intent
          : "unclear";

      return {
        intent,
        modifiedRequest:
          intent === "modify" && typeof parsed.modifiedRequest === "string"
            ? parsed.modifiedRequest
            : undefined,
      };
    } catch (error) {
      console.error(`[TenantDO:${this.orgId}] Classification error:`, error);
      return { intent: "unclear" };
    }
  }

  private async executeConfirmedOperation(
    userId: string,
    confirmation: PendingConfirmation
  ): Promise<string> {
    try {
      const result = await this.executeClioCUD(
        userId,
        confirmation.action,
        confirmation.objectType,
        confirmation.params
      );

      // Log success
      await this.appendAuditLog({
        user_id: userId,
        action: confirmation.action,
        object_type: confirmation.objectType,
        params: confirmation.params,
        result: "success",
      });

      if (result.details) {
        return `Done! I've ${confirmation.action}d the ${confirmation.objectType}.\n\n${result.details}`;
      }

      return `Done! I've ${confirmation.action}d the ${confirmation.objectType}.`;
    } catch (error) {
      // Log failure
      await this.appendAuditLog({
        user_id: userId,
        action: confirmation.action,
        object_type: confirmation.objectType,
        params: confirmation.params,
        result: "error",
        error_message: String(error),
      });

      return `There was a problem: ${error}. The operation was not completed.`;
    }
  }

  // ===========================================================================
  // Clio API Operations
  // ===========================================================================

  private async executeClioRead(
    userId: string,
    args: { objectType: string; id?: string; filters?: Record<string, unknown> }
  ): Promise<string> {
    // Get valid access token
    const accessToken = await this.getValidClioToken(userId);

    if (!accessToken) {
      return "You haven't connected your Clio account yet. Please connect at docket.com/settings to enable Clio queries.";
    }

    // Refresh schema if needed
    if (schemaNeedsRefresh(this.schemaVersion)) {
      await this.refreshSchemaWithToken(accessToken);
    }

    try {
      const endpoint = buildReadQuery(args.objectType, args.id, args.filters);
      const result = await executeClioCall("GET", endpoint, accessToken);

      // Handle 401 - try to refresh token
      if (!result.success && result.error?.status === 401) {
        const refreshedToken = await this.handleClioUnauthorized(userId);

        if (refreshedToken) {
          const retryResult = await executeClioCall(
            "GET",
            endpoint,
            refreshedToken
          );

          if (retryResult.success) {
            return formatClioResponse(args.objectType, retryResult.data);
          }

          return (
            retryResult.error?.message || "Failed to fetch data from Clio."
          );
        }

        return "Your Clio connection has expired. Please reconnect at docket.com/settings.";
      }

      if (!result.success) {
        return result.error?.message || "Failed to fetch data from Clio.";
      }

      return formatClioResponse(args.objectType, result.data);
    } catch (error) {
      console.error("[Clio read error]", error);
      return "An error occurred while fetching data from Clio. Please try again.";
    }
  }

  private async executeClioCUD(
    userId: string,
    action: string,
    objectType: string,
    data: Record<string, unknown>
  ): Promise<{ success: boolean; details?: string }> {
    const accessToken = await this.getValidClioToken(userId);

    if (!accessToken) {
      return {
        success: false,
        details:
          "Clio account not connected. Please reconnect at docket.com/settings.",
      };
    }

    try {
      let method: "POST" | "PATCH" | "DELETE";
      let endpoint: string;
      let body: Record<string, unknown> | undefined;

      // Build request based on action
      switch (action) {
        case "create": {
          method = "POST";
          const createReq = buildCreateBody(objectType, data);
          endpoint = createReq.endpoint;
          body = createReq.body;
          break;
        }

        case "update": {
          method = "PATCH";
          const id = data.id as string;

          if (!id) {
            return { success: false, details: "Missing record ID for update." };
          }

          const updateData = { ...data };
          delete updateData.id;

          const updateReq = buildUpdateBody(objectType, id, updateData);
          endpoint = updateReq.endpoint;
          body = updateReq.body;
          break;
        }

        case "delete": {
          method = "DELETE";
          const deleteId = data.id as string;

          if (!deleteId) {
            return { success: false, details: "Missing record ID for delete." };
          }

          endpoint = buildDeleteEndpoint(objectType, deleteId);
          break;
        }

        default:
          return { success: false, details: `Unknown action: ${action}` };
      }

      // Execute request
      const result = await executeClioCall(method, endpoint, accessToken, body);

      // Handle 401 - try to refresh token
      if (!result.success && result.error?.status === 401) {
        const refreshedToken = await this.handleClioUnauthorized(userId);

        if (refreshedToken) {
          const retryResult = await executeClioCall(
            method,
            endpoint,
            refreshedToken,
            body
          );

          if (retryResult.success) {
            return {
              success: true,
              details: `Successfully ${action}d ${objectType}.`,
            };
          }

          return {
            success: false,
            details:
              retryResult.error?.message ||
              `Failed to ${action} ${objectType}.`,
          };
        }

        return {
          success: false,
          details:
            "Clio connection expired. Please reconnect at docket.com/settings.",
        };
      }

      if (!result.success) {
        return {
          success: false,
          details:
            result.error?.message || `Failed to ${action} ${objectType}.`,
        };
      }

      return {
        success: true,
        details: `Successfully ${action}d ${objectType}.`,
      };
    } catch (error) {
      console.error(`[Clio ${action} error]`, error);
      return {
        success: false,
        details: `An error occurred while trying to ${action} the ${objectType}.`,
      };
    }
  }

  // ===========================================================================
  // Clio Token Management
  // ===========================================================================

  private async handleStoreClioToken(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const { userId, tokens } = (await request.json()) as {
      userId: string;
      tokens: ClioTokens;
    };

    if (!userId || !tokens) {
      return Response.json(
        { error: "Missing userId or tokens" },
        { status: 400 }
      );
    }

    await storeClioTokens(
      this.ctx.storage,
      userId,
      tokens,
      this.env.ENCRYPTION_KEY
    );

    await this.appendAuditLog({
      user_id: userId,
      action: "clio_connect",
      object_type: "oauth",
      params: {},
      result: "success",
    });

    return Response.json({ success: true });
  }

  private async getValidClioToken(userId: string): Promise<string | null> {
    const tokens = await getClioTokens(this.ctx.storage, userId, this.env);

    if (!tokens) {
      return null;
    }

    // Proactively refresh if token expires soon
    if (tokenNeedsRefresh(tokens)) {
      try {
        const newTokens = await refreshAccessToken({
          refreshToken: tokens.refresh_token,
          clientId: this.env.CLIO_CLIENT_ID,
          clientSecret: this.env.CLIO_CLIENT_SECRET,
        });

        await storeClioTokens(
          this.ctx.storage,
          userId,
          newTokens,
          this.env.ENCRYPTION_KEY
        );

        return newTokens.access_token;
      } catch (error) {
        console.error(`[TenantDO:${this.orgId}] Token refresh failed:`, error);
        await deleteClioTokens(this.ctx.storage, userId);
        return null;
      }
    }

    return tokens.access_token;
  }

  private async handleClioUnauthorized(userId: string): Promise<string | null> {
    const tokens = await getClioTokens(this.ctx.storage, userId, this.env);

    if (!tokens?.refresh_token) {
      return null;
    }

    try {
      const newTokens = await refreshAccessToken({
        refreshToken: tokens.refresh_token,
        clientId: this.env.CLIO_CLIENT_ID,
        clientSecret: this.env.CLIO_CLIENT_SECRET,
      });

      await storeClioTokens(
        this.ctx.storage,
        userId,
        newTokens,
        this.env.ENCRYPTION_KEY
      );

      return newTokens.access_token;
    } catch {
      await deleteClioTokens(this.ctx.storage, userId);
      return null;
    }
  }

  // ===========================================================================
  // Schema Management
  // ===========================================================================

  private async handleProvisionSchema(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const { userId } = (await request.json()) as { userId: string };
    const accessToken = await this.getValidClioToken(userId);

    if (!accessToken) {
      return Response.json({ error: "No valid Clio token" }, { status: 401 });
    }

    const schemas = await fetchAllSchemas(accessToken);
    const now = Date.now();

    // Cache schemas in SQLite
    for (const [objectType, schema] of schemas) {
      this.sql.exec(
        `INSERT OR REPLACE INTO clio_schema_cache (object_type, schema, fetched_at) VALUES (?, ?, ?)`,
        objectType,
        JSON.stringify(schema),
        now
      );
      this.schemaCache.set(objectType, schema);
    }

    // Update version
    this.sql.exec(
      `INSERT OR REPLACE INTO org_settings (key, value, updated_at) VALUES ('clio_schema_version', ?, ?)`,
      String(CLIO_SCHEMA_VERSION),
      now
    );
    this.schemaVersion = CLIO_SCHEMA_VERSION;

    await this.appendAuditLog({
      user_id: userId,
      action: "schema_provision",
      object_type: "clio_schema",
      params: { objectCount: schemas.size },
      result: "success",
    });

    return Response.json({
      success: true,
      count: schemas.size,
      schemas: Array.from(schemas.keys()),
    });
  }

  private async handleRefreshSchema(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const { userId } = (await request.json()) as { userId: string };

    if (!userId) {
      return Response.json(
        { error: "Missing required field: userId" },
        { status: 400 }
      );
    }

    const accessToken = await this.getValidClioToken(userId);

    if (!accessToken) {
      return Response.json({ error: "No valid Clio token" }, { status: 401 });
    }

    const schemas = await fetchAllSchemas(accessToken);
    const now = Date.now();

    for (const [objectType, schema] of schemas) {
      this.sql.exec(
        `INSERT OR REPLACE INTO clio_schema_cache (object_type, schema, fetched_at) VALUES (?, ?, ?)`,
        objectType,
        JSON.stringify(schema),
        now
      );
      this.schemaCache.set(objectType, schema);
    }

    this.sql.exec(
      `INSERT OR REPLACE INTO org_settings (key, value, updated_at) VALUES ('clio_schema_version', ?, ?)`,
      String(CLIO_SCHEMA_VERSION),
      now
    );
    this.schemaVersion = CLIO_SCHEMA_VERSION;

    await this.appendAuditLog({
      user_id: userId,
      action: "schema_refresh",
      object_type: "clio_schema",
      params: { objectCount: schemas.size },
      result: "success",
    });

    return Response.json({
      success: true,
      count: schemas.size,
      schemas: Array.from(schemas.keys()),
    });
  }

  private async handleForceSchemaRefresh(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const now = Date.now();
    const previousVersion = this.schemaVersion;

    // Clear all cached schemas
    this.sql.exec("DELETE FROM clio_schema_cache");
    this.schemaCache.clear();

    // Reset version to force refresh
    this.sql.exec(
      `INSERT OR REPLACE INTO org_settings (key, value, updated_at) VALUES ('clio_schema_version', '0', ?)`,
      now
    );
    this.schemaVersion = 0;

    await this.appendAuditLog({
      user_id: "system",
      action: "schema_force_refresh",
      object_type: "clio_schema",
      params: { previousVersion, targetVersion: CLIO_SCHEMA_VERSION },
      result: "success",
    });

    return Response.json({
      success: true,
      message: "Schema cache invalidated. Will refresh on next Clio API call.",
      previousVersion,
      targetVersion: CLIO_SCHEMA_VERSION,
    });
  }

  private async refreshSchemaWithToken(accessToken: string): Promise<void> {
    try {
      const schemas = await fetchAllSchemas(accessToken);
      const now = Date.now();

      for (const [objectType, schema] of schemas) {
        this.sql.exec(
          `INSERT OR REPLACE INTO clio_schema_cache (object_type, schema, fetched_at) VALUES (?, ?, ?)`,
          objectType,
          JSON.stringify(schema),
          now
        );
        this.schemaCache.set(objectType, schema);
      }

      this.sql.exec(
        `INSERT OR REPLACE INTO org_settings (key, value, updated_at) VALUES ('clio_schema_version', ?, ?)`,
        String(CLIO_SCHEMA_VERSION),
        now
      );
      this.schemaVersion = CLIO_SCHEMA_VERSION;

      console.log(
        `[TenantDO:${this.orgId}] Auto-refreshed schema to version ${CLIO_SCHEMA_VERSION}`
      );
    } catch (error) {
      console.error(
        `[TenantDO:${this.orgId}] Schema auto-refresh failed:`,
        error
      );
    }
  }

  private async loadSchemaCache(): Promise<void> {
    this.schemaCache.clear();

    // Load current version
    const versionRow = this.sql
      .exec("SELECT value FROM org_settings WHERE key = 'clio_schema_version'")
      .one();

    this.schemaVersion = versionRow ? Number(versionRow.value) : null;

    // If version is outdated, skip loading (will refresh on first query)
    if (schemaNeedsRefresh(this.schemaVersion)) {
      console.log(
        `[TenantDO:${this.orgId}] Schema version ${this.schemaVersion} stale (current: ${CLIO_SCHEMA_VERSION})`
      );
      return;
    }

    // Load schemas from SQLite into memory
    const rows = this.sql
      .exec("SELECT object_type, schema FROM clio_schema_cache")
      .toArray();

    for (const row of rows) {
      try {
        this.schemaCache.set(
          row.object_type as string,
          JSON.parse(row.schema as string)
        );
      } catch {
        // Skip invalid JSON
      }
    }
  }

  // ===========================================================================
  // Demo Endpoints
  // ===========================================================================

  private async handleDemoStatus(request: Request): Promise<Response> {
    const { userId } = (await request.json()) as { userId: string };
    const tokens = await getClioTokens(this.ctx.storage, userId, this.env);

    return Response.json({
      connected: tokens !== null,
      schemas: Array.from(this.schemaCache.keys()),
      tokenExpiresAt: tokens?.expires_at,
    });
  }

  private async handleDemoDisconnect(request: Request): Promise<Response> {
    const { userId } = (await request.json()) as { userId: string };

    await deleteClioTokens(this.ctx.storage, userId);

    await this.appendAuditLog({
      user_id: userId,
      action: "clio_disconnect",
      object_type: "oauth",
      params: {},
      result: "success",
    });

    return Response.json({ success: true });
  }

  private async handleDemoRefreshToken(request: Request): Promise<Response> {
    const { userId } = (await request.json()) as { userId: string };
    const tokens = await getClioTokens(this.ctx.storage, userId, this.env);

    if (!tokens) {
      return Response.json({ success: false, error: "No token found" });
    }

    try {
      const newTokens = await refreshAccessToken({
        refreshToken: tokens.refresh_token,
        clientId: this.env.CLIO_CLIENT_ID,
        clientSecret: this.env.CLIO_CLIENT_SECRET,
      });

      await storeClioTokens(
        this.ctx.storage,
        userId,
        newTokens,
        this.env.ENCRYPTION_KEY
      );

      return Response.json({ success: true, expiresAt: newTokens.expires_at });
    } catch (error) {
      return Response.json({ success: false, error: String(error) });
    }
  }

  private async handleDemoTestApi(request: Request): Promise<Response> {
    const { userId, objectType, operation, id } = (await request.json()) as {
      userId: string;
      objectType: string;
      operation: string;
      id?: string;
    };

    const accessToken = await this.getValidClioToken(userId);

    if (!accessToken) {
      return Response.json({ error: "Not connected to Clio" }, { status: 401 });
    }

    try {
      const endpoint = buildReadQuery(
        objectType,
        operation === "single" ? id : undefined,
        operation === "list" ? { limit: 10 } : undefined
      );

      const result = await executeClioCall("GET", endpoint, accessToken);

      if (!result.success) {
        return Response.json({
          error: result.error?.message || "API call failed",
          status: result.error?.status,
        });
      }

      return Response.json({ data: result.data });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  // ===========================================================================
  // Conversation Storage
  // ===========================================================================

  private async ensureConversationExists(
    message: ChannelMessage
  ): Promise<void> {
    const now = Date.now();

    // Try to update existing conversation
    const updateResult = this.sql.exec(
      "UPDATE conversations SET updated_at = ? WHERE id = ?",
      now,
      message.conversationId
    );

    // If no rows updated, insert new conversation
    if (updateResult.rowsWritten === 0) {
      this.sql.exec(
        `INSERT INTO conversations (id, channel_type, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        message.conversationId,
        message.channel,
        message.conversationScope,
        now,
        now
      );
    }
  }

  private async storeMessage(
    conversationId: string,
    msg: { role: string; content: string; userId: string | null }
  ): Promise<void> {
    this.sql.exec(
      `INSERT INTO messages (id, conversation_id, role, content, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      conversationId,
      msg.role,
      msg.content,
      msg.userId,
      Date.now()
    );
  }

  private async getRecentMessages(
    conversationId: string,
    limit = 15
  ): Promise<Array<{ role: string; content: string }>> {
    const rows = this.sql
      .exec(
        `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`,
        conversationId,
        limit
      )
      .toArray();

    // Reverse to get chronological order
    return rows.reverse().map((row) => ({
      role: row.role as string,
      content: row.content as string,
    }));
  }

  // ===========================================================================
  // Pending Confirmations
  // ===========================================================================

  private async claimPendingConfirmation(
    conversationId: string,
    userId: string
  ): Promise<PendingConfirmation | null> {
    // Atomically delete expired and claim pending confirmation
    const row = this.ctx.storage.transactionSync(() => {
      // Clean up expired confirmations
      this.sql.exec(
        "DELETE FROM pending_confirmations WHERE expires_at < ?",
        Date.now()
      );

      // Claim and delete the pending confirmation
      return this.sql
        .exec(
          `DELETE FROM pending_confirmations WHERE conversation_id = ? AND user_id = ? RETURNING id, action, object_type, params, expires_at`,
          conversationId,
          userId
        )
        .one();
    });

    if (!row) {
      return null;
    }

    // Parse params
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(row.params as string);
    } catch {
      // Use empty object if parsing fails
    }

    return {
      id: row.id as string,
      action: row.action as "create" | "update" | "delete",
      objectType: row.object_type as string,
      params,
      expiresAt: row.expires_at as number,
    };
  }

  private async createPendingConfirmation(
    conversationId: string,
    userId: string,
    action: string,
    objectType: string,
    params: Record<string, unknown>
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000; // 5 minutes

    this.sql.exec(
      `INSERT INTO pending_confirmations (id, conversation_id, user_id, action, object_type, params, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      conversationId,
      userId,
      action,
      objectType,
      JSON.stringify(params),
      now,
      expiresAt
    );

    return id;
  }

  private restorePendingConfirmation(
    conversationId: string,
    userId: string,
    confirmation: PendingConfirmation
  ): void {
    this.sql.exec(
      `INSERT INTO pending_confirmations (id, conversation_id, user_id, action, object_type, params, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      confirmation.id,
      conversationId,
      userId,
      confirmation.action,
      confirmation.objectType,
      JSON.stringify(confirmation.params),
      Date.now(),
      confirmation.expiresAt
    );
  }

  // ===========================================================================
  // Audit Logging
  // ===========================================================================

  private async handleAudit(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const body = await request.json();
    const result = AuditEntryInputSchema.safeParse(body);

    if (!result.success) {
      return Response.json(
        { error: "Invalid audit entry", details: result.error.issues },
        { status: 400 }
      );
    }

    return Response.json(await this.appendAuditLog(result.data));
  }

  async appendAuditLog(entry: AuditEntryInput): Promise<{ id: string }> {
    const now = new Date();
    const id = crypto.randomUUID();

    // Build R2 path: orgs/{orgId}/audit/{year}/{month}/{day}/{timestamp}-{id}.json
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    const path = `orgs/${
      this.ctx.id
    }/audit/${year}/${month}/${day}/${now.getTime()}-${id}.json`;

    await this.env.R2.put(
      path,
      JSON.stringify({ id, created_at: now.toISOString(), ...entry }),
      { httpMetadata: { contentType: "application/json" } }
    );

    return { id };
  }

  // ===========================================================================
  // User/Org Management
  // ===========================================================================

  private async handleRemoveUser(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const body = await request.json();
    const userId = (body as { userId?: string }).userId;

    if (!userId || typeof userId !== "string") {
      return Response.json(
        { error: "Missing required field: userId" },
        { status: 400 }
      );
    }

    const result = this.sql.exec(
      "DELETE FROM pending_confirmations WHERE user_id = ?",
      userId
    );

    return Response.json({
      success: true,
      userId,
      expiredConfirmations: result.rowsWritten,
    });
  }

  private async handleDeleteOrg(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // Count records before deletion
    const conversationCount =
      this.sql.exec("SELECT COUNT(*) as count FROM conversations").one()
        ?.count ?? 0;
    const messageCount =
      this.sql.exec("SELECT COUNT(*) as count FROM messages").one()?.count ?? 0;
    const confirmationCount =
      this.sql.exec("SELECT COUNT(*) as count FROM pending_confirmations").one()
        ?.count ?? 0;

    // Delete all data
    this.sql.exec("DELETE FROM messages");
    this.sql.exec("DELETE FROM pending_confirmations");
    this.sql.exec("DELETE FROM conversations");
    this.sql.exec("DELETE FROM org_settings");
    this.sql.exec("DELETE FROM clio_schema_cache");

    // Delete KV entries (tokens, etc.)
    const kvKeys = await this.ctx.storage.list();
    let kvDeletedCount = 0;

    for (const key of kvKeys.keys()) {
      await this.ctx.storage.delete(key);
      kvDeletedCount++;
    }

    this.schemaCache.clear();

    return Response.json({
      success: true,
      deleted: {
        conversations: conversationCount as number,
        messages: messageCount as number,
        pendingConfirmations: confirmationCount as number,
        kvEntries: kvDeletedCount,
      },
    });
  }

  private async handlePurgeUserData(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const body = await request.json();
    const userId = (body as { userId?: string }).userId;

    if (!userId || typeof userId !== "string") {
      return Response.json(
        { error: "Missing required field: userId" },
        { status: 400 }
      );
    }

    // Count records
    const messageCount =
      this.sql
        .exec(
          "SELECT COUNT(*) as count FROM messages WHERE user_id = ?",
          userId
        )
        .one()?.count ?? 0;

    const confirmationCount =
      this.sql
        .exec(
          "SELECT COUNT(*) as count FROM pending_confirmations WHERE user_id = ?",
          userId
        )
        .one()?.count ?? 0;

    // Delete user data
    this.sql.exec("DELETE FROM messages WHERE user_id = ?", userId);
    this.sql.exec(
      "DELETE FROM pending_confirmations WHERE user_id = ?",
      userId
    );

    // Delete Clio token
    const clioTokenKey = `clio_token:${userId}`;
    const hadClioToken =
      (await this.ctx.storage.get(clioTokenKey)) !== undefined;

    if (hadClioToken) {
      await this.ctx.storage.delete(clioTokenKey);
    }

    return Response.json({
      success: true,
      purged: {
        messages: messageCount as number,
        pendingConfirmations: confirmationCount as number,
        clioToken: hadClioToken,
      },
    });
  }

  // ===========================================================================
  // Database Migrations
  // ===========================================================================

  private async runMigrations(): Promise<void> {
    const versionResult = this.sql.exec("PRAGMA user_version").one();
    const currentVersion = versionResult.user_version as number;

    if (currentVersion >= 1) {
      return; // Already migrated
    }

    // Create initial schema
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        channel_type TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        user_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS pending_confirmations (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        object_type TEXT NOT NULL,
        params TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_confirmations(expires_at);

      CREATE TABLE IF NOT EXISTS org_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS clio_schema_cache (
        object_type TEXT PRIMARY KEY,
        schema TEXT NOT NULL,
        custom_fields TEXT,
        fetched_at INTEGER NOT NULL
      );

      PRAGMA user_version = 1;
    `);
  }

  // ===========================================================================
  // Alarm Handler (Background Tasks)
  // ===========================================================================

  async alarm(): Promise<void> {
    const now = Date.now();

    // Schedule next alarm for 24 hours
    await this.ctx.storage.setAlarm(now + 24 * 60 * 60 * 1000);

    // Archive stale conversations (>30 days old)
    const staleConversations = this.sql
      .exec(
        `SELECT id FROM conversations WHERE updated_at < ? AND archived_at IS NULL`,
        now - 30 * 24 * 60 * 60 * 1000
      )
      .toArray();

    for (const row of staleConversations) {
      await this.archiveConversation(row.id as string);
    }

    // Clean up expired confirmations
    this.sql.exec(
      "DELETE FROM pending_confirmations WHERE expires_at < ?",
      now
    );
  }

  private async archiveConversation(conversationId: string): Promise<void> {
    const conversation = this.sql
      .exec("SELECT * FROM conversations WHERE id = ?", conversationId)
      .one();

    if (!conversation) {
      return;
    }

    // Get all messages
    const messages = this.sql
      .exec(
        `SELECT id, role, content, user_id, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at`,
        conversationId
      )
      .toArray();

    // Create archive object
    const archiveData = {
      conversation,
      messages,
      archivedAt: new Date().toISOString(),
    };

    // Store in R2
    const result = await this.env.R2.put(
      `orgs/${this.orgId}/conversations/${conversationId}.json`,
      JSON.stringify(archiveData),
      { httpMetadata: { contentType: "application/json" } }
    );

    if (!result) {
      throw new Error(`Failed to archive conversation ${conversationId} to R2`);
    }

    // Mark as archived and delete messages
    this.sql.exec(
      "UPDATE conversations SET archived_at = ? WHERE id = ?",
      Date.now(),
      conversationId
    );

    this.sql.exec(
      "DELETE FROM messages WHERE conversation_id = ?",
      conversationId
    );
  }

  private async ensureAlarmIsSet(): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();

    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    }
  }
}

// =============================================================================
// Worker Request Handler
// =============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Auth routes
    if (url.pathname.startsWith("/api/auth")) {
      try {
        return await getAuth(env).handler(request);
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    }

    // Teams message webhook
    if (url.pathname === "/api/messages") {
      return handleTeamsMessage(request, env);
    }

    // Clio OAuth routes
    if (url.pathname === "/clio/connect") {
      return handleClioConnect(request, env);
    }

    if (url.pathname === "/clio/callback") {
      return handleClioCallback(request, env);
    }

    // Demo routes
    if (url.pathname === "/demo/clio") {
      return handleDemoPage(request, env);
    }

    if (url.pathname.startsWith("/demo/clio/")) {
      return handleDemoApi(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

// =============================================================================
// Teams Integration
// =============================================================================

interface ChannelUserInfo {
  userId: string;
  orgId: string;
  role: "admin" | "member";
  jurisdictions: string[];
  practiceTypes: string[];
  firmSize: string | null;
}

interface TeamsActivity {
  type: string;
  text?: string;
  id?: string;
  from?: { id: string; aadObjectId?: string };
  recipient?: { id: string };
  conversation?: { id: string; conversationType?: string };
  channelId?: string;
  serviceUrl?: string;
  channelData?: { tenant?: { id: string } };
}

async function handleTeamsMessage(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let activity: TeamsActivity;

  try {
    activity = (await request.json()) as TeamsActivity;
  } catch {
    return new Response(null, { status: 200 });
  }

  try {
    return await handleTeamsMessageInner(activity, env);
  } catch (error) {
    console.error("handleTeamsMessage error:", error);
    return new Response(null, { status: 200 });
  }
}

async function handleTeamsMessageInner(
  activity: TeamsActivity,
  env: Env
): Promise<Response> {
  // Only handle message activities with text
  if (activity.type !== "message" || !activity.text) {
    return new Response(null, { status: 200 });
  }

  const aadObjectId = activity.from?.aadObjectId;
  const conversationId = activity.conversation?.id;

  if (!aadObjectId || !conversationId) {
    return new Response(null, { status: 200 });
  }

  // Look up user by Teams ID
  const user = await lookupChannelUser(env, "teams", aadObjectId);

  if (!user) {
    await sendTeamsReply(activity, {
      text: "Welcome to Docket! Please link your account at docket.com to get started.",
    });
    return new Response(null, { status: 200 });
  }

  // Determine conversation scope
  const conversationType = activity.conversation?.conversationType;
  let scope: "personal" | "groupChat" | "teams";

  if (conversationType === "personal") {
    scope = "personal";
  } else if (conversationType === "groupChat") {
    scope = "groupChat";
  } else {
    scope = "teams";
  }

  // Verify org access for non-personal chats
  let orgId = user.orgId;

  if (scope !== "personal") {
    const tenantId = activity.channelData?.tenant?.id;

    if (!tenantId) {
      return new Response(null, { status: 200 });
    }

    const workspaceOrgId = await lookupWorkspaceOrg(env, "teams", tenantId);

    if (!workspaceOrgId || workspaceOrgId !== user.orgId) {
      return new Response(null, { status: 200 });
    }

    orgId = workspaceOrgId;
  }

  // Build channel message
  const channelMessage: ChannelMessage = {
    channel: "teams",
    orgId,
    userId: user.userId,
    userRole: user.role,
    conversationId,
    conversationScope: scope,
    message: activity.text,
    jurisdictions: user.jurisdictions,
    practiceTypes: user.practiceTypes,
    firmSize: user.firmSize as "solo" | "small" | "mid" | "large" | null,
    metadata: {
      threadId: activity.conversation?.id,
      teamsChannelId: activity.channelId,
    },
  };

  // Route to org's Durable Object
  const doResponse = await routeMessageToDO(env, channelMessage);
  const result = (await doResponse.json()) as { response: string };

  // Send reply
  await sendTeamsReply(activity, {
    text: result.response,
    replyToId: activity.id,
  });

  return new Response(null, { status: 200 });
}

async function sendTeamsReply(
  activity: TeamsActivity,
  reply: { text: string; replyToId?: string }
): Promise<void> {
  if (!activity.serviceUrl || !activity.conversation?.id) {
    return;
  }

  try {
    await fetch(
      `${activity.serviceUrl}/v3/conversations/${activity.conversation.id}/activities`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "message",
          text: reply.text,
          from: activity.recipient,
          recipient: activity.from,
          conversation: activity.conversation,
          replyToId: reply.replyToId,
        }),
      }
    );
  } catch (error) {
    console.error("Teams reply error:", error);
  }
}

// =============================================================================
// Database Lookups
// =============================================================================

async function lookupChannelUser(
  env: Env,
  channelType: string,
  channelUserId: string
): Promise<ChannelUserInfo | null> {
  // Look up user by channel-specific ID
  const link = await env.DB.prepare(
    `SELECT cul.user_id, om.org_id, om.role
     FROM channel_user_links cul
     JOIN org_members om ON om.user_id = cul.user_id
     WHERE cul.channel_type = ? AND cul.channel_user_id = ?
     LIMIT 1`
  )
    .bind(channelType, channelUserId)
    .first<{ user_id: string; org_id: string; role: "admin" | "member" }>();

  if (!link) {
    return null;
  }

  // Get org details
  const org = await env.DB.prepare(
    `SELECT jurisdictions, practice_types, firm_size FROM org WHERE id = ?`
  )
    .bind(link.org_id)
    .first<{
      jurisdictions: string;
      practice_types: string;
      firm_size: string | null;
    }>();

  if (!org) {
    return null;
  }

  // Parse JSON arrays
  let jurisdictions: string[] = [];
  let practiceTypes: string[] = [];

  try {
    jurisdictions = JSON.parse(org.jurisdictions || "[]");
  } catch {
    // Use empty array
  }

  try {
    practiceTypes = JSON.parse(org.practice_types || "[]");
  } catch {
    // Use empty array
  }

  return {
    userId: link.user_id,
    orgId: link.org_id,
    role: link.role,
    jurisdictions,
    practiceTypes,
    firmSize: org.firm_size,
  };
}

async function lookupWorkspaceOrg(
  env: Env,
  channelType: string,
  workspaceId: string
): Promise<string | null> {
  const result = await env.DB.prepare(
    `SELECT org_id FROM workspace_bindings WHERE channel_type = ? AND workspace_id = ?`
  )
    .bind(channelType, workspaceId)
    .first<{ org_id: string }>();

  return result?.org_id ?? null;
}

async function routeMessageToDO(
  env: Env,
  message: ChannelMessage
): Promise<Response> {
  const doId = env.TENANT.idFromName(message.orgId);
  const doStub = env.TENANT.get(doId);

  return doStub.fetch(
    new Request("https://do/process-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    })
  );
}

// =============================================================================
// Clio OAuth Handlers
// =============================================================================

async function handleClioConnect(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const isDemo = url.searchParams.get("demo") === "true";

  // Get user/org from headers or use demo values
  const userId = isDemo ? "demo-user" : request.headers.get("X-User-Id");
  const orgId = isDemo ? "demo-org" : request.headers.get("X-Org-Id");

  if (!userId || !orgId) {
    return Response.redirect("/login?redirect=/settings/clio");
  }

  // Generate PKCE values
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Generate signed state containing user info and verifier
  const state = await generateState(
    userId,
    orgId,
    codeVerifier,
    env.CLIO_CLIENT_SECRET
  );

  // Build redirect URL
  const redirectUri = new URL(request.url).origin + "/clio/callback";

  const authUrl = buildAuthorizationUrl({
    clientId: env.CLIO_CLIENT_ID,
    redirectUri,
    state,
    codeChallenge,
  });

  return Response.redirect(authUrl, 302);
}

async function handleClioCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Handle user denial
  if (error) {
    return Response.redirect(`${url.origin}/settings/clio?error=denied`);
  }

  // Validate required params
  if (!code || !state) {
    return Response.redirect(
      `${url.origin}/settings/clio?error=invalid_request`
    );
  }

  // Verify and decode state
  const stateData = await verifyState(state, env.CLIO_CLIENT_SECRET);

  if (!stateData) {
    return Response.redirect(`${url.origin}/settings/clio?error=invalid_state`);
  }

  const { userId, orgId, verifier } = stateData;
  const isDemo = userId === "demo-user" && orgId === "demo-org";
  const redirectBase = isDemo ? "/demo/clio" : "/settings/clio";

  try {
    // Exchange code for tokens
    const redirectUri = url.origin + "/clio/callback";

    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      clientId: env.CLIO_CLIENT_ID,
      clientSecret: env.CLIO_CLIENT_SECRET,
      redirectUri,
    });

    // Store tokens in org's Durable Object
    const doId = env.TENANT.idFromName(orgId);
    const doStub = env.TENANT.get(doId);

    await doStub.fetch(
      new Request("https://do/store-clio-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, tokens }),
      })
    );

    // Provision schema cache
    await doStub.fetch(
      new Request("https://do/provision-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
    );

    return Response.redirect(`${url.origin}${redirectBase}?success=connected`);
  } catch (error) {
    console.error("Clio callback error:", error);
    return Response.redirect(
      `${url.origin}${redirectBase}?error=exchange_failed`
    );
  }
}

// =============================================================================
// Demo Page Handlers
// =============================================================================

async function handleDemoPage(_request: Request, env: Env): Promise<Response> {
  const demoUserId = "demo-user";
  const demoOrgId = "demo-org";

  const doStub = env.TENANT.get(env.TENANT.idFromName(demoOrgId));

  // Get current status
  let connected = false;
  let schemas: string[] = [];
  let tokenExpiresAt: number | undefined;

  try {
    const statusRes = await doStub.fetch(
      new Request("https://do/demo-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: demoUserId }),
      })
    );

    const status = (await statusRes.json()) as {
      connected: boolean;
      schemas: string[];
      tokenExpiresAt?: number;
    };

    connected = status.connected;
    schemas = status.schemas || [];
    tokenExpiresAt = status.tokenExpiresAt;
  } catch {
    // Use defaults
  }

  // Render page
  const html = renderClioDemo({
    connected,
    schemas,
    userId: demoUserId,
    tokenExpiresAt,
  } as DemoState);

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

async function handleDemoApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.replace("/demo/clio/", "");

  const demoUserId = "demo-user";
  const demoOrgId = "demo-org";

  const doStub = env.TENANT.get(env.TENANT.idFromName(demoOrgId));

  try {
    switch (action) {
      case "disconnect": {
        await doStub.fetch(
          new Request("https://do/demo-disconnect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: demoUserId }),
          })
        );
        return Response.json({ success: true });
      }

      case "refresh-token": {
        return doStub.fetch(
          new Request("https://do/demo-refresh-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: demoUserId }),
          })
        );
      }

      case "refresh-schema": {
        const res = await doStub.fetch(
          new Request("https://do/provision-schema", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: demoUserId }),
          })
        );

        const data = (await res.json()) as {
          success?: boolean;
          count?: number;
        };

        return Response.json({ success: data.success, count: data.count });
      }

      case "test-api": {
        const body = (await request.json()) as {
          objectType: string;
          operation: string;
          id?: string;
        };

        return doStub.fetch(
          new Request("https://do/demo-test-api", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: demoUserId, ...body }),
          })
        );
      }

      default:
        return Response.json({ error: "Unknown demo action" }, { status: 404 });
    }
  } catch (error) {
    console.error("Demo API error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
