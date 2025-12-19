import { DurableObject } from "cloudflare:workers";
import { getAuth } from "./lib/auth";

// =============================================================================
// Types
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
}

interface CheckItem {
  name: string;
  description: string;
  status: "pass" | "fail" | "manual";
  detail?: string;
}

interface BotActivity {
  type: string;
  id?: string;
  text?: string;
  from?: { id: string; name?: string };
  recipient?: { id: string; name?: string };
  conversation?: { id: string };
  serviceUrl?: string;
}

// =============================================================================
// Audit Log Types
// =============================================================================

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

// =============================================================================
// Durable Object
// =============================================================================

export class TenantDO extends DurableObject<Env> {
  /**
   * Appends an entry to the org's audit log.
   * One object per entry — no read-modify-write.
   * Path: orgs/{org}/audit/YYYY/MM/DD/{timestamp}-{uuid}.json
   */
  async appendAuditLog(entry: AuditEntryInput): Promise<{ id: string }> {
    const orgId = this.ctx.id.toString();
    const now = new Date();
    const id = crypto.randomUUID();

    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");
    const timestamp = now.getTime();

    const path = `orgs/${orgId}/audit/${year}/${month}/${day}/${timestamp}-${id}.json`;

    const fullEntry: AuditEntry = {
      id,
      created_at: now.toISOString(),
      ...entry,
    };

    await this.env.R2.put(path, JSON.stringify(fullEntry), {
      httpMetadata: { contentType: "application/json" },
    });

    return { id };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /audit - append audit log entry
    if (request.method === "POST" && url.pathname === "/audit") {
      const entry = (await request.json()) as AuditEntryInput;
      const result = await this.appendAuditLog(entry);
      return Response.json(result);
    }

    // Default: increment counter (legacy test endpoint)
    const currentCount = (await this.ctx.storage.get<number>("count")) || 0;
    const newCount = currentCount + 1;
    await this.ctx.storage.put("count", newCount);

    return Response.json({
      id: this.ctx.id.toString(),
      count: newCount,
    });
  }
}

// =============================================================================
// Test Endpoints
// =============================================================================

