# Phase 2 Tutorial: Development Account Setup

**Goal:** Set up all development accounts and verify each service works independently before building integrations.

**What you're building:** Docket is a case management bot that connects law firms to Clio (their practice management software) through Microsoft Teams. This phase establishes the three pillars of your infrastructure:

1. **Cloudflare** — Where your code runs (Workers, Durable Objects) and data lives (D1, Vectorize, R2)
2. **Clio** — The legal practice management API you'll integrate with
3. **Microsoft 365** — The Teams platform where users will chat with your bot

Each account serves a distinct purpose. Understanding _why_ each exists helps you debug issues later.

---

## Part 1: Cloudflare Account

### What Cloudflare Provides

Cloudflare is your entire backend infrastructure:

| Service             | Purpose in Docket                                   | Why It Matters                            |
| ------------------- | --------------------------------------------------- | ----------------------------------------- |
| **Workers**         | Runs your TypeScript code at the edge               | Sub-50ms response times globally          |
| **Durable Objects** | Per-org state: conversations, Clio tokens, settings | Tenant isolation without managing servers |
| **D1**              | SQLite database: users, orgs, KB chunks             | Serverless SQL with zero cold starts      |
| **Vectorize**       | Vector search for RAG                               | Semantic search over Knowledge Base       |
| **R2**              | Object storage: docs, audit logs                    | S3-compatible, zero egress fees           |
| **Workers AI**      | LLM inference + embeddings                          | No external API keys needed               |

### Step 1.1: Create Cloudflare Account

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Sign up with email or SSO
3. Verify your email
4. Navigate to **Workers & Pages** in the sidebar

**What you should see:** An empty Workers dashboard with a "Create" button.

### Step 1.2: Install Wrangler CLI

Wrangler is Cloudflare's CLI for managing Workers, D1, R2, and Vectorize.

```bash
# Install globally
npm install -g wrangler

# Verify installation
wrangler --version
# Expected: something like "wrangler 3.x.x"

# Authenticate with your Cloudflare account
wrangler login
# Opens browser for OAuth consent
```

**What happens:** `wrangler login` opens your browser. After you approve, Wrangler stores credentials in `~/.wrangler/config/default.toml`.

### Step 1.3: Initialize Project Structure

```bash
# Create project directory
mkdir docket && cd docket

# Initialize with Wrangler (creates wrangler.jsonc)
npm create cloudflare@latest . -- --type worker-typescript

# Your structure should look like:
# docket/
# ├── src/
# │   └── index.ts
# ├── wrangler.jsonc
# ├── package.json
# └── tsconfig.jsonƒ
```

### Step 1.4: Create D1 Database

D1 is where you'll store users, orgs, Knowledge Base chunks, and Org Context chunks.

```bash
# Create the database
npx wrangler d1 create docket-db

# Output will include:
# ✅ Successfully created DB 'docket-db'
# database_id = "abc123-def456-..."
```

**Copy that `database_id`** — you'll need it for configuration.

Add to `wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "docket",
  "main": "src/index.ts",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"],

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "docket-db",
      "database_id": "<YOUR_DATABASE_ID>"
    }
  ]
}
```

### Step 1.5: Create R2 Bucket

R2 stores Org Context documents, audit logs, and archived conversations.

```bash
# Create the bucket
npx wrangler r2 bucket create docket-storage

# Output:
# ✅ Created bucket 'docket-storage'
```

Add to `wrangler.jsonc`:

```jsonc
{
  // ... existing config

  "r2_buckets": [
    {
      "binding": "R2",
      "bucket_name": "docket-storage"
    }
  ]
}
```

### Step 1.6: Create Vectorize Index

Vectorize stores embeddings for semantic search. The dimensions must match your embedding model.

```bash
# Create index for bge-base-en-v1.5 (768 dimensions)
npx wrangler vectorize create docket-vectors --dimensions=768 --metric=cosine

# Output:
# ✅ Created index 'docket-vectors'
```

