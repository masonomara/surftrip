import { DurableObject } from "cloudflare:workers";
import { getAuth } from "./lib/auth";

// ============================================================================
// Environment & Type Definitions
// ============================================================================

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
}

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

// ============================================================================
// Tenant Durable Object
// ============================================================================

export class TenantDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(() => this.migrate());
  }

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

  async appendAuditLog(entry: AuditEntryInput): Promise<{ id: string }> {
    const now = new Date();
    const id = crypto.randomUUID();

    // Build date-based path: orgs/{orgId}/audit/{year}/{month}/{day}/{timestamp}-{id}.json
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");
    const timestamp = now.getTime();

    const path = `orgs/${this.ctx.id}/audit/${year}/${month}/${day}/${timestamp}-${id}.json`;

    const auditEntry = {
      id,
      created_at: now.toISOString(),
      ...entry,
    };

    await this.env.R2.put(path, JSON.stringify(auditEntry), {
      httpMetadata: { contentType: "application/json" },
    });

    return { id };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/audit") {
      const input = (await request.json()) as AuditEntryInput;
      const result = await this.appendAuditLog(input);
      return Response.json(result);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * Handles Clio OAuth callback - exchanges auth code for tokens
 */
async function handleClioCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
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

  // Exchange authorization code for tokens
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
    const errorDetails = await tokenResponse.text();
    return Response.json(
      { error: "Token exchange failed", details: errorDetails },
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
 * Handles incoming bot messages (Teams Bot Framework format)
 */
async function handleBotMessage(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const activity = (await req.json()) as {
    type: string;
    id?: string;
    text?: string;
    from?: { id: string; name?: string };
    recipient?: { id: string };
    conversation?: { id: string };
    serviceUrl?: string;
  };

  // Validate required fields
  if (!activity.serviceUrl || !activity.conversation?.id) {
    return new Response(null, { status: 200 });
  }

  // Determine reply text based on activity type
  let replyText: string | null = null;

  if (activity.type === "message" && activity.text) {
    replyText = `Echo: ${activity.text}`;
  } else if (activity.type === "conversationUpdate") {
    replyText = "Welcome to Docket!";
  }

  // Send reply if we have one
  if (replyText) {
    const replyUrl = `${activity.serviceUrl}/v3/conversations/${activity.conversation.id}/activities`;

    await fetch(replyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "message",
        text: replyText,
        from: activity.recipient,
        recipient: activity.from,
        conversation: activity.conversation,
        replyToId: activity.id,
      }),
    });
  }

  return new Response(null, { status: 200 });
}

/**
 * Renders the auth demo page with sign-in/sign-up forms
 */
