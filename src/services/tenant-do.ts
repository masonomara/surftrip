import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";
import {
  type ChannelMessage,
  type DOResponse,
  type ProcessMessageResponse,
  validateChannelMessage,
} from "../types/channel";

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

interface StoredMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  user_id: string | null;
  created_at: number;
}

interface PendingConfirmation {
  id: string;
  conversation_id: string;
  user_id: string;
  action: string;
  object_type: string;
  params: string;
  created_at: number;
  expires_at: number;
}

const CONFIRMATION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONTEXT_MESSAGES = 15;

export class TenantDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private orgId: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.orgId = ctx.id.toString();
    ctx.blockConcurrencyWhile(() => this.migrate());
  }

  private async migrate(): Promise<void> {
    const currentVersion = this.sql.exec("PRAGMA user_version").one()
      .user_version as number;
    if (currentVersion >= 1) return;

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

  private async ensureConversation(
    conversationId: string,
    channelType: string,
    scope: string
  ): Promise<void> {
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

  private getRecentMessages(conversationId: string): StoredMessage[] {
    const rows = this.sql
      .exec(
        `SELECT id, conversation_id, role, content, user_id, created_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        conversationId,
        MAX_CONTEXT_MESSAGES
      )
      .toArray();
    return rows.reverse().map((row) => ({
      id: row.id as string,
      conversation_id: row.conversation_id as string,
      role: row.role as "user" | "assistant" | "system",
      content: row.content as string,
      user_id: row.user_id as string | null,
      created_at: row.created_at as number,
    }));
  }

  private async checkPermission(
    userId: string,
    userRole: string,
    operation: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Members can only do read operations
    // Admins can do all operations but CUD requires confirmation
    const isReadOperation = operation === "read" || operation === "query";

    if (userRole === "member" && !isReadOperation) {
      await this.appendAuditLog({
        user_id: userId,
        action: "permission_denied",
        object_type: "clio_operation",
        params: { operation, role: userRole },
        result: "error",
        error_message: "Member attempted non-read operation",
      });
      return { allowed: false, reason: "Members can only perform read operations" };
    }

    return { allowed: true };
  }

  // Reserved for Phase 7: CUD confirmation flow
  private _createPendingConfirmation(
    conversationId: string,
    userId: string,
    action: string,
    objectType: string,
    params: Record<string, unknown>
  ): PendingConfirmation {
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + CONFIRMATION_EXPIRY_MS;

    this.sql.exec(
      `INSERT INTO pending_confirmations
       (id, conversation_id, user_id, action, object_type, params, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      conversationId,
      userId,
      action,
      objectType,
      JSON.stringify(params),
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
      created_at: now,
      expires_at: expiresAt,
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
    return this.sql.exec(
      "SELECT changes() as count"
    ).one().count as number;
  }

  private deleteUserMessages(userId: string): number {
    // Get count first
    const count = this.sql
      .exec("SELECT COUNT(*) as count FROM messages WHERE user_id = ?", userId)
      .one().count as number;

    // Delete messages
    this.sql.exec("DELETE FROM messages WHERE user_id = ?", userId);

    return count;
  }

  private async processMessage(msg: ChannelMessage): Promise<ProcessMessageResponse> {
    // Validate org identity
    if (!this.validateOrgId(msg.orgId)) {
      return {
        success: false,
        conversationId: msg.conversationId,
        error: "Organization mismatch",
      };
    }

    // Ensure conversation exists
    await this.ensureConversation(
      msg.conversationId,
      msg.channel,
      msg.conversationScope
    );

    // Store user message
    this.storeMessage(msg.conversationId, "user", msg.message, msg.userId);

    // Get conversation history for context
    const history = this.getRecentMessages(msg.conversationId);

    // Check permissions (placeholder - actual LLM will determine operation type)
    const permCheck = await this.checkPermission(msg.userId, msg.userRole, "read");
    if (!permCheck.allowed) {
      const response = `I'm sorry, but ${permCheck.reason?.toLowerCase() || "you don't have permission for this action"}.`;
      this.storeMessage(msg.conversationId, "assistant", response, null);
      return {
        success: true,
        conversationId: msg.conversationId,
        responseText: response,
      };
    }

    // Placeholder response (LLM integration in Phase 7)
    const responseText = `[Phase 7 will process: "${msg.message}"] Context: ${history.length} messages in history.`;
    this.storeMessage(msg.conversationId, "assistant", responseText, null);

    return {
      success: true,
      conversationId: msg.conversationId,
      responseText,
      data: {
        historyCount: history.length,
        channel: msg.channel,
        scope: msg.conversationScope,
      },
    };
  }

  private async handleUserLeave(userId: string): Promise<DOResponse> {
    // Expire pending confirmations
    const expiredCount = this.expireUserConfirmations(userId);

    // Delete Clio token from DO Storage (if exists)
    const tokenKey = `clio_token:${userId}`;
    await this.ctx.storage.delete(tokenKey);

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
    // Delete all user messages
    const deletedMessages = this.deleteUserMessages(userId);

    // Expire confirmations
    const expiredConfirmations = this.expireUserConfirmations(userId);

    // Delete Clio token
    await this.ctx.storage.delete(`clio_token:${userId}`);

    await this.appendAuditLog({
      user_id: `REDACTED-${crypto.randomUUID().slice(0, 8)}`,
      action: "gdpr_purge",
      object_type: "user_data",
      params: {
        deleted_messages: deletedMessages,
        expired_confirmations: expiredConfirmations,
      },
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

    // POST /process-message - Main message processing endpoint
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
        return Response.json(
          {
            success: false,
            error: "I'm having trouble connecting. Please try again in a moment.",
          },
          { status: 500 }
        );
      }
    }

    // POST /user-leave - Handle user leaving org
    if (request.method === "POST" && url.pathname === "/user-leave") {
      const { userId } = (await request.json()) as { userId: string };
      if (!userId) {
        return Response.json(
          { success: false, error: "userId required" },
          { status: 400 }
        );
      }
      return Response.json(await this.handleUserLeave(userId));
    }

    // POST /gdpr-purge - Handle GDPR deletion
    if (request.method === "POST" && url.pathname === "/gdpr-purge") {
      const { userId } = (await request.json()) as { userId: string };
      if (!userId) {
        return Response.json(
          { success: false, error: "userId required" },
          { status: 400 }
        );
      }
      return Response.json(await this.handleGDPRPurge(userId));
    }

    // POST /audit - Append audit log entry
    if (request.method === "POST" && url.pathname === "/audit") {
      return Response.json(
        await this.appendAuditLog((await request.json()) as AuditEntryInput)
      );
    }

    // GET /status - Health check and stats
    if (request.method === "GET" && url.pathname === "/status") {
      const conversations = this.sql
        .exec("SELECT COUNT(*) as count FROM conversations")
        .one().count;
      const messages = this.sql
        .exec("SELECT COUNT(*) as count FROM messages")
        .one().count;
      const pendingConfirmations = this.sql
        .exec(
          "SELECT COUNT(*) as count FROM pending_confirmations WHERE expires_at > ?",
          Date.now()
        )
        .one().count;

      return Response.json({
        orgId: this.orgId,
        stats: { conversations, messages, pendingConfirmations },
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