Add to `wrangler.jsonc`:

```jsonc
{
  // ... existing config

  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "docket-vectors"
    }
  ]
}
```

### Step 1.7: Enable Workers AI

Workers AI requires no separate setup—just add the binding:

```jsonc
{
  // ... existing config

  "ai": {
    "binding": "AI"
  }
}
```

### Step 1.8: Configure Durable Objects

Durable Objects are defined in code and declared in config:

```jsonc
{
  // ... existing config

  "durable_objects": {
    "bindings": [
      {
        "name": "TENANT",
        "class_name": "TenantDO"
      }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["TenantDO"]
    }
  ]
}
```

### Complete wrangler.jsonc

Your final configuration:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "docket",
  "main": "src/index.ts",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"],

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "docket-db",
      "database_id": "<YOUR_DATABASE_ID>"
    }
  ],

  "r2_buckets": [
    {
      "binding": "R2",
      "bucket_name": "docket-storage"
    }
  ],

  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "docket-vectors"
    }
  ],

  "ai": {
    "binding": "AI"
  },

  "durable_objects": {
    "bindings": [
      {
        "name": "TENANT",
        "class_name": "TenantDO"
      }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["TenantDO"]
    }
  ]
}
```

---

## Part 2: Clio Developer Sandbox

### What Clio Provides

Clio is the practice management system your bot integrates with. The developer sandbox gives you:

- **OAuth Application** — Client ID/Secret for user authorization
- **Sandbox Data** — Fake matters, contacts, tasks to test against
- **API Access** — Full Clio API without affecting real law firm data

### Step 2.1: Create Clio Developer Account

1. Go to [developers.clio.com](https://developers.clio.com)
2. Click "Get Started" or "Sign Up"
3. Create a Clio account (or use existing)
4. Access the Developer Portal

**Important:** You need a paid Clio account to create applications. The EasyStart tier doesn't support developer features.

### Step 2.2: Create Developer Application

1. In Developer Portal, click **Create Application**
2. Fill out required fields:

| Field               | Value                            | Why                           |
| ------------------- | -------------------------------- | ----------------------------- |
| **Name**            | Docket                           | Shown on OAuth consent screen |
| **Website URL**     | https://docket.com (placeholder) | Required field                |
| **Redirect URIs**   | http://127.0.0.1:8787/callback   | For local development         |
| **App Permissions** | Select all you'll need           | Determines API access         |

3. Accept Developer Terms of Service
4. Click Create

**What you receive:**

- **Client ID** — Public identifier (e.g., `fzaXZ...i7F96`)
- **Client Secret** — Private key (keep secure!)
- **App ID** — Internal identifier for support

### Step 2.3: Understand Clio OAuth Flow

Clio uses standard OAuth 2.0. Here's the flow your bot will implement:

```
1. User clicks "Connect Clio" in Docket
   ↓
2. Redirect to Clio authorization URL:
   https://app.clio.com/oauth/authorize?
     response_type=code&
     client_id=YOUR_CLIENT_ID&
     redirect_uri=YOUR_REDIRECT_URI&
     state=RANDOM_STATE

3. User logs into Clio, approves access
   ↓
4. Clio redirects to your redirect_uri with code:
   https://yourapp.com/callback?code=AUTH_CODE&state=RANDOM_STATE

5. Exchange code for tokens:
   POST https://app.clio.com/oauth/token
   Body: client_id, client_secret, grant_type=authorization_code, code, redirect_uri

6. Receive tokens:
   {
     "access_token": "...",
     "refresh_token": "...",
     "expires_in": 604800  // 7 days
   }
```

### Step 2.4: Store Clio Credentials Securely

Never commit credentials. Use Wrangler secrets:

```bash
# Store as Worker secrets
npx wrangler secret put CLIO_CLIENT_ID
# Paste your client ID when prompted