async function handleAuthDemo(req: Request, env: Env): Promise<Response> {
  const session = await getAuth(env).api.getSession({ headers: req.headers });

  const html = buildAuthDemoPage(session);

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

/**
 * Builds the HTML for the auth demo page
 */
function buildAuthDemoPage(
  session: {
    user: { email: string; id: string };
    session: { id: string; expiresAt: Date };
  } | null
): string {
  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Inter, -apple-system, sans-serif;
      background: #f7f7f7;
      min-height: 100vh;
      color: #fff;
      padding: 40px 20px;
    }
    .container { max-width: 500px; margin: 0 auto; }
    h1 { font-size: 2rem; text-align: center; margin-bottom: 8px; }
    .subtitle { text-align: center; color: #94a3b8; margin-bottom: 32px; }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      border: 1px solid rgba(0,0,0,.1);
    }
    .card h2 {
      font-size: 1rem;
      color: #000;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: .05em;
    }
    .status { padding: 12px 16px; border-radius: 8px; font-weight: 500; }
    .status-auth { background: rgba(16,185,129,.2); color: #10b981; }
    .status-unauth { background: rgba(239,68,68,.2); color: #ef4444; }
    .user-details {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
      margin-top: 16px;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: all .2s;
      margin: 4px;
    }
    .btn-google { background: #fff; color: #333; }
    .btn-apple { background: #000; color: #fff; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-secondary { background: #64748b; color: #fff; }
    .btn-danger { background: #ef4444; color: #fff; }
    .divider {
      display: flex;
      align-items: center;
      margin: 20px 0;
      color: #64748b;
    }
    .divider::before, .divider::after {
      content: "";
      flex: 1;
      border-bottom: 1px solid #334155;
    }
    .divider span {
      padding: 0 16px;
      font-size: 12px;
      text-transform: uppercase;
    }
    .form-group { margin-bottom: 16px; }
    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 14px;
      color: #94a3b8;
    }
    .input {
      width: 100%;
      padding: 12px;
      border: 1px solid #9d9d9d;
      border-radius: 8px;
      background: #fff;
      color: #000;
      font-size: 14px;
    }
    .input:focus { outline: none; border-color: #3b82f6; }
    .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .error, .success {
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 16px;
      display: none;
    }
    .error { background: rgba(239,68,68,.2); color: #ef4444; }
    .success { background: rgba(16,185,129,.2); color: #10b981; }
  `;

  const js = `
    async function signInGoogle() {
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: location.href })
      });
      const data = await res.json();
      if (data.url) location.href = data.url;
    }

    async function signInApple() {
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'apple', callbackURL: location.href })
      });
      const data = await res.json();
      if (data.url) location.href = data.url;
    }

    async function signUp(e) {
      e.preventDefault();
      const errorEl = document.getElementById('signup-error');
      const successEl = document.getElementById('signup-success');
      errorEl.style.display = 'none';
      successEl.style.display = 'none';

      const res = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('name').value,
          email: document.getElementById('email').value,
          password: document.getElementById('password').value
        })
      });

      const data = await res.json();
      if (data.user) {
        successEl.textContent = 'Account created! Redirecting...';
        successEl.style.display = 'block';
        setTimeout(() => location.reload(), 1000);
      } else {
        errorEl.textContent = data.error?.message || data.message || 'Sign up failed';
        errorEl.style.display = 'block';
      }
    }

    async function signIn(e) {
      e.preventDefault();
      const errorEl = document.getElementById('signin-error');
      errorEl.style.display = 'none';

      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('signin-email').value,
          password: document.getElementById('signin-password').value
        })
      });

      const data = await res.json();
      if (data.user) {
        location.reload();
      } else {
        errorEl.textContent = data.error?.message || data.message || 'Invalid credentials';
        errorEl.style.display = 'block';
      }
    }

    async function signOut() {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include'
      });
      location.reload();
    }
  `;

  const statusClass = session ? "status-auth" : "status-unauth";
  const statusText = session
    ? `Signed in as ${session.user.email}`
    : "Not signed in";

  let authContent: string;

  if (session) {
    // Authenticated view
    const userJson = JSON.stringify(session.user, null, 2);
    const sessionJson = JSON.stringify(
      { id: session.session.id, expiresAt: session.session.expiresAt },
      null,
      2
    );

    authContent = `
      <div class="card">
        <h2>User Details</h2>
        <div class="user-details">${userJson}</div>
        <div style="margin-top:16px">
          <button class="btn btn-danger" onclick="signOut()">Sign Out</button>
        </div>
      </div>
      <div class="card">
        <h2>Session Info</h2>
        <div class="user-details">${sessionJson}</div>
      </div>
    `;
  } else {
    // Unauthenticated view
    authContent = `
      <div class="card">
        <h2>Single Sign-On</h2>
        <div class="btn-row">
          <button class="btn btn-google" onclick="signInGoogle()">Sign in with Google</button>
          <button class="btn btn-apple" onclick="signInApple()">Sign in with Apple</button>
        </div>
      </div>

      <div class="divider"><span>or</span></div>

      <div class="card">
        <h2>Email Sign Up</h2>
        <div id="signup-error" class="error"></div>
        <div id="signup-success" class="success"></div>
        <form onsubmit="signUp(event)">
          <div class="form-group">
            <label>Name</label>
            <input type="text" id="name" class="input" required>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="email" class="input" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="password" class="input" required minlength="8">
          </div>
          <button type="submit" class="btn btn-primary">Create Account</button>
        </form>
      </div>

      <div class="card">
        <h2>Email Sign In</h2>
        <div id="signin-error" class="error"></div>
        <form onsubmit="signIn(event)">
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="signin-email" class="input" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="signin-password" class="input" required>
          </div>
          <button type="submit" class="btn btn-secondary">Sign In</button>
        </form>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Docket - Auth Demo</title>
  <style>${css}</style>
</head>
<body>
  <div class="container">
    <h1>Docket</h1>
    <p class="subtitle">Phase 4: Auth Foundation</p>

    <div class="card">
      <h2>Session Status</h2>
      <div class="status ${statusClass}">${statusText}</div>
    </div>

    ${authContent}
  </div>
  <script>${js}</script>
</body>
</html>`;
}

// ============================================================================
// Route Configuration
// ============================================================================

const routes: Record<string, (req: Request, env: Env) => Promise<Response>> = {
  "/api/messages": (req) => handleBotMessage(req),
  "/callback": handleClioCallback,
  "/": handleAuthDemo,
};

// ============================================================================
// Main Worker Entry Point
// ============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle Better Auth routes
    if (url.pathname.startsWith("/api/auth")) {
      try {
        return await getAuth(env).handler(request);
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    }

    // Handle registered routes
    const handler = routes[url.pathname];
    if (handler) {
      return handler(request, env);
    }

    // Return available routes for unknown paths
    return Response.json({ routes: Object.keys(routes) });
  },
};
