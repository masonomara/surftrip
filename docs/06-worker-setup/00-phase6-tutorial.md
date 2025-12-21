# Phase 6: Core Worker + Durable Object Tutorial

**LONGER DOC**

This tutorial walks through building Docket's Core Worker and Durable Object layer. By the end, you'll understand:

- Why Durable Objects exist and how they solve multi-tenant state isolation
- The request flow from Channel Adapter to DO to response
- DO SQLite for per-org data, DO Storage for encrypted secrets
- Permission enforcement and audit logging patterns

## What You're Building

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Teams/Slack    │───▶│  Core Worker    │───▶│  TenantDO       │
│  Channel        │    │  (Router)       │    │  (Per-Org)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │                      │
                              ▼                      ▼
                       ┌───────────┐          ┌───────────┐
                       │    D1     │          │ DO SQLite │
                       │  (Global) │          │ (Per-Org) │
                       └───────────┘          └───────────┘
```

**Core Worker** receives messages from channel adapters, looks up org/user context in D1, and routes to the correct Durable Object.

**TenantDO** is one instance per organization. It holds conversations, messages, pending confirmations, org settings, and cached Clio schema. Each DO is isolated—org A cannot access org B's data.

---

## Part 1: Understanding Durable Objects

### Why Not Just Use D1 for Everything?

D1 works for cross-tenant data: user accounts, org registry, workspace bindings. But conversations and messages need:

1. **Tenant isolation** — One org's data must be unreachable by another
2. **Strong consistency** — Message ordering matters for LLM context
3. **Low latency** — Chat UX needs fast reads/writes
4. **Stateful logic** — Pending confirmations, rate limiting

Durable Objects solve this. Each DO runs in a single location with single-threaded execution, giving you transactional consistency without coordination overhead.

### DO Identity = Org Identity

Critical design decision: the DO's ID **is** the org's identity. When you create a DO stub:

```typescript
const orgId = "org_abc123";
const doId = env.TENANT.idFromName(orgId);
const stub = env.TENANT.get(doId);
```

The DO derives `orgId` from its own ID—never from incoming request payloads. This prevents a malicious request from claiming to be a different org.

### Two Storage Types in One DO

Each DO has two distinct storage mechanisms:

| Storage     | Use Case                                    | API                |
| ----------- | ------------------------------------------- | ------------------ |
| DO SQLite   | Structured data (conversations, messages)   | `ctx.storage.sql`  |
| DO Storage  | Key-value (encrypted Clio tokens)           | `ctx.storage.get/put` |

SQLite for queries. Storage for secrets.

---

## Part 2: Setting Up the DO Class

### Step 2.1: Wrangler Configuration

The binding and migration are already configured in `wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "TENANT", "class_name": "TenantDO" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["TenantDO"] }]
}
```

Key points:
- `new_sqlite_classes` enables DO SQLite (not the older KV-style storage)
- `tag: "v1"` is the migration identifier—increment for schema changes
- `binding: "TENANT"` is how the Worker accesses DOs

### Step 2.2: The DO Class Structure

```typescript
import { DurableObject } from "cloudflare:workers";

export class TenantDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Block all requests until migrations complete
    ctx.blockConcurrencyWhile(() => this.migrate());
  }

  async fetch(request: Request): Promise<Response> {
    // Handle incoming requests
  }
}
```

**Why `blockConcurrencyWhile`?**

DOs can receive requests while still initializing. Without blocking, you might query tables that don't exist yet. `blockConcurrencyWhile` holds all incoming requests until the callback resolves.

Keep this fast—storage ops only, no external fetch calls. Target: <100ms.

### Step 2.3: Migration Pattern with user_version

SQLite tracks schema version via `PRAGMA user_version`. Check it and apply migrations:

```typescript
private async migrate(): Promise<void> {
  const result = this.sql.exec("PRAGMA user_version").one();
  const currentVersion = result.user_version as number;

  if (currentVersion >= 1) return; // Already migrated

  this.sql.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_updated
      ON conversations(updated_at);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      user_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);

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
    CREATE INDEX IF NOT EXISTS idx_pending_expires
      ON pending_confirmations(expires_at);

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
```

**Table purposes:**
- `conversations` — Chat session metadata (Teams conversation ID, Slack channel)
- `messages` — LLM context window (last 15 messages per conversation)
- `pending_confirmations` — CUD operations waiting for user approval (5-min expiry)
- `org_settings` — Key-value config (jurisdiction, practice type)
- `clio_schema_cache` — Cached Clio object definitions

---

## Part 3: The ChannelMessage Interface

All channel adapters translate their platform-specific format to this unified structure:

```typescript
export interface ChannelMessage {
  channel: "teams" | "slack" | "mcp" | "chatgpt" | "web";
  orgId: string;           // For tracing only—DO derives real org from ID
  userId: string;
  userRole: "admin" | "member";
  conversationId: string;
  conversationScope: "personal" | "groupChat" | "teams" | "dm" | "channel" | "api";
  message: string;