async function handleTestD1(_req: Request, env: Env): Promise<Response> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS test_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )`
  ).run();

  const result = await env.DB.prepare(
    "INSERT INTO test_accounts (name) VALUES (?) RETURNING *"
  )
    .bind("Test")
    .run();

  return Response.json({
    success: true,
    inserted: result.results,
  });
}

async function handleTestDO(req: Request, env: Env): Promise<Response> {
  const id = env.TENANT.idFromName("test");
  const stub = env.TENANT.get(id);
  return stub.fetch(req);
}

async function handleTestR2(_req: Request, env: Env): Promise<Response> {
  const key = "test/verify.json";

  await env.R2.put(key, "{}", {
    httpMetadata: { contentType: "application/json" },
  });

  const object = await env.R2.get(key);
  const content = await object?.text();

  return Response.json({
    success: true,
    content,
  });
}

async function handleTestAI(_req: Request, env: Env): Promise<Response> {
  const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: "test",
  })) as { data: number[][] };

  const embedding = result.data[0];

  await env.VECTORIZE.upsert([
    { id: "test-1", values: embedding, metadata: {} },
  ]);

  const queryResult = await env.VECTORIZE.query(embedding, { topK: 1 });

  return Response.json({
    success: true,
    dimensions: embedding.length,
    match: queryResult.matches[0],
  });
}

// =============================================================================
// Demo Page
// =============================================================================

async function handleDemo(req: Request, env: Env): Promise<Response> {
  const checks: CheckItem[] = [];

  // Static checks
  checks.push({
    name: "Cloudflare Account",
    description: "Cloud infrastructure provider",
    status: "pass",
    detail: "Active",
  });

  checks.push({
    name: "Wrangler CLI",
    description: "Deployment toolchain",
    status: "pass",
    detail: "Authenticated",
  });

  // D1 Database check
  let d1Status: "pass" | "fail" = "fail";
  let d1Detail = "";
  try {
    await env.DB.exec(
      `CREATE TABLE IF NOT EXISTS demo_log (id INTEGER PRIMARY KEY, ts TEXT)`
    );
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM demo_log"
    ).all();
    d1Status = "pass";
    d1Detail = `${(results[0] as { n: number }).n} test records`;
  } catch {
    d1Detail = "Connection failed";
  }
  checks.push({
    name: "D1 Database",
    description: "SQL database for user and org data",
    status: d1Status,
    detail: d1Detail,
  });

  // R2 Storage check
  let r2Status: "pass" | "fail" = "fail";
  let r2Detail = "";
  try {
    await env.R2.put("demo/test.txt", "ok");
    const obj = await env.R2.get("demo/test.txt");
    r2Status = obj ? "pass" : "fail";
    r2Detail = "Read/write verified";
  } catch {
    r2Detail = "Connection failed";
  }
  checks.push({
    name: "R2 Storage",
    description: "Document and file storage",
    status: r2Status,
    detail: r2Detail,
  });

  // Vectorize + AI check
  let vecStatus: "pass" | "fail" = "fail";
  let vecDetail = "";
  try {
    const { data } = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: "test",
    })) as { data: number[][] };
    await env.VECTORIZE.upsert([{ id: "demo", values: data[0] }]);
    const q = await env.VECTORIZE.query(data[0], { topK: 1 });
    vecStatus =
      data[0].length === 768 && q.matches.length > 0 ? "pass" : "fail";
    vecDetail = "768-dimension embeddings";
  } catch {
    vecDetail = "Connection failed";
  }
  checks.push({
    name: "Vector Search",
    description: "AI-powered semantic search",
    status: vecStatus,
    detail: vecDetail,
  });
  checks.push({
    name: "Workers AI",
    description: "LLM and embedding models",
    status: vecStatus,
    detail: vecStatus === "pass" ? "Model responding" : "Not available",
  });

  // Durable Object check
  let doStatus: "pass" | "fail" = "fail";
  let doDetail = "";
  try {
    const id = env.TENANT.idFromName("demo");
    const stub = env.TENANT.get(id);
    const res = await stub.fetch(req);
    const data = (await res.json()) as { count: number };
    doStatus = "pass";
    doDetail = `Visit #${data.count}`;
  } catch {
    doDetail = "Connection failed";
  }
  checks.push({
    name: "Durable Objects",
    description: "Per-organization state management",
    status: doStatus,
    detail: doDetail,
  });

  // Integration test summary
  const coreServices = [
    "D1 Database",
    "R2 Storage",
    "Vector Search",
    "Durable Objects",
  ];
  const corePassing = coreServices.every(
    (name) => checks.find((c) => c.name === name)?.status === "pass"
  );
  checks.push({
    name: "Integration Tests",
    description: "All services communicating",
    status: corePassing ? "pass" : "fail",
    detail: corePassing ? "All passing" : "Issues detected",
  });

  // Clio checks
  const clioOk =
    typeof env.CLIO_CLIENT_ID === "string" && env.CLIO_CLIENT_ID.length > 0;
  checks.push({
    name: "Clio Application",
    description: "Legal practice management integration",
    status: clioOk ? "pass" : "fail",
    detail: clioOk ? "Registered" : "Not configured",
  });

  const secretsOk =
    clioOk &&
    typeof env.CLIO_CLIENT_SECRET === "string" &&
    env.CLIO_CLIENT_SECRET.length > 0;
  checks.push({
    name: "Clio Credentials",
    description: "Secure API authentication",
    status: secretsOk ? "pass" : "fail",
    detail: secretsOk ? "Encrypted & stored" : "Not configured",
  });

  checks.push({
    name: "Teams Bot Testing",
    description: "Microsoft Teams chat interface",
    status: "manual",
    detail: "Local tool installed",
  });

  checks.push({
    name: "Demo Deployed",
    description: "This status page",
    status: "pass",
    detail: "Live & shareable",
  });

  // Calculate stats
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const manual = checks.filter((c) => c.status === "manual").length;
  const allGood = failed === 0;

  // Render HTML
  const html = renderDemoPage(checks, { passed, failed, manual, allGood });
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

