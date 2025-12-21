import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { getAuth } from "./lib/auth";
import {
  BotActivitySchema,
  AuditEntryInputSchema,
  type AuditEntryInput,
} from "./types/requests";

// Environment bindings for the Worker
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

/**
 * Parse and validate a JSON request body.
 * Returns a Response if validation fails, otherwise the parsed data.
 */
async function parseBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<T | Response> {
  try {
    const json = await request.json();
    return schema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
}

/**
 * Durable Object for per-tenant state.
 * Handles conversations, messages, and audit logs.
 */
export class TenantDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(() => this.migrate());
  }

  /**
   * Run schema migrations on first load.
   */
  private async migrate(): Promise<void> {
    const versionResult = this.sql.exec("PRAGMA user_version").one();
    const currentVersion = versionResult.user_version as number;

    if (currentVersion >= 1) {
      return;
    }

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

  /**
   * Append an entry to the org's audit log in R2.
   */
  async appendAuditLog(entry: AuditEntryInput): Promise<{ id: string }> {
    const now = new Date();
    const id = crypto.randomUUID();

    // Build path: orgs/{orgId}/audit/{year}/{month}/{day}/{timestamp}-{id}.json
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const path = `orgs/${
      this.ctx.id
    }/audit/${year}/${month}/${day}/${now.getTime()}-${id}.json`;

    const logEntry = {
      id,
      created_at: now.toISOString(),
      ...entry,
    };

    await this.env.R2.put(path, JSON.stringify(logEntry), {
      httpMetadata: { contentType: "application/json" },
    });

    return { id };
  }

  /**
   * Handle HTTP requests to the Durable Object.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/audit") {
      try {
        const body = await request.json();
        const entry = AuditEntryInputSchema.parse(body);
        const result = await this.appendAuditLog(entry);
        return Response.json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return Response.json(
            { error: "Validation failed", details: error.issues },
            { status: 400 }
          );
        }
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

/**
 * Handle OAuth callback from Clio.
 * Exchanges the authorization code for tokens.
 */
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
    return Response.json({ error: "Missing state parameter" }, { status: 400 });
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
    const errorText = await tokenResponse.text();
    return Response.json(
      { error: "Token exchange failed", details: errorText },
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

/**
 * Handle incoming bot messages from Teams/Slack.
 */
async function handleBotMessage(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const result = await parseBody(request, BotActivitySchema);
  if (result instanceof Response) {
    return result;
  }

  // Validate required fields for reply
  if (!result.serviceUrl || !result.conversation?.id) {
    return new Response(null, { status: 200 });
  }

  // Determine reply based on activity type
  let replyText: string | null = null;

  if (result.type === "message" && result.text) {
    replyText = `Echo: ${result.text}`;
  } else if (result.type === "conversationUpdate") {
    replyText = "Welcome to Docket!";
  }

  // Send reply if we have something to say
  if (replyText) {
    const replyUrl = `${result.serviceUrl}/v3/conversations/${result.conversation.id}/activities`;

    await fetch(replyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "message",
        text: replyText,
        from: result.recipient,
        recipient: result.from,
        conversation: result.conversation,
        replyToId: result.id,
      }),
    });
  }

  return new Response(null, { status: 200 });
}

/**
 * Main Worker fetch handler.
 * Routes requests to appropriate handlers.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Auth routes (handled by better-auth)
    if (url.pathname.startsWith("/api/auth")) {
      try {
        return await getAuth(env).handler(request);
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    }

    // Bot message endpoint
    if (url.pathname === "/api/messages") {
      return handleBotMessage(request);
    }

    // Clio OAuth callback
    if (url.pathname === "/callback") {
      return handleClioCallback(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
