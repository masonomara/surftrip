import { DurableObject } from "cloudflare:workers";
import { getAuth } from "./lib/auth";
import {
  AuditEntryInputSchema,
  type AuditEntryInput,
} from "./types/requests";
import {
  ChannelMessageSchema,
  type ChannelMessage,
  type PendingConfirmation,
  type LLMResponse,
  type ToolCall,
} from "./types";
import {
  retrieveRAGContext,
  formatRAGContext,
} from "./services/rag-retrieval";

// =============================================================================
// Environment Types
// =============================================================================

export interface Env {
  DB: D1Database;
  TENANT: DurableObjectNamespace;
  R2: R2Bucket;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CLIO_CLIENT_ID: string;
  CLIO_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APPLE_CLIENT_ID: string;
  APPLE_CLIENT_SECRET: string;
  APPLE_APP_BUNDLE_IDENTIFIER: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ENVIRONMENT?: string;
}

// =============================================================================
// TenantDO - Durable Object for per-org state
// =============================================================================

export class TenantDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private orgId: string;
  private schemaCache: Map<string, object> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.orgId = ctx.id.toString();

    // Initialize the DO on first wake
    ctx.blockConcurrencyWhile(async () => {
      await this.runMigrations();
      await this.loadSchemaCache();
      await this.ensureAlarmIsSet();
    });
  }

  // ===========================================================================
  // HTTP Request Handler
  // ===========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case "/process-message":
          return this.handleProcessMessage(request);
        case "/audit":
          return this.handleAudit(request);
        case "/refresh-schema":
          return this.handleRefreshSchema(request);
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

    // Validate the incoming message
    const parseResult = ChannelMessageSchema.safeParse(await request.json());
    if (!parseResult.success) {
      return Response.json(
        { error: "Invalid message format", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const message = parseResult.data;

    // Security check: ensure message is for this org
    if (message.orgId !== this.orgId) {
      console.error(
        `[TenantDO:${this.orgId}] OrgId mismatch: received ${message.orgId}, expected ${this.orgId}`
      );
      return Response.json({ error: "Organization mismatch" }, { status: 403 });
    }

    // Process the message
    await this.ensureConversationExists(message);

    // Check if user has a pending confirmation to respond to
    const pendingConfirmation = await this.claimPendingConfirmation(
      message.conversationId,
      message.userId
    );

    // Store the user's message
    await this.storeMessage(message.conversationId, {
      role: "user",
      content: message.message,
      userId: message.userId,
    });

    // Generate response (either handle confirmation or generate new response)
    let response: string;
    if (pendingConfirmation) {
      response = await this.handleConfirmationResponse(
        message,
        pendingConfirmation
      );
    } else {
      response = await this.generateAssistantResponse(message);
    }

    // Store the assistant's response
    await this.storeMessage(message.conversationId, {
      role: "assistant",
      content: response,
      userId: null,
    });

    return Response.json({ response });
  }

  // ===========================================================================
  // Response Generation
  // ===========================================================================

  private async generateAssistantResponse(
    message: ChannelMessage
  ): Promise<string> {
    // Retrieve relevant context from RAG
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

    // Build the conversation messages
    const conversationHistory = await this.getRecentMessages(
      message.conversationId
    );
    const systemPrompt = this.buildSystemPrompt(
      formatRAGContext(ragContext),
      message.userRole
    );

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
    ];

    // Call the LLM
    const llmResponse = await this.callLLM(
      messages,
      this.getClioTools(message.userRole)
    );

    // Handle tool calls if present, otherwise return the response
    if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
      return this.handleToolCalls(message, llmResponse.toolCalls);
    }

    return llmResponse.content;
  }

  private buildSystemPrompt(ragContext: string, userRole: string): string {
    // Format cached schemas for the prompt
    const schemaEntries = [...this.schemaCache].map(
      ([objectType, schema]) =>
        `### ${objectType}\n${JSON.stringify(schema, null, 2)}`
    );

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

**Clio Schema Reference:**
${schemaEntries.join("\n\n") || "Schema not yet loaded. User needs to connect Clio first."}

**Instructions:**
- Use Knowledge Base and firm context for case management questions
- Query Clio using the clioQuery tool per the schema above
- For write operations (create, update, delete), always confirm first
- NEVER give legal advice—you manage cases, not law
- Stay in scope: case management, Clio operations, firm procedures
- If Clio is not connected, guide user to connect at docket.com/settings`;
  }

  // ===========================================================================
  // LLM Integration
  // ===========================================================================

  private async callLLM(
    messages: Array<{ role: string; content: string }>,
    tools?: object[]
  ): Promise<LLMResponse> {
    try {
      const response = await (this.env.AI.run as Function)(
        "@cf/meta/llama-3.1-8b-instruct",
        {
          messages,
          tools: tools?.length ? tools : undefined,
          max_tokens: 2000,
        }
      );

      // Handle string response (no tool calls)
      if (typeof response === "string") {
        return { content: response };
      }

      // Handle structured response
      const result = response as {
        response?: string;
        tool_calls?: Array<{
          name: string;
          arguments: string | Record<string, unknown>;
        }>;
      };

      // Parse tool calls if present
      const toolCalls = result.tool_calls?.map((tc) => ({
        name: tc.name,
        arguments:
          typeof tc.arguments === "string"
            ? JSON.parse(tc.arguments)
            : tc.arguments,
      })) as ToolCall[] | undefined;

      return {
        content: result.response || "",
        toolCalls,
      };
    } catch (error) {
      console.error(`[TenantDO:${this.orgId}] LLM error:`, error);
      return {
        content:
          "I'm having trouble processing your request right now. Please try again in a moment.",
      };
    }
  }

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

      // Permission check for non-read operations
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

      // For CUD operations, create a pending confirmation
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

    // If we have data, show a preview
    if (args.data) {
      const dataPreview = Object.entries(args.data)
        .slice(0, 3)
        .map(([key, value]) => `${key}: "${value}"`)
        .join(", ");
      return `${verb} ${objectName} with ${dataPreview}`;
    }

    // For operations with an ID
    if (args.id) {
      return `${verb} ${objectName} ${args.id}`;
    }

    return `${verb} ${objectName}`;
  }

  // ===========================================================================
  // Confirmation Handling
  // ===========================================================================

  private async handleConfirmationResponse(
    message: ChannelMessage,
    confirmation: PendingConfirmation
  ): Promise<string> {
    // Classify the user's response
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
        // Re-process with modified request
        return this.generateAssistantResponse({
          ...message,
          message: classification.modifiedRequest || message.message,
        });

      case "unrelated":
        // Restore the confirmation and handle as new message
        this.restorePendingConfirmation(
          message.conversationId,
          message.userId,
          confirmation
        );
        return this.generateAssistantResponse(message);

      default:
        // Unclear response - restore confirmation and ask again
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
    const prompt = `A user was asked to confirm: ${confirmation.action} a ${confirmation.objectType} with: ${JSON.stringify(confirmation.params)}
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
        typeof response === "string"
          ? response
          : (response as { response: string }).response;

      // Extract JSON from response
      const jsonMatch = text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error(`[TenantDO:${this.orgId}] Classification error:`, error);
    }

    return { intent: "unclear" };
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

      // Log successful operation
      await this.appendAuditLog({
        user_id: userId,
        action: confirmation.action,
        object_type: confirmation.objectType,
        params: confirmation.params,
        result: "success",
      });

      const successMessage = `Done! I've ${confirmation.action}d the ${confirmation.objectType}.`;
      return result.details ? `${successMessage}\n\n${result.details}` : successMessage;
    } catch (error) {
      // Log failed operation
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
  // Clio Operations (Placeholders)
  // ===========================================================================

  private async executeClioRead(
    userId: string,
    args: {
      objectType: string;
      id?: string;
      filters?: Record<string, unknown>;
    }
  ): Promise<string> {
    // Check if user has connected Clio
    const hasToken = await this.hasClioToken(userId);
    if (!hasToken) {
      return "You haven't connected your Clio account yet. Please connect at docket.com/settings to enable Clio queries.";
    }

    // Placeholder for actual Clio API call
    let description = `Would query ${args.objectType}`;
    if (args.id) {
      description += ` with ID ${args.id}`;
    }
    if (args.filters) {
      description += ` with filters ${JSON.stringify(args.filters)}`;
    }

    return `[Clio read placeholder] ${description}`;
  }

  private async executeClioCUD(
    userId: string,
    action: string,
    objectType: string,
    data: Record<string, unknown>
  ): Promise<{ success: boolean; details?: string }> {
    // Placeholder for actual Clio API call
    console.log(`[Clio ${action}]`, { userId, objectType, data });

    return {
      success: true,
      details: `[Placeholder] ${action} ${objectType} would execute here`,
    };
  }

  private async hasClioToken(userId: string): Promise<boolean> {
    const token = await this.ctx.storage.get(`clio_token:${userId}`);
    return token !== undefined;
  }

  // ===========================================================================
  // Conversation & Message Storage
  // ===========================================================================

  private async ensureConversationExists(message: ChannelMessage): Promise<void> {
    const now = Date.now();

    // Try to update existing conversation
    const updateResult = this.sql.exec(
      "UPDATE conversations SET updated_at = ? WHERE id = ?",
      now,
      message.conversationId
    );

    // If no rows updated, create new conversation
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
  // Pending Confirmation Management
  // ===========================================================================

  private async claimPendingConfirmation(
    conversationId: string,
    userId: string
  ): Promise<PendingConfirmation | null> {
    const now = Date.now();

    // Clean up expired confirmations
    this.sql.exec(
      "DELETE FROM pending_confirmations WHERE expires_at < ?",
      now
    );

    // Try to claim a pending confirmation for this user
    const row = this.sql
      .exec(
        `DELETE FROM pending_confirmations WHERE conversation_id = ? AND user_id = ? RETURNING id, action, object_type, params, expires_at`,
        conversationId,
        userId
      )
      .one();

    if (!row) {
      return null;
    }

    // Parse the params JSON
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(row.params as string);
    } catch {
      // Ignore parse errors, use empty object
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

    const result = AuditEntryInputSchema.safeParse(await request.json());
    if (!result.success) {
      return Response.json(
        { error: "Invalid audit entry", details: result.error.issues },
        { status: 400 }
      );
    }

    const auditResult = await this.appendAuditLog(result.data);
    return Response.json(auditResult);
  }

  async appendAuditLog(entry: AuditEntryInput): Promise<{ id: string }> {
    const now = new Date();
    const id = crypto.randomUUID();

    // Build the R2 path: orgs/{orgId}/audit/{year}/{month}/{day}/{timestamp}-{id}.json
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const path = `orgs/${this.ctx.id}/audit/${year}/${month}/${day}/${now.getTime()}-${id}.json`;

    await this.env.R2.put(
      path,
      JSON.stringify({ id, created_at: now.toISOString(), ...entry }),
      { httpMetadata: { contentType: "application/json" } }
    );

    return { id };
  }

  // ===========================================================================
  // Schema Management
  // ===========================================================================

  private async handleRefreshSchema(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    await this.loadSchemaCache();

    return Response.json({
      success: true,
      cachedTypes: Array.from(this.schemaCache.keys()),
    });
  }

  private async loadSchemaCache(): Promise<void> {
    this.schemaCache.clear();

    const rows = this.sql
      .exec("SELECT object_type, schema FROM clio_schema_cache")
      .toArray();

    for (const row of rows) {
      try {
        const schema = JSON.parse(row.schema as string);
        this.schemaCache.set(row.object_type as string, schema);
      } catch {
        console.error(
          `[TenantDO:${this.orgId}] Invalid schema JSON for ${row.object_type}`
        );
      }
    }
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

    // Run initial schema creation
    this.sql.exec(`
      -- Conversations table
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        channel_type TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);

      -- Messages table
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        user_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

      -- Pending confirmations for CUD operations
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

      -- Org settings
      CREATE TABLE IF NOT EXISTS org_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Clio schema cache
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
  // Alarm Handler (Background Cleanup)
  // ===========================================================================

  async alarm(): Promise<void> {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Archive old conversations
    const staleConversations = this.sql
      .exec(
        `SELECT id FROM conversations WHERE updated_at < ? AND archived_at IS NULL`,
        thirtyDaysAgo
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

    // Schedule next alarm (daily)
    await this.ctx.storage.setAlarm(now + 24 * 60 * 60 * 1000);
  }

  private async archiveConversation(conversationId: string): Promise<void> {
    // Get the conversation
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

    // Write to R2
    await this.env.R2.put(
      `orgs/${this.orgId}/conversations/${conversationId}.json`,
      JSON.stringify({
        conversation,
        messages,
        archivedAt: new Date().toISOString(),
      }),
      { httpMetadata: { contentType: "application/json" } }
    );

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
    const existingAlarm = await this.ctx.storage.getAlarm();
    if (!existingAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    }
  }
}

// =============================================================================
// User Lookup Helpers
// =============================================================================

interface ChannelUserInfo {
  userId: string;
  orgId: string;
  role: "admin" | "member";
  jurisdictions: string[];
  practiceTypes: string[];
  firmSize: string | null;
}

async function lookupChannelUser(
  env: Env,
  channelType: string,
  channelUserId: string
): Promise<ChannelUserInfo | null> {
  // Look up the channel link
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

  // Get org settings
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

  // Parse JSON arrays safely
  let jurisdictions: string[] = [];
  let practiceTypes: string[] = [];

  try {
    jurisdictions = JSON.parse(org.jurisdictions || "[]");
  } catch {
    // Ignore parse errors
  }

  try {
    practiceTypes = JSON.parse(org.practice_types || "[]");
  } catch {
    // Ignore parse errors
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

// =============================================================================
// Durable Object Routing
// =============================================================================

async function routeMessageToDO(
  env: Env,
  message: ChannelMessage
): Promise<Response> {
  const doId = env.TENANT.idFromName(message.orgId);
  const stub = env.TENANT.get(doId);

  return stub.fetch(
    new Request("https://do/process-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    })
  );
}

// =============================================================================
// Teams Adapter
// =============================================================================

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

  const activity = (await request.json()) as TeamsActivity;

  // Only process message activities with text
  if (activity.type !== "message" || !activity.text) {
    return new Response(null, { status: 200 });
  }

  const aadObjectId = activity.from?.aadObjectId;
  const conversationId = activity.conversation?.id;

  if (!aadObjectId || !conversationId) {
    return new Response(null, { status: 200 });
  }

  // Look up the user
  const user = await lookupChannelUser(env, "teams", aadObjectId);

  if (!user) {
    // Send onboarding message
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

  // For non-personal messages, validate workspace binding
  let orgId = user.orgId;

  if (scope !== "personal") {
    const tenantId = activity.channelData?.tenant?.id;

    if (!tenantId) {
      console.error("Group chat missing tenant ID");
      return new Response(null, { status: 200 });
    }

    const workspaceOrgId = await lookupWorkspaceOrg(env, "teams", tenantId);

    if (!workspaceOrgId) {
      console.error("Workspace not bound to any org", { tenantId });
      return new Response(null, { status: 200 });
    }

    if (workspaceOrgId !== user.orgId) {
      console.error("User org mismatch with workspace org");
      return new Response(null, { status: 200 });
    }

    orgId = workspaceOrgId;
  }

  // Build the channel message
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

  // Route to DO and get response
  const doResponse = await routeMessageToDO(env, channelMessage);
  const result = (await doResponse.json()) as { response: string };

  // Send reply back to Teams
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
    console.error("Teams reply blocked: missing serviceUrl or conversation.id");
    return;
  }

  try {
    const response = await fetch(
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

    if (!response.ok) {
      console.error("Teams reply failed", {
        status: response.status,
        body: await response.text(),
      });
    }
  } catch (error) {
    console.error("Teams reply error:", error);
  }
}

// =============================================================================
// Clio OAuth Callback
// =============================================================================

async function handleClioCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return Response.json(
      { error: "Missing authorization code" },
      { status: 400 }
    );
  }

  if (!state) {
    return Response.json(
      { error: "Missing state parameter" },
      { status: 400 }
    );
  }

  // Exchange code for tokens
  const tokenResponse = await fetch("https://app.clio.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/callback`,
      client_id: env.CLIO_CLIENT_ID,
      client_secret: env.CLIO_CLIENT_SECRET,
    }),
  });

  if (!tokenResponse.ok) {
    return Response.json(
      { error: "Token exchange failed", details: await tokenResponse.text() },
      { status: 502 }
    );
  }

  const tokens = (await tokenResponse.json()) as {
    token_type: string;
    expires_in: number;
  };

  return Response.json({
    success: true,
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
  });
}

// =============================================================================
// Main Worker Export
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

    // Teams webhook
    if (url.pathname === "/api/messages") {
      return handleTeamsMessage(request, env);
    }

    // Clio OAuth callback
    if (url.pathname === "/callback") {
      return handleClioCallback(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