  // Org settings for KB filtering (from D1 org table)
  jurisdiction: string;
  practiceType: string;
  firmSize: "solo" | "small" | "mid" | "large";

  metadata?: {
    threadId?: string;
    teamsChannelId?: string;
    slackChannelId?: string;
  };
}
```

The Worker populates `jurisdiction`, `practiceType`, `firmSize` from D1 before routing to the DO. The DO uses these to filter KB queries.

---

## Part 4: Request Routing

### Step 4.1: Worker Routes to DO

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/process-message" && request.method === "POST") {
      return handleProcessMessage(request, env);
    }

    // Other routes...
  }
};

async function handleProcessMessage(request: Request, env: Env): Promise<Response> {
  const message = await request.json() as ChannelMessage;

  // 1. Validate workspace binding
  const binding = await env.DB.prepare(
    "SELECT org_id FROM workspace_bindings WHERE workspace_id = ?"
  ).bind(message.metadata?.teamsChannelId || "").first();

  if (!binding) {
    return Response.json({ error: "Workspace not linked" }, { status: 403 });
  }

  // 2. Get org settings for KB filtering
  const org = await env.DB.prepare(
    "SELECT jurisdiction, practice_type, firm_size FROM org WHERE id = ?"
  ).bind(binding.org_id).first();

  // 3. Route to org's DO
  const doId = env.TENANT.idFromName(binding.org_id as string);
  const stub = env.TENANT.get(doId);

  return stub.fetch(new Request("http://do/process-message", {
    method: "POST",
    body: JSON.stringify({
      ...message,
      orgId: binding.org_id,  // Overwrite with validated org
      jurisdiction: org?.jurisdiction,
      practiceType: org?.practice_type,
      firmSize: org?.firm_size,
    }),
  }));
}
```

Notice: the Worker validates `org_id` from D1, not from the incoming message. The DO will further validate that the message's `orgId` matches its own ID.

### Step 4.2: DO Validates and Processes

```typescript
async fetch(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/process-message" && request.method === "POST") {
    return this.processMessage(await request.json() as ChannelMessage);
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

private async processMessage(msg: ChannelMessage): Promise<Response> {
  // Derive org identity from DO ID, not from message
  const derivedOrgId = this.ctx.id.toString();

  // Reject mismatched org IDs (defense in depth)
  if (msg.orgId !== derivedOrgId) {
    await this.appendAuditLog({
      user_id: msg.userId,
      action: "org_mismatch_rejected",
      object_type: "security",
      params: { claimed: msg.orgId, actual: derivedOrgId },
      result: "error",
      error_message: "Org ID mismatch",
    });
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Check permissions before proceeding
  // (Phase 7 adds LLM invocation here)

  return Response.json({ received: true });
}
```

---

## Part 5: Permission Enforcement

Permissions are enforced in the DO, not the adapter. This centralizes security.

```typescript
private async checkPermission(
  userId: string,
  role: string,
  action: string,
  objectType: string
): Promise<boolean> {
  // For now, hardcoded rules. Phase 7 adds role_permissions lookup.

  // Read operations: anyone can query
  if (action === "read") return true;

  // CUD operations: admin only
  if (["create", "update", "delete"].includes(action)) {
    return role === "admin";
  }

  return false;
}
```

Failed permission checks get logged:

```typescript
if (!await this.checkPermission(msg.userId, msg.userRole, "create", "matter")) {
  await this.appendAuditLog({
    user_id: msg.userId,
    action: "permission_denied",
    object_type: "matter",
    params: { attempted: "create" },
    result: "error",
    error_message: "Insufficient permissions",
  });
  return Response.json({
    error: "You don't have permission to create matters"
  }, { status: 403 });
}
```

---

## Part 6: Conversation Isolation

Each `conversationId` maintains isolated state:

```typescript
private async getOrCreateConversation(
  conversationId: string,
  channelType: string,
  scope: string
): Promise<void> {
  const existing = this.sql.exec(
    "SELECT id FROM conversations WHERE id = ?",
    conversationId
  ).one();

  if (!existing) {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO conversations (id, channel_type, scope, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      conversationId, channelType, scope, now, now
    );
  }
}

private async addMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  userId?: string
): Promise<void> {
  const id = crypto.randomUUID();
  this.sql.exec(
    `INSERT INTO messages (id, conversation_id, role, content, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id, conversationId, role, content, userId || null, Date.now()
  );

  // Update conversation timestamp
  this.sql.exec(
    "UPDATE conversations SET updated_at = ? WHERE id = ?",
    Date.now(), conversationId
  );
}