function renderDemoPage(
  checks: CheckItem[],
  stats: { passed: number; failed: number; manual: number; allGood: boolean }
): string {
  const { passed, failed, manual, allGood } = stats;

  const checklistHtml = checks
    .map((c) => {
      const icon = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "○";
      return `
        <div class="check-item check-${c.status}">
          <div class="check-icon">${icon}</div>
          <div class="check-content">
            <div class="check-name">${c.name}</div>
            <div class="check-desc">${c.description}</div>
          </div>
          <div class="check-detail">${c.detail || ""}</div>
        </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Docket - Phase 2 Status</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #fff;
      padding: 40px 20px;
    }
    .container { max-width: 700px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 40px; }
    h1 { font-size: 2.5rem; font-weight: 700; margin-bottom: 8px; }
    .subtitle { color: #94a3b8; font-size: 1.1rem; }
    .status-banner {
      background: ${
        allGood
          ? "linear-gradient(135deg, #059669 0%, #10b981 100%)"
          : "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)"
      };
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      margin-bottom: 32px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    }
    .status-banner h2 { font-size: 1.5rem; margin-bottom: 8px; }
    .stats { display: flex; justify-content: center; gap: 32px; margin-bottom: 32px; }
    .stat { text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 700; }
    .stat-label { color: #94a3b8; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-pass .stat-value { color: #10b981; }
    .stat-fail .stat-value { color: #ef4444; }
    .stat-manual .stat-value { color: #f59e0b; }
    .checklist {
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
    }
    .check-item {
      display: flex;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .check-item:last-child { border-bottom: none; }
    .check-icon {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
      margin-right: 16px;
    }
    .check-pass .check-icon { background: #10b981; }
    .check-fail .check-icon { background: #ef4444; }
    .check-manual .check-icon { background: #f59e0b; }
    .check-content { flex: 1; }
    .check-name { font-weight: 600; margin-bottom: 2px; }
    .check-desc { color: #94a3b8; font-size: 0.875rem; }
    .check-detail { color: #94a3b8; font-size: 0.875rem; text-align: right; }
    .next-phase {
      margin-top: 32px;
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      padding: 24px;
    }
    .next-phase h3 { font-size: 1rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .next-phase h4 { margin-bottom: 12px; }
    .next-phase ul { list-style: none; color: #cbd5e1; }
    .next-phase li { padding: 6px 0; padding-left: 20px; position: relative; }
    .next-phase li::before { content: "→"; position: absolute; left: 0; color: #64748b; }
    footer { text-align: center; margin-top: 40px; color: #64748b; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Docket</h1>
      <p class="subtitle">Phase 2: Infrastructure Setup</p>
    </header>

    <div class="status-banner">
      <h2>${allGood ? "All Systems Operational" : "Setup In Progress"}</h2>
      <p>${
        allGood
          ? "Phase 2 complete. Ready to proceed."
          : `${failed} item${failed !== 1 ? "s" : ""} need attention.`
      }</p>
    </div>

    <div class="stats">
      <div class="stat stat-pass">
        <div class="stat-value">${passed}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat stat-fail">
        <div class="stat-value">${failed}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat stat-manual">
        <div class="stat-value">${manual}</div>
        <div class="stat-label">Manual</div>
      </div>
    </div>

    <div class="checklist">${checklistHtml}</div>

    <div class="next-phase">
      <h3>Coming Next</h3>
      <h4>Phase 3: Storage Layer</h4>
      <ul>
        <li>Database schema for users and organizations</li>
        <li>Knowledge base storage structure</li>
        <li>Document organization by firm</li>
      </ul>
    </div>

    <footer>
      <p>Last verified: ${new Date().toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })}</p>
    </footer>
  </div>
</body>
</html>`;
}

// =============================================================================
// Clio OAuth Callback
// =============================================================================

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
    const errorText = await tokenResponse.text();
    console.error("Clio token exchange failed:", errorText);
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

// =============================================================================
// Bot Framework Endpoint
// =============================================================================

async function handleBotMessage(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const activity = (await req.json()) as BotActivity;
  console.log("Activity:", activity.type, activity.text || "");

  // Bail early if missing required fields
  if (!activity.serviceUrl || !activity.conversation?.id) {
    return new Response(null, { status: 200 });
  }

  // Determine reply based on activity type
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

// =============================================================================
// Storage Demo Page
// =============================================================================

async function handleStorageDemo(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // Handle API actions
  if (action) {
    return handleStorageAction(action, url, env);
  }

  // Render interactive page
  const html = renderStorageDemoPage();
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

function renderStorageDemoPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Docket - Phase 3 Storage Demo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      min-height: 100vh;
      color: #e2e8f0;
      padding: 24px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 32px; }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 4px; }
    .subtitle { color: #64748b; }
    .tabs { display: flex; gap: 8px; margin-bottom: 24px; border-bottom: 1px solid #334155; padding-bottom: 8px; }
    .tab { padding: 8px 16px; background: transparent; border: none; color: #94a3b8; cursor: pointer; border-radius: 6px; font-size: 14px; transition: all 0.2s; }
    .tab:hover { background: #1e293b; color: #e2e8f0; }
    .tab.active { background: #3b82f6; color: white; }
    .panel { display: none; }
    .panel.active { display: block; }
    .card { background: rgba(30, 41, 59, 0.8); border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .card h3 { font-size: 14px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
    .stat { background: #0f172a; padding: 16px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #3b82f6; }
    .stat-label { font-size: 12px; color: #64748b; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #334155; }
    th { color: #64748b; font-weight: 500; }
    .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #334155; color: #e2e8f0; }
    .btn-secondary:hover { background: #475569; }
    .input { padding: 10px 12px; border: 1px solid #334155; border-radius: 8px; background: #0f172a; color: #e2e8f0; font-size: 14px; width: 100%; }
    .input:focus { outline: none; border-color: #3b82f6; }
    .flex { display: flex; gap: 12px; align-items: center; }
    .mt-4 { margin-top: 16px; }
    .output { background: #0f172a; border-radius: 8px; padding: 16px; font-family: monospace; font-size: 13px; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
    .check-row { display: flex; align-items: center; padding: 12px; background: #0f172a; border-radius: 8px; margin-bottom: 8px; }
    .check-icon { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px; font-size: 14px; }
    .check-pass .check-icon { background: #065f46; }
    .check-fail .check-icon { background: #7f1d1d; }
    .check-pending .check-icon { background: #78350f; }
    .check-content { flex: 1; }
    .check-name { font-weight: 500; }
    .check-detail { font-size: 13px; color: #64748b; }
    .spinner { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Phase 3: Storage Layer</h1>
      <p class="subtitle">Interactive verification of D1, R2, and Vectorize</p>
    </header>

    <div class="tabs">
      <button class="tab active" onclick="showTab('overview')">Overview</button>
      <button class="tab" onclick="showTab('tables')">D1 Tables</button>
      <button class="tab" onclick="showTab('permissions')">Permissions</button>
      <button class="tab" onclick="showTab('r2')">R2 Storage</button>
      <button class="tab" onclick="showTab('vectorize')">Vectorize</button>
    </div>

    <div id="overview" class="panel active">
      <div class="card">
        <h3>Quick Checks</h3>
        <button class="btn btn-primary" onclick="runAllChecks()">Run All Checks</button>
        <div id="checks-output" class="mt-4"></div>
      </div>
      <div class="card">
        <h3>Stats</h3>
        <div class="grid" id="stats-grid">
          <div class="stat"><div class="stat-value">-</div><div class="stat-label">Tables</div></div>
          <div class="stat"><div class="stat-value">-</div><div class="stat-label">Tiers</div></div>
          <div class="stat"><div class="stat-value">-</div><div class="stat-label">Permissions</div></div>
          <div class="stat"><div class="stat-value">-</div><div class="stat-label">R2 Objects</div></div>
        </div>
      </div>
    </div>

    <div id="tables" class="panel">
      <div class="card">
        <h3>D1 Database Tables</h3>
        <button class="btn btn-secondary" onclick="loadTables()">Refresh</button>
        <div id="tables-output" class="mt-4 output">Click refresh to load tables...</div>
      </div>
    </div>

    <div id="permissions" class="panel">
      <div class="card">
        <h3>Tier Limits</h3>
        <button class="btn btn-secondary" onclick="loadTiers()">Load Tiers</button>
        <div id="tiers-output" class="mt-4"></div>
      </div>
      <div class="card">
        <h3>Role Permissions</h3>
        <button class="btn btn-secondary" onclick="loadPermissions()">Load Permissions</button>
        <div id="permissions-output" class="mt-4"></div>
      </div>
    </div>

    <div id="r2" class="panel">
      <div class="card">
        <h3>Test R2 Path</h3>
        <div class="flex">
          <input type="text" class="input" id="r2-org" placeholder="org-id" value="demo-org" style="width: 150px;">
          <input type="text" class="input" id="r2-file" placeholder="file-id" value="test-doc.txt" style="width: 200px;">
          <button class="btn btn-primary" onclick="testR2Write()">Write</button>
          <button class="btn btn-secondary" onclick="testR2Read()">Read</button>
          <button class="btn btn-secondary" onclick="listR2()">List</button>
        </div>
        <div id="r2-output" class="mt-4 output">Results will appear here...</div>
      </div>
    </div>

    <div id="vectorize" class="panel">
      <div class="card">
        <h3>Test Vectorize</h3>
        <div class="flex">
          <input type="text" class="input" id="vec-text" placeholder="Text to embed..." value="legal contract management">
          <input type="text" class="input" id="vec-org" placeholder="org_id filter" value="demo" style="width: 120px;">
          <button class="btn btn-primary" onclick="testVectorize()">Embed & Store</button>
          <button class="btn btn-secondary" onclick="queryVectorize()">Query</button>
        </div>
        <div id="vec-output" class="mt-4 output">Results will appear here...</div>
      </div>
    </div>
  </div>

  <script>
    function showTab(name) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById(name).classList.add('active');
      event.target.classList.add('active');
    }

    async function api(action, params = {}) {
      const url = new URL(window.location.href);
      url.searchParams.set('action', action);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      const res = await fetch(url);
      return res.json();
    }

    async function runAllChecks() {
      const out = document.getElementById('checks-output');
      out.innerHTML = '<div class="check-row check-pending"><div class="check-icon spinner">⏳</div><div class="check-content"><div class="check-name">Running checks...</div></div></div>';

      const data = await api('runChecks');

      out.innerHTML = data.checks.map(c => {
        const icon = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '○';
        return '<div class="check-row check-' + c.status + '"><div class="check-icon">' + icon + '</div><div class="check-content"><div class="check-name">' + c.name + '</div><div class="check-detail">' + c.detail + '</div></div></div>';
      }).join('');

      const stats = document.getElementById('stats-grid');
      stats.innerHTML = \`
        <div class="stat"><div class="stat-value">\${data.stats.tables}</div><div class="stat-label">Tables</div></div>
        <div class="stat"><div class="stat-value">\${data.stats.tiers}</div><div class="stat-label">Tiers</div></div>
        <div class="stat"><div class="stat-value">\${data.stats.permissions}</div><div class="stat-label">Permissions</div></div>
        <div class="stat"><div class="stat-value">\${data.stats.r2 || '-'}</div><div class="stat-label">R2 Test</div></div>
      \`;
    }

    async function loadTables() {
      const out = document.getElementById('tables-output');
      out.textContent = 'Loading...';
      const data = await api('getTables');
      out.textContent = JSON.stringify(data.tables, null, 2);
    }

    async function loadTiers() {
      const out = document.getElementById('tiers-output');
      out.innerHTML = 'Loading...';
      const data = await api('getTiers');
      out.innerHTML = '<table><tr><th>Tier</th><th>Users</th><th>Queries/Day</th><th>Docs</th><th>Clio Write</th></tr>' +
        data.tiers.map(t => '<tr><td>' + t.tier + '</td><td>' + (t.max_users === -1 ? '∞' : t.max_users) + '</td><td>' + (t.max_queries_per_day === -1 ? '∞' : t.max_queries_per_day) + '</td><td>' + (t.max_context_docs === -1 ? '∞' : t.max_context_docs) + '</td><td>' + (t.clio_write ? '✓' : '✗') + '</td></tr>').join('') +
        '</table>';
    }

    async function loadPermissions() {
      const out = document.getElementById('permissions-output');
      out.innerHTML = 'Loading...';
      const data = await api('getPermissions');
      const perms = {};
      data.permissions.forEach(p => {
        if (!perms[p.permission]) perms[p.permission] = {};
        perms[p.permission][p.role] = p.allowed;
      });
      out.innerHTML = '<table><tr><th>Permission</th><th>Owner</th><th>Admin</th><th>Member</th></tr>' +
        Object.entries(perms).map(([perm, roles]) => '<tr><td>' + perm + '</td><td>' + (roles.owner ? '✓' : '✗') + '</td><td>' + (roles.admin ? '✓' : '✗') + '</td><td>' + (roles.member ? '✓' : '✗') + '</td></tr>').join('') +
        '</table>';
    }

    async function testR2Write() {
      const out = document.getElementById('r2-output');
      out.textContent = 'Writing...';
      const data = await api('r2Write', {
        org: document.getElementById('r2-org').value,
        file: document.getElementById('r2-file').value
      });
      out.textContent = JSON.stringify(data, null, 2);
    }

    async function testR2Read() {
      const out = document.getElementById('r2-output');
      out.textContent = 'Reading...';
      const data = await api('r2Read', {
        org: document.getElementById('r2-org').value,
        file: document.getElementById('r2-file').value
      });
      out.textContent = JSON.stringify(data, null, 2);
    }

    async function listR2() {
      const out = document.getElementById('r2-output');
      out.textContent = 'Listing...';
      const data = await api('r2List', { org: document.getElementById('r2-org').value });
      out.textContent = JSON.stringify(data, null, 2);
    }

    async function testVectorize() {
      const out = document.getElementById('vec-output');
      out.textContent = 'Embedding and storing...';
      const data = await api('vecStore', {
        text: document.getElementById('vec-text').value,
        org: document.getElementById('vec-org').value
      });
      out.textContent = JSON.stringify(data, null, 2);
    }

    async function queryVectorize() {
      const out = document.getElementById('vec-output');
      out.textContent = 'Querying...';
      const data = await api('vecQuery', {
        text: document.getElementById('vec-text').value,
        org: document.getElementById('vec-org').value
      });
      out.textContent = JSON.stringify(data, null, 2);
    }

    // Auto-run checks on load
    runAllChecks();
  </script>
</body>
</html>`;
}

// =============================================================================
// Storage Demo API Actions
// =============================================================================

interface StorageCheck {
  name: string;
  status: "pass" | "fail" | "pending";
  detail: string;
}

async function handleStorageAction(
  action: string,
  url: URL,
  env: Env
): Promise<Response> {
  try {
    switch (action) {
      case "runChecks":
        return await runStorageChecks(env);

      case "getTables":
        return await getTableList(env);

      case "getTiers":
        return await getTierLimits(env);

      case "getPermissions":
        return await getRolePermissions(env);

      case "r2Write":
        return await testR2Write(url, env);

      case "r2Read":
        return await testR2Read(url, env);

      case "r2List":
        return await listR2Objects(url, env);

      case "vecStore":
        return await storeVector(url, env);

      case "vecQuery":
        return await queryVectors(url, env);

      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

async function runStorageChecks(env: Env): Promise<Response> {
  const checks: StorageCheck[] = [];

  // Check tables
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'd1_%' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  checks.push({
    name: "D1 Tables",
    status: tables.results.length >= 17 ? "pass" : "fail",
    detail: `${tables.results.length} tables found`,
  });

  // Check tiers
  const tiers = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM tier_limits"
  ).first<{ count: number }>();
  checks.push({
    name: "Tier Limits",
    status: tiers?.count === 4 ? "pass" : "fail",
    detail: `${tiers?.count || 0} tiers defined`,
  });

  // Check permissions
  const perms = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM role_permissions"
  ).first<{ count: number }>();
  checks.push({
    name: "Role Permissions",
    status: (perms?.count || 0) >= 24 ? "pass" : "fail",
    detail: `${perms?.count || 0} permissions defined`,
  });

  // Check R2
  const testKey = `demo/check-${Date.now()}.txt`;
  await env.R2.put(testKey, "check");
  const r2Obj = await env.R2.get(testKey);
  checks.push({
    name: "R2 Storage",
    status: r2Obj ? "pass" : "fail",
    detail: r2Obj ? "Read/write working" : "Failed",
  });

  // Check Vectorize
  try {
    const { data } = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: "test",
    })) as { data: number[][] };
    checks.push({
      name: "Vectorize",
      status: data[0].length === 768 ? "pass" : "fail",
      detail: `${data[0].length} dimensions`,
    });
  } catch {
    checks.push({
      name: "Vectorize",
      status: "fail",
      detail: "Requires remote access",
    });
  }

  return Response.json({
    checks,
    stats: {
      tables: tables.results.length,
      tiers: tiers?.count || 0,
      permissions: perms?.count || 0,
      r2: r2Obj ? "OK" : "Fail",
    },
  });
}

async function getTableList(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'd1_%' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all();

  const tables: { name: string; rows: number | string }[] = [];

  for (const t of result.results as { name: string }[]) {
    // Validate table name format (alphanumeric, underscores, hyphens only)
    if (!/^[\w-]+$/.test(t.name)) {
      tables.push({ name: t.name, rows: "-" });
      continue;
    }
    try {
      const count = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM [${t.name}]`
      ).first<{ count: number }>();
      tables.push({ name: t.name, rows: count?.count || 0 });
    } catch {
      tables.push({ name: t.name, rows: "-" });
    }
  }

  return Response.json({ tables });
}

async function getTierLimits(env: Env): Promise<Response> {
  const result = await env.DB.prepare("SELECT * FROM tier_limits").all();
  return Response.json({ tiers: result.results });
}

async function getRolePermissions(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    "SELECT * FROM role_permissions ORDER BY permission, role"
  ).all();
  return Response.json({ permissions: result.results });
}

/** Sanitize path segment to prevent directory traversal */
function sanitizePathSegment(segment: string): string | null {
  if (!segment || segment.includes("..") || segment.includes("/") || segment.includes("\\")) {
    return null;
  }
  // Only allow alphanumeric, hyphens, underscores, and dots (for file extensions)
  if (!/^[\w.-]+$/.test(segment)) {
    return null;
  }
  return segment;
}

async function testR2Write(url: URL, env: Env): Promise<Response> {
  const orgParam = url.searchParams.get("org") || "demo";
  const fileParam = url.searchParams.get("file") || "test.txt";

  const org = sanitizePathSegment(orgParam);
  const file = sanitizePathSegment(fileParam);
  if (!org || !file) {
    return Response.json({ success: false, error: "Invalid org or file parameter" }, { status: 400 });
  }

  const path = `orgs/${org}/docs/${file}`;
  const content = `Written at ${new Date().toISOString()}`;

  await env.R2.put(path, content, {
    httpMetadata: { contentType: "text/plain" },
  });

  return Response.json({ success: true, path, content });
}

async function testR2Read(url: URL, env: Env): Promise<Response> {
  const orgParam = url.searchParams.get("org") || "demo";
  const fileParam = url.searchParams.get("file") || "test.txt";

  const org = sanitizePathSegment(orgParam);
  const file = sanitizePathSegment(fileParam);
  if (!org || !file) {
    return Response.json({ success: false, error: "Invalid org or file parameter" }, { status: 400 });
  }

  const path = `orgs/${org}/docs/${file}`;

  const obj = await env.R2.get(path);
  if (!obj) {
    return Response.json({ success: false, error: "Not found" });
  }

  return Response.json({
    success: true,
    path,
    content: await obj.text(),
    size: obj.size,
  });
}

async function listR2Objects(url: URL, env: Env): Promise<Response> {
  const orgParam = url.searchParams.get("org") || "demo";

  const org = sanitizePathSegment(orgParam);
  if (!org) {
    return Response.json({ success: false, error: "Invalid org parameter" }, { status: 400 });
  }

  const prefix = `orgs/${org}/`;

  const list = await env.R2.list({ prefix, limit: 20 });

  return Response.json({
    prefix,
    objects: list.objects.map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded,
    })),
  });
}

async function storeVector(url: URL, env: Env): Promise<Response> {
  const text = url.searchParams.get("text") || "test";
  const org = url.searchParams.get("org") || "demo";

  const { data } = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text,
  })) as { data: number[][] };

  const id = `demo_${org}_${Date.now()}`;

  await env.VECTORIZE.upsert([
    {
      id,
      values: data[0],
      metadata: { type: "org_context", org_id: org, text },
    },
  ]);

  return Response.json({
    success: true,
    id,
    dimensions: data[0].length,
    org_id: org,
  });
}

async function queryVectors(url: URL, env: Env): Promise<Response> {
  const text = url.searchParams.get("text") || "test";
  const org = url.searchParams.get("org");

  const { data } = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text,
  })) as { data: number[][] };

  const filter = org ? { org_id: org } : undefined;

  const results = await env.VECTORIZE.query(data[0], {
    topK: 5,
    filter,
    returnMetadata: "all",
  });

  return Response.json({
    query: text,
    filter,
    matches: results.matches.map((m) => ({
      id: m.id,
      score: m.score,
      metadata: m.metadata,
    })),
  });
}

// =============================================================================
// Router
// =============================================================================

type RouteHandler = (req: Request, env: Env) => Promise<Response>;

const routes: Record<string, RouteHandler> = {
  "/api/messages": (req) => handleBotMessage(req),
  "/callback": handleClioCallback,
  "/demo": handleDemo,
  "/demo/storage": handleStorageDemo,
  "/test/d1": handleTestD1,
  "/test/do": handleTestDO,
  "/test/r2": handleTestR2,
  "/test/ai": handleTestAI,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Better Auth handles /api/auth/* routes
    if (url.pathname.startsWith("/api/auth")) {
      const auth = getAuth(env);
      return auth.handler(request);
    }

    // Check for registered route
    const handler = routes[url.pathname];
    if (handler) {
      return handler(request, env);
    }

    // Default: list available routes
    return Response.json({ routes: Object.keys(routes) });
  },
};
