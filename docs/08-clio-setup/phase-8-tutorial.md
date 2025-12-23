# Phase 8: Clio Integration Tutorial

**LONGER DOC**

This tutorial walks through building the Clio integration for Docket. By the end, you'll understand OAuth 2.0 with PKCE, encrypted token storage in Durable Objects, schema caching, and how the `clioQuery` tool executes API calls.

## What We're Building

Phase 8 connects Docket users to their Clio accounts. The integration:

1. **OAuth Flow** — Users authorize Docket to access their Clio data
2. **Token Storage** — Encrypted tokens stored in DO Storage (per-user, per-org)
3. **Token Refresh** — Proactive and reactive refresh before/after expiration
4. **Schema Provisioning** — Cache Clio object definitions for LLM context
5. **API Execution** — The `clioQuery` tool executes validated API calls

## Prerequisites

Before starting Phase 8, ensure you have:

- Completed Phases 1-7 (auth, storage, DO, Workers AI all working)
- Clio developer account with an application created
- `CLIO_CLIENT_ID` and `CLIO_CLIENT_SECRET` in Wrangler secrets
- Understanding of the existing `TenantDO` class in `src/index.ts`

---

## Part 1: Understanding OAuth 2.0 with PKCE

### Why OAuth?

OAuth lets users grant Docket permission to access their Clio data **without sharing their Clio password**. The user clicks "Connect Clio," approves access on Clio's site, and Clio returns tokens that Docket uses for API calls.

### The Flow (Conceptually)

```
User clicks "Connect Clio"
       │
       ▼
┌─────────────────────────────────────────┐
│  Docket generates:                      │
│  - code_verifier (random 43 chars)      │
│  - code_challenge (SHA-256 hash)        │
│  - state (signed, timestamped)          │
└─────────────────────────────────────────┘
       │
       ▼
Redirect to Clio: /oauth/authorize
       │
       ▼
User approves on Clio's consent screen
       │
       ▼
Clio redirects back with ?code=xxx&state=xxx
       │
       ▼
┌─────────────────────────────────────────┐
│  Docket verifies:                       │
│  - state signature (HMAC-SHA256)        │
│  - state not expired (10 min)           │
│  - exchange code for tokens             │
└─────────────────────────────────────────┘
       │
       ▼
Store encrypted tokens in DO Storage
```

### Why PKCE?

PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks. Even if someone intercepts the `code`, they can't exchange it without the `code_verifier` that only your server knows.

**How it works:**

1. Generate a random `code_verifier` (43-128 characters)
2. Hash it with SHA-256 to create `code_challenge`
3. Send `code_challenge` to Clio during authorization
4. Send `code_verifier` during token exchange
5. Clio verifies hash(`code_verifier`) === `code_challenge`

### Clio's OAuth Endpoints

| Endpoint      | URL                                      |
| ------------- | ---------------------------------------- |
| Authorization | `https://app.clio.com/oauth/authorize`   |
| Token         | `https://app.clio.com/oauth/token`       |
| Deauthorize   | `https://app.clio.com/oauth/deauthorize` |

### Token Lifetimes

- **Access Token**: 7 days (604800 seconds)
- **Refresh Token**: Never expires (but can be revoked by user)

---

## Part 2: Building the OAuth Service

### Step 2.1: Create the Clio OAuth Service

Create `src/services/clio-oauth.ts`:

- Clio OAuth configuration
- Token structure stored in DO Storage
- PKCE Helpers
  - Generate a cryptographically random code verifier for PKCE.
  - Must be 43-128 characters, using unreserved URI characters.
- Create the code challenge from a verifier using SHA-256.
- Base64URL encoding (no padding, URL-safe characters).
- State Management
  - Generate a signed state parameter with embedded metadata.
  - Format: base64({userId, orgId, timestamp, verifier}):signature
- Verify and decode a state parameter.
  - Returns null if invalid or expired.
- Verify signature
- Decode payload
- Sign data with HMAC-SHA256, return base64url.
- Authorization URL Builder
- Build the Clio authorization URL with PKCE.
- Token Exchange
  - Exchange authorization code for tokens.
- Token Refresh
  - Refresh an expired access token.
- Encrypted Token Storage
  - Store encrypted Clio tokens in DO Storage.
  - Retrieve and decrypt Clio tokens from DO Storage.
  - Delete Clio tokens from DO Storage.
  - Check if a token needs refresh (within 5 minutes of expiry).