npx wrangler secret put CLIO_CLIENT_SECRET
# Paste your client secret when prompted
```

For local development, create `.dev.vars` (gitignored):

```env
CLIO_CLIENT_ID=your_client_id
CLIO_CLIENT_SECRET=your_client_secret
```

---

## Part 3: Microsoft Teams Testing

### Two-Tier Testing Strategy

| Tier  | Tool                   | Cost  | When                   |
| ----- | ---------------------- | ----- | ---------------------- |
| Local | M365 Agents Playground | Free  | Phase 2+ (daily dev)   |
| E2E   | Business Basic tenant  | $6/mo | Phase 10 (integration) |

### Step 3.1: Install Agents Playground (Now)

Agents Playground emulates Teams bot environment locally without a tenant.

```bash
# Via VS Code: Install "Microsoft 365 Agents Toolkit" (v5.4.0+)
# Or CLI:
npm install -g @microsoft/m365agentsplayground
```

### Step 3.2: Local Dev Loop

```bash
# Terminal 1: Run your Cloudflare Worker
wrangler dev

# Terminal 2: Launch Agents Playground
agentsplayground -e "http://localhost:8787/api/messages" -c "emulator"
```

**What you can test locally:**

- Message handling and bot responses
- Adaptive Cards rendering
- Conversation flow
- Activity handlers (member added, install events)

**What requires real tenant (Phase 10):**

- SSO/OAuth with real Teams identity
- Manifest-based features (command menus)
- Real Teams UI (tabs, meetings, mobile)

### Step 3.3: Business Basic Tenant (Deferred to Phase 10)

When ready for E2E testing:

1. **Buy license:** [microsoft.com/microsoft-365/business/microsoft-365-business-basic](https://www.microsoft.com/microsoft-365/business/microsoft-365-business-basic) — $6/mo

2. **Enable sideloading:**

   - Go to [admin.teams.microsoft.com](https://admin.teams.microsoft.com)
   - Teams apps → Setup policies → Global
   - Toggle "Upload custom apps" → ON
   - Teams apps → Manage apps → Actions → Org-wide settings
   - Toggle "Let users interact with custom apps" → ON
   - **Wait 24 hours** for policies to propagate

3. **Create Azure Bot:**
   - Go to [portal.azure.com](https://portal.azure.com)
   - Search for "Azure Bot" → Create
   - Pricing tier: F0 (Free)
   - Note App ID, create client secret
   - Store as Wrangler secrets:

```bash
npx wrangler secret put TEAMS_APP_ID
npx wrangler secret put TEAMS_APP_SECRET
```

---

## Part 4: Verification Tests

Before moving to Phase 3, verify each service works independently.

### Test 4.1: Cloudflare D1

Create a test file `src/test-d1.ts`:

```typescript
export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Create test table
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS test_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert test row
    const result = await env.DB.prepare(
      "INSERT INTO test_accounts (name) VALUES (?) RETURNING *"
    )
      .bind("Phase 2 Test")
      .run();

    // Read it back
    const rows = await env.DB.prepare("SELECT * FROM test_accounts").all();

    return Response.json({
      success: true,
      inserted: result.results,
      all_rows: rows.results,
      message: "D1 is working!",
    });
  },
};
```

Run locally:

```bash
npx wrangler dev

# In another terminal:
curl http://localhost:8787
```

**Expected output:**

```json
{
  "success": true,
  "inserted": [{"id": 1, "name": "Phase 2 Test", "created_at": "..."}],
  "all_rows": [...],
  "message": "D1 is working!"
}
```

### Test 4.2: Cloudflare R2

```typescript
export interface Env {
  R2: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const testContent = JSON.stringify({
      test: "Phase 2 R2 verification",
      timestamp: new Date().toISOString(),
    });

    // Write to R2
    await env.R2.put("test/phase2-verification.json", testContent, {
      httpMetadata: { contentType: "application/json" },
    });

    // Read it back
    const object = await env.R2.get("test/phase2-verification.json");
    const content = await object?.text();