private async getRecentMessages(conversationId: string, limit = 15): Promise<Message[]> {
  const cursor = this.sql.exec(
    `SELECT id, role, content, user_id, created_at
     FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    conversationId, limit
  );

  return [...cursor].reverse(); // Chronological order
}
```

Teams personal chat → one conversationId. Teams group chat → different conversationId. Complete isolation.

---

## Part 7: Audit Logging to R2

Every CUD operation, permission change, and security event gets logged:

```typescript
async appendAuditLog(entry: AuditEntryInput): Promise<{ id: string }> {
  const now = new Date();
  const id = crypto.randomUUID();

  // Path: /orgs/{org_id}/audit/{year}/{month}/{day}/{timestamp}-{uuid}.json
  const path = `orgs/${this.ctx.id}/audit/${now.getFullYear()}/${
    String(now.getMonth() + 1).padStart(2, "0")
  }/${String(now.getDate()).padStart(2, "0")}/${now.getTime()}-${id}.json`;

  await this.env.R2.put(
    path,
    JSON.stringify({ id, created_at: now.toISOString(), ...entry }),
    { httpMetadata: { contentType: "application/json" } }
  );

  return { id };
}
```

One JSON file per entry. No read-modify-write. Query via R2 list with date prefix:

```typescript
// List audit logs for December 2024
const logs = await env.R2.list({ prefix: "orgs/org_abc/audit/2024/12/" });
```

---

## Part 8: User Leaves Org / Org Deletion

### User Leaves Org

The DO handles its part of cleanup:

```typescript
async handleUserLeave(userId: string): Promise<void> {
  // 1. Expire pending confirmations
  this.sql.exec(
    "UPDATE pending_confirmations SET expires_at = ? WHERE user_id = ?",
    Date.now(), userId
  );

  // 2. Delete Clio token from DO Storage
  await this.ctx.storage.delete(`clio_token:${userId}`);

  await this.appendAuditLog({
    user_id: userId,
    action: "user_left_org",
    object_type: "membership",
    params: {},
    result: "success",
  });
}
```

Messages stay (org owns them for compliance).

### Org Deletion

Deleting a DO requires calling its delete method. The Worker coordinates:

```typescript
// Worker-side
async function deleteOrg(env: Env, orgId: string): Promise<void> {
  // 1. Delete DO (destroys SQLite + Storage)
  const doId = env.TENANT.idFromName(orgId);
  const stub = env.TENANT.get(doId);
  await stub.fetch(new Request("http://do/delete", { method: "DELETE" }));

  // 2. Delete R2 paths
  const objects = await env.R2.list({ prefix: `orgs/${orgId}/` });
  for (const obj of objects.objects) {
    await env.R2.delete(obj.key);
  }

  // 3. Delete D1 records (separate function)
  // ...
}

// DO-side
async fetch(request: Request): Promise<Response> {
  if (request.method === "DELETE" && new URL(request.url).pathname === "/delete") {
    // DO deletion handled by Cloudflare when stub is garbage collected
    // For now, just clear all data
    await this.ctx.storage.deleteAll();
    this.sql.exec("DELETE FROM messages");
    this.sql.exec("DELETE FROM conversations");
    this.sql.exec("DELETE FROM pending_confirmations");
    this.sql.exec("DELETE FROM org_settings");
    this.sql.exec("DELETE FROM clio_schema_cache");
    return Response.json({ deleted: true });
  }
}
```

---

## Part 9: Error Responses

User-friendly error messages:

```typescript
private formatError(code: string): string {
  const messages: Record<string, string> = {
    "do_unavailable": "I'm having trouble connecting. Please try again in a moment.",
    "clio_unavailable": "Clio is currently unavailable. Please try again later.",
    "clio_auth_failed": "Your Clio authentication has expired. Please reconnect.",
    "permission_denied": "You don't have permission to perform this action.",
    "org_mismatch": "There was a security error. Please contact support.",
  };
  return messages[code] || "Something went wrong. Please try again.";
}
```

---

## Testing Strategy

### Unit Tests

Test DO logic in isolation using Miniflare:

```typescript
// test/tenant-do.spec.ts
import { env, createExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("TenantDO", () => {
  it("creates conversation on first message", async () => {
    const id = env.TENANT.idFromName("test-org");
    const stub = env.TENANT.get(id);

    const response = await stub.fetch(new Request("http://do/process-message", {
      method: "POST",
      body: JSON.stringify({
        channel: "teams",
        orgId: id.toString(),
        userId: "user-1",
        userRole: "member",
        conversationId: "conv-1",
        conversationScope: "personal",
        message: "Hello",
        jurisdiction: "CA",
        practiceType: "litigation",
        firmSize: "small",
      }),
    }));

    expect(response.status).toBe(200);
  });

  it("rejects mismatched org ID", async () => {
    const id = env.TENANT.idFromName("test-org");
    const stub = env.TENANT.get(id);

    const response = await stub.fetch(new Request("http://do/process-message", {
      method: "POST",
      body: JSON.stringify({
        orgId: "wrong-org", // Doesn't match DO ID
        // ...
      }),
    }));

    expect(response.status).toBe(403);
  });
});
```

### Integration Tests

Test Worker → DO routing with real D1:

```typescript
// test/integration/routing.spec.ts
describe("Message routing", () => {
  beforeAll(async () => {
    // Seed D1 with test org and workspace binding
    await env.DB.exec(`
      INSERT INTO org (id, name, jurisdiction) VALUES ('test-org', 'Test Firm', 'CA');
      INSERT INTO workspace_bindings (workspace_id, org_id) VALUES ('teams-ws-1', 'test-org');
    `);
  });

  it("routes Teams message to correct DO", async () => {
    const response = await fetch("http://localhost/process-message", {
      method: "POST",
      body: JSON.stringify({
        channel: "teams",
        conversationId: "teams-conv-1",
        metadata: { teamsChannelId: "teams-ws-1" },
        // ...
      }),
    });

    expect(response.status).toBe(200);
  });
});
```

### E2E Tests

Full flow from simulated Teams webhook to DO response:

```typescript
// test/e2e/teams-flow.spec.ts
describe("Teams E2E", () => {
  it("echoes message through full stack", async () => {
    // Simulate Teams Bot Framework webhook
    const response = await fetch("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({
        type: "message",
        text: "What matters are due this week?",
        from: { id: "teams-user-1" },
        conversation: { id: "teams-conv-1" },
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      }),
    });

    expect(response.status).toBe(200);
  });
});
```

---

## Demo Endpoint

Shareholder demonstration at `/demo/tenant`:

```typescript
async function handleTenantDemo(request: Request, env: Env): Promise<Response> {
  const testOrgId = `demo-org-${Date.now()}`;
  const steps: Step[] = [];

  // 1. Create DO for test org
  const doId = env.TENANT.idFromName(testOrgId);
  const stub = env.TENANT.get(doId);
  steps.push({ step: "create_do", result: { orgId: testOrgId } });

  // 2. Send test message
  const msgResponse = await stub.fetch(new Request("http://do/process-message", {
    method: "POST",
    body: JSON.stringify({
      channel: "web",
      orgId: testOrgId,
      userId: "demo-user",
      userRole: "admin",
      conversationId: "demo-conv",
      conversationScope: "personal",
      message: "Test message for demo",
      jurisdiction: "CA",
      practiceType: "litigation",
      firmSize: "small",
    }),
  }));
  steps.push({ step: "send_message", result: await msgResponse.json() });

  // 3. Verify conversation created
  const verifyResponse = await stub.fetch(new Request("http://do/conversations"));
  steps.push({ step: "verify_conversation", result: await verifyResponse.json() });

  // 4. Test audit log
  const auditResponse = await stub.fetch(new Request("http://do/audit", {
    method: "POST",
    body: JSON.stringify({
      user_id: "demo-user",
      action: "demo_test",
      object_type: "demo",
      params: {},
      result: "success",
    }),
  }));
  steps.push({ step: "audit_log", result: await auditResponse.json() });

  return Response.json({ success: true, steps });
}
```

---

## Phase 6 Checklist

```
[x] DO bindings configured in wrangler.jsonc
[ ] One DO per organization (DO ID = org identity)
[ ] DO derives orgId from DO ID, rejects mismatched ChannelMessage.orgId
[ ] Constructor uses blockConcurrencyWhile() for migrations + schema loading
[ ] PRAGMA user_version for DO SQLite migration tracking
[ ] DO SQLite tables (conversations, messages, pending_confirmations, org_settings, clio_schema_cache)
[ ] ChannelMessage interface
[ ] POST /process-message endpoint
[ ] Channel Adapter routing (unified format)
[ ] ChannelMessage validation
[ ] Workspace binding validation (D1 lookup)
[ ] Conversation isolation per conversationId
[ ] Permission enforcement in DO
[ ] Error responses
[ ] Audit logging to R2
[ ] User leaves org: expire pending_confirmations, delete Clio token
[ ] Org deletion: delete DO instance
[ ] GDPR: DO purges user's conversations/messages
[ ] Unit tests passing
[ ] Integration tests passing
[ ] Demo endpoint deployed
```

---

## What's Next

Phase 7 adds Workers AI and RAG retrieval. The DO you built here will:

1. Generate embeddings for incoming messages
2. Query Vectorize for KB + Org Context chunks
3. Build system prompts with RAG context
4. Invoke LLM via Workers AI
5. Handle `clioQuery` tool calls

The DO infrastructure is ready. Phase 7 brings the intelligence.