### What You Build

This service handles the complete OAuth lifecycle:

1. **PKCE generation** — `generateCodeVerifier()` and `generateCodeChallenge()` create the cryptographic proof that prevents code interception
2. **State signing** — `generateState()` embeds user/org info with HMAC signature and expiry
3. **Token exchange** — `exchangeCodeForTokens()` swaps the auth code for tokens
4. **Token refresh** — `refreshAccessToken()` gets new tokens before expiry
5. **Encrypted storage** — Tokens encrypted with AES-GCM using per-user derived keys

---

## Part 3: Implementing the OAuth Callback

### Step 3.1: Update the Worker Entry Point

Modify `src/index.ts` to handle the full OAuth flow:

- Add to imports
- Add ENCRYPTION_KEY to Env interface
- Add new route handler
  - Get the authenticated user (from Better Auth session)
  - In production, extract from session cookie
  - Generate PKCE values
  - Generate signed state (includes verifier for callback)
  - Build authorization URL
- Update the callback handler
  - Handle user denial
  - Validate required params
  - Verify and decode state
    - Exchange code for tokens
    - Store tokens in the org's DO
    - Trigger schema provisioning if first connection
- Add routes to the main fetch handler
  - Clio OAuth routes

---

## Part 4: Token Storage in the Durable Object

### Step 4.1: Add Token Storage Endpoints to TenantDO

Add these methods to the `TenantDO` class in `src/index.ts`:

- Add to TenantDO class
- Import at top of file
- Add to the fetch router switch statement
- New handler methods
  - Log the connection event
- Get a valid Clio access token, refreshing if needed.
  - This is the main entry point for getting tokens before API calls.
  - Proactive refresh if close to expiry
    - Refresh failed - token may be revoked
  - Handle reactive refresh after a 401 response.
    - Refresh failed - mark as disconnected

### Understanding Token Storage Security

The tokens are protected by multiple layers:

1. **DO Isolation** — Each org's DO is separate; cross-org access is architecturally impossible
2. **User-Specific Keys** — Tokens encrypted with keys derived from `ENCRYPTION_KEY + userId`
3. **Key Rotation** — `ENCRYPTION_KEY_OLD` allows seamless key rotation
4. **AES-GCM** — Authenticated encryption prevents tampering

---

## Part 5: Clio Schema Provisioning

### Step 5.1: Create the Schema Service

Create `src/services/clio-schema.ts`:

- Core objects that support read/write
- Read-only reference objects
  - Fetch schema for a single Clio object type.
  - Fetch all schemas for core and read-only objects.
    - Fetch in parallel, but respect rate limits
  - Format schemas for LLM context (compact representation).

### Step 5.2: Add Schema Provisioning to TenantDO

- Add to TenantDO class
  - Get a valid token
  - Fetch all schemas from Clio
  - Store in SQLite and update memory cache
  - Log the provisioning

---

## Part 6: Executing Clio API Calls

### Step 6.1: Create the Clio API Client

Create `src/services/clio-api.ts`:

- Map object types to API endpoints
  - Execute a Clio API call with automatic error handling.
    - Handle specific error codes
    - DELETE returns no content
  - Map Clio HTTP status codes to user-friendly messages.
  - Build a read query (GET with optional filters).
    - Single record lookup
    - Add query filters
  - Build a create request body.
    - Clio expects data wrapped in the object type key
  - Build an update request body.
  - Build a delete request.

### Step 6.2: Update the Tool Call Handler in TenantDO

Replace the placeholder `executeClioRead` and `executeClioCUD` methods:

- Get valid token (with proactive refresh)
  - Build the query
  - Execute the call
  - Handle 401 with reactive refresh
  - Format the response for the LLM
  - Get valid token
  - Execute the call
  - Handle 401 with reactive refresh

---

## Part 7: Testing Strategy

### Unit Tests