    // List objects
    const list = await env.R2.list({ prefix: "test/" });

    return Response.json({
      success: true,
      written: testContent,
      read_back: content,
      objects_in_bucket: list.objects.map((o) => o.key),
      message: "R2 is working!",
    });
  },
};
```

### Test 4.3: Cloudflare Vectorize + Workers AI

```typescript
export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const testText =
      "The client filed a motion for summary judgment in the Smith v. Jones case.";

    // Generate embedding using Workers AI
    const embeddingResult = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: testText,
    });

    const embedding = embeddingResult.data[0];

    // Insert into Vectorize
    await env.VECTORIZE.upsert([
      {
        id: "test-vector-1",
        values: embedding,
        metadata: { source: "phase2-test", text: testText },
      },
    ]);

    // Query Vectorize
    const queryResult = await env.VECTORIZE.query(embedding, {
      topK: 1,
      returnMetadata: "all",
    });

    return Response.json({
      success: true,
      embedding_dimensions: embedding.length,
      expected_dimensions: 768,
      vectorize_match: queryResult.matches[0],
      message: "Vectorize + Workers AI working!",
    });
  },
};
```

### Test 4.4: Durable Object

```typescript
import { DurableObject } from "cloudflare:workers";

export interface Env {
  TENANT: DurableObjectNamespace;
}

export class TenantDO extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    // Get current count from storage
    const count = (await this.ctx.storage.get<number>("count")) || 0;

    // Increment and store
    await this.ctx.storage.put("count", count + 1);

    return Response.json({
      instance_id: this.ctx.id.toString(),
      visit_count: count + 1,
      message: "Durable Object is stateful!",
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Get a specific DO instance (simulating org isolation)
    const id = env.TENANT.idFromName("test-org-123");
    const stub = env.TENANT.get(id);

    return stub.fetch(request);
  },
};
```

Visit multiple times—count should increment, proving state persistence.

### Test 4.5: Clio OAuth (Manual)

Open in browser:

```
https://app.clio.com/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://127.0.0.1:8787/callback&state=test123
```

https://app.clio.com/oauth/authorize?response_type=code&client_id=A0XrejjDYBBCMpdSCk7TOP78ziYkET0a4EYVGjKB&redirect_uri=http://127.0.0.1:8787/callback&state=test123

CLIENT_ID: A0XrejjDYBBCMpdSCk7TOP78ziYkET0a4EYVGjKB

After approving, you'll be redirected to:

```
http://127.0.0.1:8787/callback?code=AUTH_CODE&state=test123
```

Note the `code` parameter—that's what you'd exchange for tokens.

### Test 4.6: Agents Playground (Local Bot Test)

Test bot message handling locally:

```bash
# Terminal 1: Start worker with a simple echo handler
wrangler dev

# Terminal 2: Launch Agents Playground
agentsplayground -e "http://localhost:8787/api/messages" -c "emulator"
```

Type "Hello" in the playground. If your `/api/messages` endpoint isn't implemented yet, you'll see an error—that's expected at this phase. The important thing is confirming Agents Playground connects to your local worker.

---

## Part 5: Shareholder Demo Artifact

Create a demo script that showcases all services working together:

```typescript
// src/demo.ts - Phase 2 Demonstration
import { DurableObject } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  TENANT: DurableObjectNamespace;
}

