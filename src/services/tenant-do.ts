import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";
import {
  type ChannelMessage,
  type DOResponse,
  type ProcessMessageResponse,
  validateChannelMessage,
} from "../types/channel";
import { retrieveRAGContext } from "./rag-retrieval";
import {
  type ClioQueryParams,
  type ToolCall,
  type PendingOperation,
  buildSystemPrompt,
  formatMessagesForLLM,
  runLLMInference,
  classifyConfirmationResponse,
  buildOperationDescription,
} from "./llm";

export interface AuditEntry {
  id: string;
  user_id: string;
  action: string;
  object_type: string;
  params: Record<string, unknown>;
  result: "success" | "error";
  error_message?: string;
  created_at: string;
}

type AuditEntryInput = Omit<AuditEntry, "id" | "created_at">;

// StoredMessage type kept for future use (e.g., message exports)
type _StoredMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  user_id: string | null;
  created_at: number;
};

interface PendingConfirmation {
  id: string;
  conversation_id: string;
  user_id: string;
  action: string;
  object_type: string;
  params: string;
  description: string;
  created_at: number;
  expires_at: number;
}


const CONFIRMATION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONTEXT_MESSAGES = 15;

export class TenantDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private orgId: string;
  private schemaCache: Map<string, string> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.orgId = ctx.id.toString();
    ctx.blockConcurrencyWhile(() => this.initialize());
  }

  private async initialize(): Promise<void> {
    await this.migrate();
    this.loadSchemaCache();
  }

  private async migrate(): Promise<void> {
    const currentVersion = this.sql.exec("PRAGMA user_version").one()
      .user_version as number;

    if (currentVersion < 1) {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY, channel_type TEXT NOT NULL, scope TEXT NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL, user_id TEXT, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

        CREATE TABLE IF NOT EXISTS pending_confirmations (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
          user_id TEXT NOT NULL, action TEXT NOT NULL, object_type TEXT NOT NULL,
          params TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_confirmations(expires_at);

        CREATE TABLE IF NOT EXISTS org_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS clio_schema_cache (object_type TEXT PRIMARY KEY, schema TEXT NOT NULL, custom_fields TEXT, fetched_at INTEGER NOT NULL);

        PRAGMA user_version = 1;
      `);
    }

    if (currentVersion < 2) {
      // Add description column to pending_confirmations
      try {
        this.sql.exec(
          "ALTER TABLE pending_confirmations ADD COLUMN description TEXT DEFAULT ''"
        );
      } catch {
        // Column may already exist
      }
      this.sql.exec("PRAGMA user_version = 2");
    }
  }

  private loadSchemaCache(): void {
    const rows = this.sql
      .exec("SELECT object_type, schema FROM clio_schema_cache")
      .toArray();

    for (const row of rows) {
      const objectType = row.object_type as string;
      const schema = row.schema as string;
      this.schemaCache.set(objectType, schema);
    }
  }

  private getClioSchemaReference(): string {
    if (this.schemaCache.size === 0) {
      return "No Clio schema cached. Connect to Clio to enable data queries.";
    }

    const summaries: string[] = [];
    for (const [objectType, schema] of this.schemaCache) {
      try {
        const parsed = JSON.parse(schema);
        const fields = parsed.fields?.slice(0, 5).map((f: { name: string }) => f.name).join(", ");
        summaries.push(`- ${objectType}: ${fields || "no fields"}...`);
      } catch {
        summaries.push(`- ${objectType}`);
      }
    }
    return summaries.join("\n");
  }

  async appendAuditLog(entry: AuditEntryInput): Promise<{ id: string }> {
    const now = new Date();
    const id = crypto.randomUUID();
    const path = `orgs/${this.orgId}/audit/${now.getFullYear()}/${String(
      now.getMonth() + 1
    ).padStart(2, "0")}/${String(now.getDate()).padStart(
      2,
      "0"
    )}/${now.getTime()}-${id}.json`;
    await this.env.R2.put(
      path,
      JSON.stringify({ id, created_at: now.toISOString(), ...entry }),
      { httpMetadata: { contentType: "application/json" } }
    );
    return { id };
  }

  private validateOrgId(requestOrgId: string): boolean {
    return requestOrgId === this.orgId;
  }

  private ensureConversation(
    conversationId: string,
    channelType: string,
    scope: string
  ): void {
    const now = Date.now();
    const existing = this.sql
      .exec("SELECT id FROM conversations WHERE id = ?", conversationId)
      .toArray();

    if (existing.length === 0) {
      this.sql.exec(
        "INSERT INTO conversations (id, channel_type, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        conversationId,
        channelType,
        scope,
        now,
        now
      );
    } else {
      this.sql.exec(
        "UPDATE conversations SET updated_at = ? WHERE id = ?",
        now,
        conversationId
      );
    }
  }

  private storeMessage(
    conversationId: string,
    role: "user" | "assistant" | "system",
    content: string,
    userId: string | null
  ): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO messages (id, conversation_id, role, content, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      conversationId,
      role,
      content,
      userId,
      now
    );
    return id;
  }

  private getRecentMessages(
    conversationId: string
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const rows = this.sql
      .exec(
        `SELECT role, content FROM messages
         WHERE conversation_id = ? AND role IN ('user', 'assistant')
         ORDER BY created_at DESC LIMIT ?`,
        conversationId,
        MAX_CONTEXT_MESSAGES
      )
      .toArray();
    return rows.reverse().map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content as string,
    }));
  }

  private checkPermission(
    userRole: string,
    operation: string
  ): { allowed: boolean; requiresConfirmation: boolean; reason?: string } {
    const isCUD = ["create", "update", "delete"].includes(operation);

    if (userRole === "member" && isCUD) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: "Members can only perform read operations",
      };
    }

    if (userRole === "admin" && isCUD) {
      return { allowed: true, requiresConfirmation: true };
    }

    return { allowed: true, requiresConfirmation: false };
  }

  private createPendingConfirmation(
    conversationId: string,
    userId: string,
    action: string,
    objectType: string,
    params: Record<string, unknown>
  ): PendingConfirmation {
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + CONFIRMATION_EXPIRY_MS;
    const description = buildOperationDescription(action, objectType, params);

    // Clear any existing pending confirmations for this user in this conversation
    this.sql.exec(
      "DELETE FROM pending_confirmations WHERE conversation_id = ? AND user_id = ?",
      conversationId,
      userId
    );

    this.sql.exec(
      `INSERT INTO pending_confirmations
       (id, conversation_id, user_id, action, object_type, params, description, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      conversationId,
      userId,
      action,
      objectType,
      JSON.stringify(params),
      description,
      now,
      expiresAt
    );

    return {
      id,
      conversation_id: conversationId,
      user_id: userId,
      action,
      object_type: objectType,
      params: JSON.stringify(params),
      description,
      created_at: now,
      expires_at: expiresAt,
    };
  }

  private getPendingConfirmation(
    conversationId: string,
    userId: string
  ): PendingConfirmation | null {
    const now = Date.now();

    // Clean expired confirmations first
    this.sql.exec(
      "DELETE FROM pending_confirmations WHERE expires_at < ?",
      now
    );

    const rows = this.sql
      .exec(
        `SELECT id, conversation_id, user_id, action, object_type, params, description, created_at, expires_at
         FROM pending_confirmations
         WHERE conversation_id = ? AND user_id = ? AND expires_at > ?
         LIMIT 1`,
        conversationId,
        userId,
        now
      )
      .toArray();

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id as string,
      conversation_id: row.conversation_id as string,
      user_id: row.user_id as string,
      action: row.action as string,
      object_type: row.object_type as string,
      params: row.params as string,
      description: (row.description as string) || "",
      created_at: row.created_at as number,
      expires_at: row.expires_at as number,
    };
  }

  private deletePendingConfirmation(confirmationId: string): void {
    this.sql.exec(
      "DELETE FROM pending_confirmations WHERE id = ?",
      confirmationId
    );
  }

  private async executeClioOperation(
    toolCall: ToolCall,
    userId: string
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    // Phase 8 will implement actual Clio API calls
    // For now, return a mock response
    const { object_type, operation, id, params } = toolCall.arguments;

    // Log the operation
    await this.appendAuditLog({
      user_id: userId,
      action: `clio_${operation}`,
      object_type,
      params: { id, ...params },
      result: "success",
    });

    // Mock responses based on operation type
    if (operation === "read") {
      if (id) {
        return {
          success: true,
          data: {
            id,
            type: object_type.replace(/s$/, ""),
            description: `Sample ${object_type.replace(/s$/, "")} #${id}`,
          },
        };
      }
      return {
        success: true,
        data: {
          items: [
            { id: 1, description: `Sample ${object_type.replace(/s$/, "")} 1` },
            { id: 2, description: `Sample ${object_type.replace(/s$/, "")} 2` },
          ],
          total: 2,
        },
      };
    }

    if (operation === "create") {
      return {
        success: true,
        data: { id: Math.floor(Math.random() * 10000), ...params },
      };
    }

    if (operation === "update") {
      return { success: true, data: { id, ...params } };
    }

    if (operation === "delete") {
      return { success: true, data: { deleted: id } };
    }

    return { success: false, error: "Unknown operation" };
  }

  private async processMessage(
    msg: ChannelMessage
  ): Promise<ProcessMessageResponse> {
    // Validate org identity
    if (!this.validateOrgId(msg.orgId)) {
      return {
        success: false,
        conversationId: msg.conversationId,
        error: "Organization mismatch",
      };
    }

    // Ensure conversation exists
    this.ensureConversation(
      msg.conversationId,
      msg.channel,
      msg.conversationScope
    );

    // Store user message
    this.storeMessage(msg.conversationId, "user", msg.message, msg.userId);

    // Check for pending confirmation first
    const pending = this.getPendingConfirmation(
      msg.conversationId,
      msg.userId
    );

    if (pending) {
      return this.handleConfirmationResponse(msg, pending);
    }

    // Normal message processing with LLM
    return this.processWithLLM(msg);
  }

  private async handleConfirmationResponse(
    msg: ChannelMessage,
    pending: PendingConfirmation
  ): Promise<ProcessMessageResponse> {
    const pendingOp: PendingOperation = {
      id: pending.id,
      action: pending.action,
      objectType: pending.object_type,
      params: JSON.parse(pending.params),
      description: pending.description,
    };

    // Classify the user's response
    const classification = await classifyConfirmationResponse(
      this.env,
      msg.message,
      pendingOp
    );

    let responseText: string;

    switch (classification.intent) {
      case "approve": {
        // Execute the pending operation
        this.deletePendingConfirmation(pending.id);
        const result = await this.executeClioOperation(
          {
            name: "clioQuery",
            arguments: {
              object_type: pending.object_type,
              operation: pending.action as ClioQueryParams["operation"],
              ...JSON.parse(pending.params),
            },
          },
          msg.userId
        );

        if (result.success) {
          responseText = `Done! ${pending.description} completed successfully.`;
        } else {
          responseText = `I couldn't complete that operation: ${result.error}`;
        }
        break;
      }

      case "reject":
        this.deletePendingConfirmation(pending.id);
        responseText = "Okay, I've cancelled that operation.";
        break;

      case "modify":
        // Clear the pending confirmation and process as new request with context
        this.deletePendingConfirmation(pending.id);
        // Process the modification request through normal LLM flow
        return this.processWithLLM(msg);

      case "unrelated":
      default:
        // Keep pending confirmation, process message normally
        // Include reminder about pending confirmation in response
        const llmResponse = await this.processWithLLM(msg);
        if (llmResponse.responseText) {
          llmResponse.responseText += `\n\n(Note: You still have a pending operation: "${pending.description}". Reply "yes" to confirm or "no" to cancel.)`;
        }
        return llmResponse;
    }

    this.storeMessage(msg.conversationId, "assistant", responseText, null);
    return {
      success: true,
      conversationId: msg.conversationId,
      responseText,
    };
  }

  private async processWithLLM(
    msg: ChannelMessage
  ): Promise<ProcessMessageResponse> {
    // Retrieve RAG context
    const ragContext = await retrieveRAGContext(this.env, msg.message, this.orgId, {
      jurisdiction: msg.jurisdiction,
      practiceType: msg.practiceType,
      firmSize: msg.firmSize,
    });

    // Split KB and Org context for system prompt
    const kbSection = ragContext.kbChunks.length > 0
      ? ragContext.kbChunks.map(c => `${c.content}\n*Source: ${c.source}*`).join("\n\n")
      : "";
    const orgSection = ragContext.orgChunks.length > 0
      ? ragContext.orgChunks.map(c => `${c.content}\n*Source: ${c.source}*`).join("\n\n")
      : "";

    // Build system prompt
    const systemPrompt = buildSystemPrompt(
      kbSection,
      orgSection,
      this.getClioSchemaReference()
    );

    // Get conversation history
    const history = this.getRecentMessages(msg.conversationId);

    // Format messages for LLM (exclude current message from history since we're adding it fresh)
    const historyWithoutCurrent = history.slice(0, -1);
    const messages = formatMessagesForLLM(
      systemPrompt,
      historyWithoutCurrent,
      msg.message
    );

    // Run LLM inference
    const llmResponse = await runLLMInference(this.env, messages);

    // Handle tool call
    if (llmResponse.toolCall) {
      return this.handleToolCall(msg, llmResponse.toolCall);
    }

    // Text response
    const responseText = llmResponse.text || "I couldn't process that request.";
    this.storeMessage(msg.conversationId, "assistant", responseText, null);

    return {
      success: true,
      conversationId: msg.conversationId,
      responseText,
      data: {
        historyCount: history.length,
        ragStats: {
          kbChunks: ragContext.kbChunks.length,
          orgChunks: ragContext.orgChunks.length,
        },
      },
    };
  }

  private async handleToolCall(
    msg: ChannelMessage,
    toolCall: ToolCall
  ): Promise<ProcessMessageResponse> {
    const { operation, object_type } = toolCall.arguments;

    // Check permissions
    const permCheck = this.checkPermission(msg.userRole, operation);

    if (!permCheck.allowed) {
      const responseText = `I'm sorry, but ${permCheck.reason?.toLowerCase() || "you don't have permission for this action"}.`;
      this.storeMessage(msg.conversationId, "assistant", responseText, null);

      await this.appendAuditLog({
        user_id: msg.userId,
        action: "permission_denied",
        object_type,
        params: { operation, role: msg.userRole },
        result: "error",
        error_message: permCheck.reason,
      });

      return {
        success: true,
        conversationId: msg.conversationId,
        responseText,
      };
    }

    // CUD operations require confirmation
    if (permCheck.requiresConfirmation) {
      const confirmation = this.createPendingConfirmation(
        msg.conversationId,
        msg.userId,
        operation,
        object_type,
        toolCall.arguments.params || { id: toolCall.arguments.id }
      );

      const responseText = `I'd like to ${confirmation.description.toLowerCase()}. Would you like me to proceed? (Reply "yes" to confirm or "no" to cancel)`;
      this.storeMessage(msg.conversationId, "assistant", responseText, null);

      return {
        success: true,
        conversationId: msg.conversationId,
        responseText,
        pendingConfirmation: {
          id: confirmation.id,
          action: confirmation.action,
          objectType: confirmation.object_type,
          expiresAt: confirmation.expires_at,
        },
      };
    }

    // Read operations execute immediately
    const result = await this.executeClioOperation(toolCall, msg.userId);

    // For now, return a formatted response (Phase 8 will have LLM synthesize this)
    let responseText: string;
    if (result.success) {
      const data = result.data as { items?: unknown[]; total?: number };
      if (data.items) {
        responseText = `Found ${data.total || data.items.length} ${object_type}. Here are the results:\n${JSON.stringify(data.items, null, 2)}`;
      } else {
        responseText = `Here's the ${object_type.replace(/s$/, "")} you requested:\n${JSON.stringify(result.data, null, 2)}`;
      }
    } else {
      responseText = `I couldn't retrieve that information: ${result.error}`;
    }

    this.storeMessage(msg.conversationId, "assistant", responseText, null);

    return {
      success: true,
      conversationId: msg.conversationId,
      responseText,
      data: { clioResult: result.data },
    };
  }

  private expireUserConfirmations(userId: string): number {
    const now = Date.now();
    this.sql.exec(
      "UPDATE pending_confirmations SET expires_at = ? WHERE user_id = ? AND expires_at > ?",
      now,
      userId,
      now
    );
    return this.sql.exec("SELECT changes() as count").one().count as number;
  }

  private deleteUserMessages(userId: string): number {
    const count = this.sql
      .exec("SELECT COUNT(*) as count FROM messages WHERE user_id = ?", userId)
      .one().count as number;

    this.sql.exec("DELETE FROM messages WHERE user_id = ?", userId);
    return count;
  }

  private async handleUserLeave(userId: string): Promise<DOResponse> {
    const expiredCount = this.expireUserConfirmations(userId);
    await this.ctx.storage.delete(`clio_token:${userId}`);

    await this.appendAuditLog({
      user_id: userId,
      action: "user_leave",
      object_type: "org_membership",
      params: { expired_confirmations: expiredCount },
      result: "success",
    });

    return {
      success: true,
      message: `User removed from org. Expired ${expiredCount} pending confirmations.`,
    };
  }

  private async handleGDPRPurge(userId: string): Promise<DOResponse> {
    const deletedMessages = this.deleteUserMessages(userId);
    const expiredConfirmations = this.expireUserConfirmations(userId);
    await this.ctx.storage.delete(`clio_token:${userId}`);

    await this.appendAuditLog({
      user_id: `REDACTED-${crypto.randomUUID().slice(0, 8)}`,
      action: "gdpr_purge",
      object_type: "user_data",
      params: { deleted_messages: deletedMessages, expired_confirmations: expiredConfirmations },
      result: "success",
    });

    return {
      success: true,
      message: `Purged user data: ${deletedMessages} messages deleted.`,
      data: { deletedMessages, expiredConfirmations },
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/process-message") {
      try {
        const body = await request.json();
        if (!validateChannelMessage(body)) {
          return Response.json(
            { success: false, error: "Invalid message format" },
            { status: 400 }
          );
        }
        return Response.json(await this.processMessage(body));
      } catch (error) {
        console.error("[TenantDO] Process message error:", error);
        return Response.json(
          { success: false, error: "I'm having trouble connecting. Please try again in a moment." },
          { status: 500 }
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/user-leave") {
      const { userId } = (await request.json()) as { userId: string };
      if (!userId) {
        return Response.json({ success: false, error: "userId required" }, { status: 400 });
      }
      return Response.json(await this.handleUserLeave(userId));
    }

    if (request.method === "POST" && url.pathname === "/gdpr-purge") {
      const { userId } = (await request.json()) as { userId: string };
      if (!userId) {
        return Response.json({ success: false, error: "userId required" }, { status: 400 });
      }
      return Response.json(await this.handleGDPRPurge(userId));
    }

    if (request.method === "POST" && url.pathname === "/audit") {
      return Response.json(
        await this.appendAuditLog((await request.json()) as AuditEntryInput)
      );
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const conversations = this.sql.exec("SELECT COUNT(*) as count FROM conversations").one().count;
      const messages = this.sql.exec("SELECT COUNT(*) as count FROM messages").one().count;
      const pendingConfirmations = this.sql
        .exec("SELECT COUNT(*) as count FROM pending_confirmations WHERE expires_at > ?", Date.now())
        .one().count;

      return Response.json({
        orgId: this.orgId,
        stats: { conversations, messages, pendingConfirmations },
        schemaLoaded: this.schemaCache.size > 0,
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