Create `test/clio-oauth.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  verifyState,
  buildAuthorizationUrl,
  tokenNeedsRefresh,
} from "../src/services/clio-oauth";

describe("PKCE", () => {
  it("generates valid code verifier", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates valid code challenge", async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge.length).toBeGreaterThan(0);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces different challenges for different verifiers", async () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    const c1 = await generateCodeChallenge(v1);
    const c2 = await generateCodeChallenge(v2);
    expect(c1).not.toBe(c2);
  });
});

describe("State Management", () => {
  const SECRET = "test-secret-key";

  it("generates and verifies state", async () => {
    const verifier = generateCodeVerifier();
    const state = await generateState("user-1", "org-1", verifier, SECRET);

    const result = await verifyState(state, SECRET);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe("user-1");
    expect(result?.orgId).toBe("org-1");
    expect(result?.verifier).toBe(verifier);
  });

  it("rejects tampered state", async () => {
    const state = await generateState("user-1", "org-1", "verifier", SECRET);
    const tampered = state.replace(".", "X.");
    const result = await verifyState(tampered, SECRET);
    expect(result).toBeNull();
  });

  it("rejects wrong secret", async () => {
    const state = await generateState("user-1", "org-1", "verifier", SECRET);
    const result = await verifyState(state, "wrong-secret");
    expect(result).toBeNull();
  });
});

describe("Authorization URL", () => {
  it("builds correct URL with all params", () => {
    const url = buildAuthorizationUrl({
      clientId: "test-client",
      redirectUri: "https://example.com/callback",
      state: "test-state",
      codeChallenge: "test-challenge",
    });

    expect(url).toContain("client_id=test-client");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fcallback");
    expect(url).toContain("state=test-state");
    expect(url).toContain("code_challenge=test-challenge");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("response_type=code");
  });
});

describe("Token Refresh Logic", () => {
  it("detects tokens needing refresh", () => {
    const expiringSoon = {
      access_token: "test",
      refresh_token: "test",
      expires_at: Date.now() + 2 * 60 * 1000, // 2 minutes
    };
    expect(tokenNeedsRefresh(expiringSoon)).toBe(true);
  });

  it("detects valid tokens", () => {
    const valid = {
      access_token: "test",
      refresh_token: "test",
      expires_at: Date.now() + 60 * 60 * 1000, // 1 hour
    };
    expect(tokenNeedsRefresh(valid)).toBe(false);
  });
});
```

### Integration Tests

Create `test/clio-integration.spec.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";

// These tests require --remote flag and actual Clio credentials
describe.skip("Clio Integration (requires --remote)", () => {
  it("exchanges auth code for tokens", async () => {
    // This would require a real auth code from Clio
    // In practice, test with mock server or manual testing
  });

  it("fetches schema from Clio", async () => {
    // Requires valid access token
  });

  it("performs read operation", async () => {
    // Requires valid access token and Clio data
  });
});
```

### E2E Test Script

Create `test/e2e/clio-flow.md`:

```markdown
# Clio Integration E2E Test Checklist

## Prerequisites

- [ ] Deployed to Cloudflare (staging or production)
- [ ] Test Clio account with sample data
- [ ] Browser with developer tools open

## OAuth Flow

1. [ ] Navigate to /settings/clio
2. [ ] Click "Connect Clio"
3. [ ] Verify redirect to Clio authorization page
4. [ ] Approve access
5. [ ] Verify redirect back with success message
6. [ ] Check audit log for `clio_connect` event

## Schema Provisioning

1. [ ] After connection, check DO storage for cached schema
2. [ ] Verify schema includes: matters, contacts, tasks
3. [ ] Check audit log for `schema_provision` event

## Read Operations

1. [ ] Send: "Show me my open matters"
2. [ ] Verify response includes matter data from Clio
3. [ ] Send: "What tasks are due this week?"
4. [ ] Verify task data returned

## CUD Operations (Admin only)

1. [ ] Send: "Create a new task for Matter 123"
2. [ ] Verify confirmation prompt appears
3. [ ] Reply: "yes"
4. [ ] Verify task created in Clio
5. [ ] Check audit log for CUD operation

## Token Refresh

1. [ ] Wait for token to approach expiry (or manually set short expiry)
2. [ ] Send any Clio query
3. [ ] Verify automatic refresh (check DO storage for new expires_at)

## Disconnect Flow

1. [ ] Disconnect via /settings/clio
2. [ ] Verify tokens deleted from DO storage
3. [ ] Send Clio query
4. [ ] Verify "Please connect Clio" message
```

---

## Part 8: Demo Component

Create `src/demo/clio-demo.ts` for shareholder demonstration:

```typescript
/**
 * Clio Integration Demo
 *
 * This demo shows the complete Clio integration flow.
 * Run with: wrangler dev --local
 * Then visit: http://localhost:8787/demo/clio
 */

export function renderClioDemo(connected: boolean, schemas: string[]): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Docket - Clio Integration Demo</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 2rem; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .success { background: #d4edda; border-color: #c3e6cb; }
    .warning { background: #fff3cd; border-color: #ffeeba; }
    .code { background: #f5f5f5; padding: 1rem; border-radius: 4px; font-family: monospace; }
    button { padding: 0.5rem 1rem; cursor: pointer; }
    h1 { color: #333; }
    h2 { color: #666; border-bottom: 1px solid #eee; padding-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>Docket - Phase 8: Clio Integration</h1>

  <div class="card ${connected ? "success" : "warning"}">
    <h2>Connection Status</h2>
    <p><strong>Clio Connected:</strong> ${connected ? "Yes" : "No"}</p>
    ${
      connected
        ? '<button onclick="disconnect()">Disconnect Clio</button>'
        : '<a href="/clio/connect"><button>Connect Clio</button></a>'
    }
  </div>

  ${
    connected
      ? `
  <div class="card">
    <h2>Cached Schemas (${schemas.length} objects)</h2>
    <ul>
      ${schemas.map((s) => `<li>${s}</li>`).join("")}
    </ul>
    <button onclick="refreshSchema()">Refresh Schemas</button>
  </div>

  <div class="card">
    <h2>Test API Call</h2>
    <select id="objectType">
      <option value="Matter">Matters</option>
      <option value="Contact">Contacts</option>
      <option value="Task">Tasks</option>
    </select>
    <button onclick="testRead()">Fetch Records</button>
    <div id="result" class="code" style="display:none; margin-top:1rem;"></div>
  </div>

  <div class="card">
    <h2>Security Features Demonstrated</h2>
    <ul>
      <li>PKCE (S256) prevents code interception</li>
      <li>State parameter signed with HMAC-SHA256</li>
      <li>Tokens encrypted with AES-GCM</li>
      <li>Per-user key derivation</li>
      <li>Proactive token refresh (5-min buffer)</li>
      <li>Reactive refresh on 401</li>
    </ul>
  </div>
  `
      : ""
  }

  <script>
    async function disconnect() {
      await fetch('/clio/disconnect', { method: 'POST' });
      location.reload();
    }

    async function refreshSchema() {
      await fetch('/clio/refresh-schema', { method: 'POST' });
      location.reload();
    }

    async function testRead() {
      const objectType = document.getElementById('objectType').value;
      const result = document.getElementById('result');
      result.style.display = 'block';
      result.textContent = 'Loading...';

      const response = await fetch('/demo/clio/test-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectType })
      });

      const data = await response.json();
      result.textContent = JSON.stringify(data, null, 2);
    }
  </script>
</body>
</html>
  `;
}
```

---

## Summary

In Phase 8, you built:

| Component        | What It Does                                           |
| ---------------- | ------------------------------------------------------ |
| `clio-oauth.ts`  | PKCE generation, state signing, token exchange/refresh |
| `clio-schema.ts` | Fetches and formats Clio object schemas                |
| `clio-api.ts`    | Executes validated API calls with error handling       |
| TenantDO updates | Token storage, schema caching, tool execution          |

### Key Security Measures

1. **PKCE S256** — Cryptographic proof prevents code interception
2. **Signed State** — HMAC-SHA256 with 10-minute expiry
3. **Encrypted Tokens** — AES-GCM with per-user key derivation
4. **Token Rotation** — Proactive refresh + reactive 401 handling
5. **DO Isolation** — Cross-org token access impossible

### Next Steps

- Phase 9: Website MVP with Connect Clio UI
- Phase 10: Teams adapter with full integration
- Phase 11: Production hardening (rate limits, monitoring)

---

## References

- [Clio Authorization Documentation](https://docs.developers.clio.com/api-docs/authorization/)
- [Clio API Reference](https://docs.developers.clio.com/api-reference/)
- [Cloudflare Workers Web Crypto API](https://developers.cloudflare.com/workers/runtime-apis/web-crypto)
- [Cloudflare Durable Objects Storage](https://developers.cloudflare.com/durable-objects/api/storage-api/)
- [OAuth 2.0 PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