export class TenantDO extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const visits = ((await this.ctx.storage.get<number>("visits")) || 0) + 1;
    await this.ctx.storage.put("visits", visits);
    return Response.json({ tenant_visits: visits });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const results: Record<string, unknown> = {
      phase: "Phase 2: Account Setup Complete",
      timestamp: new Date().toISOString(),
      services: {},
    };

    // 1. D1 Database
    try {
      await env.DB.exec(
        `CREATE TABLE IF NOT EXISTS demo (id INTEGER PRIMARY KEY, ts TEXT)`
      );
      await env.DB.prepare("INSERT INTO demo (ts) VALUES (?)")
        .bind(new Date().toISOString())
        .run();
      const { results: rows } = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM demo"
      ).all();
      results.services["d1"] = { status: "✅", row_count: rows[0]?.count };
    } catch (e) {
      results.services["d1"] = { status: "❌", error: String(e) };
    }

    // 2. R2 Bucket
    try {
      await env.R2.put("demo/test.txt", "Docket Phase 2");
      const obj = await env.R2.get("demo/test.txt");
      results.services["r2"] = { status: "✅", content: await obj?.text() };
    } catch (e) {
      results.services["r2"] = { status: "❌", error: String(e) };
    }

    // 3. Workers AI + Vectorize
    try {
      const text = "Legal case management demonstration";
      const { data } = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text });
      await env.VECTORIZE.upsert([{ id: "demo", values: data[0] }]);
      const query = await env.VECTORIZE.query(data[0], { topK: 1 });
      results.services["ai_vectorize"] = {
        status: "✅",
        embedding_dims: data[0].length,
        vector_match: query.matches[0]?.id,
      };
    } catch (e) {
      results.services["ai_vectorize"] = { status: "❌", error: String(e) };
    }

    // 4. Durable Object
    try {
      const id = env.TENANT.idFromName("demo-tenant");
      const stub = env.TENANT.get(id);
      const doResponse = await stub.fetch(request);
      const doData = await doResponse.json();
      results.services["durable_object"] = { status: "✅", ...doData };
    } catch (e) {
      results.services["durable_object"] = { status: "❌", error: String(e) };
    }

    // Summary
    const allPassing = Object.values(
      results.services as Record<string, { status: string }>
    ).every((s) => s.status === "✅");

    results.summary = allPassing
      ? "🎉 All Cloudflare services operational!"
      : "⚠️ Some services need attention";

    results.next_steps = [
      "Phase 3: Storage Layer (D1 migrations, Vectorize index)",
      "Phase 4: Auth Foundation (Better Auth setup)",
      "External: Clio OAuth flow implementation",
      "External: Teams Bot Framework integration",
    ];

    return new Response(JSON.stringify(results, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
```

Deploy and run:

```bash
npx wrangler deploy
curl https://docket.<your-subdomain>.workers.dev
```

Share the JSON output with stakeholders—it proves infrastructure readiness.

---

## Checklist

Before proceeding to Phase 3, confirm:

- [ ] Cloudflare account created
- [ ] Wrangler CLI installed and authenticated
- [ ] D1 database created and bound
- [ ] R2 bucket created and bound
- [ ] Vectorize index created (768 dimensions, cosine metric)
- [ ] Workers AI binding configured
- [ ] Durable Object class declared
- [ ] All verification tests pass locally
- [ ] Clio developer application created
- [ ] Clio credentials stored in Wrangler secrets
- [ ] M365 Agents Playground installed
- [ ] Demo artifact deployed and shareable

**Deferred to Phase 10:**

- [ ] M365 Business Basic tenant ($6/mo)
- [ ] Custom app upload enabled in Teams admin
- [ ] Azure Bot resource created
- [ ] Teams credentials stored in Wrangler secrets

---

## Troubleshooting

**Wrangler login fails:** Clear `~/.wrangler` and retry.

**D1 "database not found":** Ensure `database_id` in config matches output from `wrangler d1 create`.

**Vectorize dimension mismatch:** Delete index (`wrangler vectorize delete`) and recreate with correct dimensions.

**Agents Playground not connecting:** Ensure worker is running on correct port and endpoint path is `/api/messages`.

**Clio OAuth error:** Check redirect_uri matches exactly (including trailing slashes).

---

## What's Next

**Phase 3: Storage Layer** — Create D1 migrations for Better Auth tables, org registry, KB chunks. Set up R2 path structure for org isolation.

You now have the infrastructure foundation. The accounts exist, credentials are secure, and each service responds correctly. Phase 3 builds the data layer on top of this foundation.
