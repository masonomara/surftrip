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

| Endpoint | URL |
|----------|-----|
| Authorization | `https://app.clio.com/oauth/authorize` |
| Token | `https://app.clio.com/oauth/token` |
| Deauthorize | `https://app.clio.com/oauth/deauthorize` |

### Token Lifetimes

- **Access Token**: 7 days (604800 seconds)
- **Refresh Token**: Never expires (but can be revoked by user)

---

## Part 2: Building the OAuth Service

### Step 2.1: Create the Clio OAuth Service

Create `src/services/clio-oauth.ts`:

```typescript
import { encrypt, decrypt, base64ToArrayBuffer, arrayBufferToBase64 } from '../lib/encryption';

// Clio OAuth configuration
const CLIO_AUTHORIZE_URL = 'https://app.clio.com/oauth/authorize';
const CLIO_TOKEN_URL = 'https://app.clio.com/oauth/token';
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// Token structure stored in DO Storage
export interface ClioTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp (ms)
}

// ----- PKCE Helpers -----

/**
 * Generate a cryptographically random code verifier for PKCE.
 * Must be 43-128 characters, using unreserved URI characters.
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Create the code challenge from a verifier using SHA-256.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Base64URL encoding (no padding, URL-safe characters).
 */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ----- State Management -----

/**
 * Generate a signed state parameter with embedded metadata.
 * Format: base64({userId, orgId, timestamp, verifier}):signature
 */
export async function generateState(
  userId: string,
  orgId: string,
  codeVerifier: string,
  secretKey: string
): Promise<string> {
  const payload = {
    userId,
    orgId,
    timestamp: Date.now(),
    verifier: codeVerifier,
  };

  const payloadStr = btoa(JSON.stringify(payload));
  const signature = await signHMAC(payloadStr, secretKey);

  return `${payloadStr}.${signature}`;
}

/**
 * Verify and decode a state parameter.
 * Returns null if invalid or expired.
 */
export async function verifyState(
  state: string,
  secretKey: string
): Promise<{ userId: string; orgId: string; verifier: string } | null> {
  const parts = state.split('.');
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;

  // Verify signature
  const expectedSig = await signHMAC(payloadStr, secretKey);
  if (signature !== expectedSig) return null;

  // Decode payload
  try {
    const payload = JSON.parse(atob(payloadStr));

    // Check expiration
    if (Date.now() - payload.timestamp > STATE_EXPIRY_MS) {
      return null;
    }

    return {
      userId: payload.userId,
      orgId: payload.orgId,
      verifier: payload.verifier,
    };
  } catch {
    return null;
  }
}

/**
 * Sign data with HMAC-SHA256, return base64url.
 */
async function signHMAC(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );

  return base64UrlEncode(new Uint8Array(signature));
}

// ----- Authorization URL Builder -----

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

/**
 * Build the Clio authorization URL with PKCE.
 */
export function buildAuthorizationUrl(params: AuthUrlParams): string {
  const url = new URL(CLIO_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

// ----- Token Exchange -----

export interface TokenExchangeParams {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  params: TokenExchangeParams
): Promise<ClioTokens> {
  const response = await fetch(CLIO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000),
  };
}

// ----- Token Refresh -----

export interface RefreshParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Refresh an expired access token.
 */
export async function refreshAccessToken(
  params: RefreshParams
): Promise<ClioTokens> {
  const response = await fetch(CLIO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000),
  };
}

// ----- Encrypted Token Storage -----

const TOKEN_KEY_PREFIX = 'clio_token:';

/**
 * Store encrypted Clio tokens in DO Storage.
 */
export async function storeClioTokens(
  storage: DurableObjectStorage,
  userId: string,
  tokens: ClioTokens,
  encryptionKey: string
): Promise<void> {
  const plaintext = JSON.stringify(tokens);
  const encrypted = await encrypt(plaintext, userId, encryptionKey);
  await storage.put(`${TOKEN_KEY_PREFIX}${userId}`, encrypted);
}

/**
 * Retrieve and decrypt Clio tokens from DO Storage.
 */
export async function getClioTokens(
  storage: DurableObjectStorage,
  userId: string,
  env: { ENCRYPTION_KEY: string; ENCRYPTION_KEY_OLD?: string }
): Promise<ClioTokens | null> {
  const encrypted = await storage.get<ArrayBuffer>(`${TOKEN_KEY_PREFIX}${userId}`);
  if (!encrypted) return null;

  try {
    const decrypted = await decrypt(encrypted, userId, env);
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

/**
 * Delete Clio tokens from DO Storage.
 */
export async function deleteClioTokens(
  storage: DurableObjectStorage,
  userId: string
): Promise<void> {
  await storage.delete(`${TOKEN_KEY_PREFIX}${userId}`);
}

/**
 * Check if a token needs refresh (within 5 minutes of expiry).
 */
export function tokenNeedsRefresh(tokens: ClioTokens): boolean {
  const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
  return Date.now() > tokens.expires_at - REFRESH_BUFFER_MS;
}
```

### What You Just Built

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

```typescript
// Add to imports
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  verifyState,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  storeClioTokens,
} from './services/clio-oauth';

// Add ENCRYPTION_KEY to Env interface
export interface Env {
  // ... existing bindings ...
  ENCRYPTION_KEY: string;
  ENCRYPTION_KEY_OLD?: string;
}

// Add new route handler
async function handleClioConnect(
  request: Request,
  env: Env
): Promise<Response> {
  // Get the authenticated user (from Better Auth session)
  // In production, extract from session cookie
  const userId = request.headers.get('X-User-Id');
  const orgId = request.headers.get('X-Org-Id');

  if (!userId || !orgId) {
    return Response.redirect('/login?redirect=/settings/clio');
  }

  // Generate PKCE values
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Generate signed state (includes verifier for callback)
  const state = await generateState(
    userId,
    orgId,
    codeVerifier,
    env.CLIO_CLIENT_SECRET
  );

  // Build authorization URL
  const redirectUri = new URL(request.url).origin + '/clio/callback';
  const authUrl = buildAuthorizationUrl({
    clientId: env.CLIO_CLIENT_ID,
    redirectUri,
    state,
    codeChallenge,
  });

  return Response.redirect(authUrl, 302);
}

// Update the callback handler
async function handleClioCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Handle user denial
  if (error) {
    return Response.redirect('/settings/clio?error=denied');
  }

  // Validate required params
  if (!code || !state) {
    return Response.redirect('/settings/clio?error=invalid_request');
  }

  // Verify and decode state
  const stateData = await verifyState(state, env.CLIO_CLIENT_SECRET);
  if (!stateData) {
    return Response.redirect('/settings/clio?error=invalid_state');
  }

  const { userId, orgId, verifier } = stateData;

  try {
    // Exchange code for tokens
    const redirectUri = url.origin + '/clio/callback';
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      clientId: env.CLIO_CLIENT_ID,
      clientSecret: env.CLIO_CLIENT_SECRET,
      redirectUri,
    });

    // Store tokens in the org's DO
    const doId = env.TENANT.idFromName(orgId);
    const doStub = env.TENANT.get(doId);

    await doStub.fetch(new Request('https://do/store-clio-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, tokens }),
    }));

    // Trigger schema provisioning if first connection
    await doStub.fetch(new Request('https://do/provision-schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }));

    return Response.redirect('/settings/clio?success=connected');
  } catch (error) {
    console.error('Clio callback error:', error);
    return Response.redirect('/settings/clio?error=exchange_failed');
  }
}

// Add routes to the main fetch handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ... existing routes ...

    // Clio OAuth routes
    if (url.pathname === '/clio/connect') {
      return handleClioConnect(request, env);
    }

    if (url.pathname === '/clio/callback') {
      return handleClioCallback(request, env);
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
```

---

## Part 4: Token Storage in the Durable Object

### Step 4.1: Add Token Storage Endpoints to TenantDO

Add these methods to the `TenantDO` class in `src/index.ts`:

```typescript
// Add to TenantDO class

// Import at top of file
import {
  storeClioTokens,
  getClioTokens,
  deleteClioTokens,
  tokenNeedsRefresh,
  refreshAccessToken,
  ClioTokens,
} from './services/clio-oauth';

// Add to the fetch router switch statement
case '/store-clio-token':
  return this.handleStoreClioToken(request);

case '/provision-schema':
  return this.handleProvisionSchema(request);

// New handler methods
private async handleStoreClioToken(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const { userId, tokens } = await request.json() as {
    userId: string;
    tokens: ClioTokens;
  };

  if (!userId || !tokens) {
    return Response.json({ error: 'Missing userId or tokens' }, { status: 400 });
  }

  await storeClioTokens(
    this.ctx.storage,
    userId,
    tokens,
    this.env.ENCRYPTION_KEY
  );

  // Log the connection event
  await this.appendAuditLog({
    user_id: userId,
    action: 'clio_connect',
    object_type: 'oauth',
    params: {},
    result: 'success',
  });

  return Response.json({ success: true });
}

/**
 * Get a valid Clio access token, refreshing if needed.
 * This is the main entry point for getting tokens before API calls.
 */
private async getValidClioToken(userId: string): Promise<string | null> {
  const tokens = await getClioTokens(this.ctx.storage, userId, this.env);
  if (!tokens) return null;

  // Proactive refresh if close to expiry
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
      // Refresh failed - token may be revoked
      await deleteClioTokens(this.ctx.storage, userId);
      return null;
    }
  }

  return tokens.access_token;
}

/**
 * Handle reactive refresh after a 401 response.
 */
private async handleClioUnauthorized(userId: string): Promise<string | null> {
  const tokens = await getClioTokens(this.ctx.storage, userId, this.env);
  if (!tokens?.refresh_token) return null;

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
    // Refresh failed - mark as disconnected
    await deleteClioTokens(this.ctx.storage, userId);
    return null;
  }
}
```

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

```typescript
const CLIO_API_BASE = 'https://app.clio.com/api/v4';

// Core objects that support read/write
const CORE_OBJECTS = [
  'matters',
  'contacts',
  'tasks',
  'calendar_entries',
  'time_entries',
  'documents',
];

// Read-only reference objects
const READ_ONLY_OBJECTS = [
  'practice_areas',
  'activity_descriptions',
  'users',
];

export interface ClioSchema {
  objectType: string;
  fields: Array<{
    name: string;
    type: string;
    required?: boolean;
    readOnly?: boolean;
    enum?: string[];
    relationship?: boolean;
  }>;
  customFields?: Array<{
    name: string;
    type: string;
    fieldType: string;
  }>;
}

/**
 * Fetch schema for a single Clio object type.
 */
export async function fetchObjectSchema(
  objectType: string,
  accessToken: string
): Promise<ClioSchema | null> {
  const response = await fetch(
    `${CLIO_API_BASE}/${objectType}.json?fields=schema`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    console.error(`Failed to fetch schema for ${objectType}:`, response.status);
    return null;
  }

  const data = await response.json() as {
    schema?: {
      type: string;
      fields: Array<{
        name: string;
        type: string;
        required?: boolean;
        read_only?: boolean;
        enum?: string[];
        relationship?: boolean;
      }>;
    };
  };

  if (!data.schema) return null;

  return {
    objectType: data.schema.type,
    fields: data.schema.fields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      readOnly: f.read_only,
      enum: f.enum,
      relationship: f.relationship,
    })),
  };
}

/**
 * Fetch all schemas for core and read-only objects.
 */
export async function fetchAllSchemas(
  accessToken: string
): Promise<Map<string, ClioSchema>> {
  const schemas = new Map<string, ClioSchema>();
  const allObjects = [...CORE_OBJECTS, ...READ_ONLY_OBJECTS];

  // Fetch in parallel, but respect rate limits
  const results = await Promise.allSettled(
    allObjects.map(obj => fetchObjectSchema(obj, accessToken))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value) {
      schemas.set(allObjects[i], result.value);
    }
  }

  return schemas;
}

/**
 * Format schemas for LLM context (compact representation).
 */
export function formatSchemasForLLM(schemas: Map<string, ClioSchema>): string {
  const parts: string[] = [];

  for (const [objectType, schema] of schemas) {
    const fields = schema.fields
      .map(f => {
        let desc = `${f.name}: ${f.type}`;
        if (f.required) desc += ' (required)';
        if (f.readOnly) desc += ' (read-only)';
        if (f.enum) desc += ` [${f.enum.join('|')}]`;
        return desc;
      })
      .join(', ');

    parts.push(`${schema.objectType}: { ${fields} }`);
  }

  return parts.join('\n');
}
```

### Step 5.2: Add Schema Provisioning to TenantDO

```typescript
// Add to TenantDO class

import { fetchAllSchemas, ClioSchema } from './services/clio-schema';

private async handleProvisionSchema(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const { userId } = await request.json() as { userId: string };

  // Get a valid token
  const accessToken = await this.getValidClioToken(userId);
  if (!accessToken) {
    return Response.json(
      { error: 'No valid Clio token' },
      { status: 401 }
    );
  }

  // Fetch all schemas from Clio
  const schemas = await fetchAllSchemas(accessToken);

  // Store in SQLite and update memory cache
  const now = Date.now();
  for (const [objectType, schema] of schemas) {
    this.sql.exec(
      `INSERT OR REPLACE INTO clio_schema_cache
       (object_type, schema, fetched_at)
       VALUES (?, ?, ?)`,
      objectType,
      JSON.stringify(schema),
      now
    );

    this.schemaCache.set(objectType, schema);
  }

  // Log the provisioning
  await this.appendAuditLog({
    user_id: userId,
    action: 'schema_provision',
    object_type: 'clio_schema',
    params: { objectCount: schemas.size },
    result: 'success',
  });

  return Response.json({
    success: true,
    schemas: Array.from(schemas.keys()),
  });
}
```

---

## Part 6: Executing Clio API Calls

### Step 6.1: Create the Clio API Client

Create `src/services/clio-api.ts`:

```typescript
const CLIO_API_BASE = 'https://app.clio.com/api/v4';

export interface ClioApiResponse<T = unknown> {
  data: T;
  meta?: { paging?: { next?: string } };
}

export interface ClioApiError {
  error: {
    type: string;
    message: string;
  };
}

// Map object types to API endpoints
const ENDPOINT_MAP: Record<string, string> = {
  Matter: 'matters',
  Contact: 'contacts',
  Task: 'tasks',
  CalendarEntry: 'calendar_entries',
  TimeEntry: 'time_entries',
  Document: 'documents',
};

/**
 * Execute a Clio API call with automatic error handling.
 */
export async function executeClioCall(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  endpoint: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: string; status: number }> {
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${CLIO_API_BASE}/${endpoint}`, options);

  // Handle specific error codes
  if (!response.ok) {
    const errorText = await response.text();
    return {
      success: false,
      error: mapClioError(response.status, errorText),
      status: response.status,
    };
  }

  // DELETE returns no content
  if (method === 'DELETE') {
    return { success: true, status: response.status };
  }

  const data = await response.json();
  return { success: true, data, status: response.status };
}

/**
 * Map Clio HTTP status codes to user-friendly messages.
 */
function mapClioError(status: number, errorText: string): string {
  switch (status) {
    case 400:
      return 'The request was invalid. Please try rephrasing.';
    case 401:
      return 'Your Clio connection expired. Please reconnect at docket.com/settings.';
    case 403:
      return "You don't have permission to access this in Clio.";
    case 404:
      return "That record wasn't found in Clio.";
    case 410:
      return 'This API version is no longer supported.';
    case 422:
      return 'Clio rejected the request—some fields may be missing or invalid.';
    case 429:
      return 'Clio is busy. Please wait a moment and try again.';
    default:
      if (status >= 500) {
        return 'Clio is having issues. Please try again shortly.';
      }
      return `Clio error: ${errorText}`;
  }
}

/**
 * Build a read query (GET with optional filters).
 */
export function buildReadQuery(
  objectType: string,
  id?: string,
  filters?: Record<string, unknown>
): string {
  const endpoint = ENDPOINT_MAP[objectType];
  if (!endpoint) throw new Error(`Unknown object type: ${objectType}`);

  let path = endpoint;

  // Single record lookup
  if (id) {
    path += `/${id}.json`;
  } else {
    path += '.json';
  }

  // Add query filters
  if (filters && Object.keys(filters).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      params.set(key, String(value));
    }
    path += `?${params.toString()}`;
  }

  return path;
}

/**
 * Build a create request body.
 */
export function buildCreateBody(
  objectType: string,
  data: Record<string, unknown>
): { endpoint: string; body: Record<string, unknown> } {
  const endpoint = ENDPOINT_MAP[objectType];
  if (!endpoint) throw new Error(`Unknown object type: ${objectType}`);

  // Clio expects data wrapped in the object type key
  const singularKey = objectType.toLowerCase();
  return {
    endpoint: `${endpoint}.json`,
    body: { data: { [singularKey]: data } },
  };
}

/**
 * Build an update request body.
 */
export function buildUpdateBody(
  objectType: string,
  id: string,
  data: Record<string, unknown>
): { endpoint: string; body: Record<string, unknown> } {
  const endpoint = ENDPOINT_MAP[objectType];
  if (!endpoint) throw new Error(`Unknown object type: ${objectType}`);

  const singularKey = objectType.toLowerCase();
  return {
    endpoint: `${endpoint}/${id}.json`,
    body: { data: { [singularKey]: data } },
  };
}

/**
 * Build a delete request.
 */
export function buildDeleteEndpoint(objectType: string, id: string): string {
  const endpoint = ENDPOINT_MAP[objectType];
  if (!endpoint) throw new Error(`Unknown object type: ${objectType}`);
  return `${endpoint}/${id}.json`;
}
```

### Step 6.2: Update the Tool Call Handler in TenantDO

Replace the placeholder `executeClioRead` and `executeClioCUD` methods:

```typescript
import {
  executeClioCall,
  buildReadQuery,
  buildCreateBody,
  buildUpdateBody,
  buildDeleteEndpoint,
} from './services/clio-api';

private async executeClioRead(
  userId: string,
  args: { objectType: string; id?: string; filters?: Record<string, unknown> }
): Promise<string> {
  // Get valid token (with proactive refresh)
  let accessToken = await this.getValidClioToken(userId);
  if (!accessToken) {
    return "You haven't connected your Clio account yet. Please connect at docket.com/settings.";
  }

  // Build the query
  const endpoint = buildReadQuery(args.objectType, args.id, args.filters);

  // Execute the call
  let result = await executeClioCall('GET', endpoint, accessToken);

  // Handle 401 with reactive refresh
  if (result.status === 401) {
    accessToken = await this.handleClioUnauthorized(userId);
    if (!accessToken) {
      return "Your Clio connection expired. Please reconnect at docket.com/settings.";
    }
    result = await executeClioCall('GET', endpoint, accessToken);
  }

  if (!result.success) {
    return result.error || 'Failed to query Clio.';
  }

  // Format the response for the LLM
  return JSON.stringify(result.data, null, 2);
}

private async executeClioCUD(
  userId: string,
  action: 'create' | 'update' | 'delete',
  objectType: string,
  data: Record<string, unknown>
): Promise<{ success: boolean; details?: string; error?: string }> {
  // Get valid token
  let accessToken = await this.getValidClioToken(userId);
  if (!accessToken) {
    return { success: false, error: 'Clio not connected' };
  }

  let method: 'POST' | 'PATCH' | 'DELETE';
  let endpoint: string;
  let body: Record<string, unknown> | undefined;

  switch (action) {
    case 'create': {
      method = 'POST';
      const createData = buildCreateBody(objectType, data);
      endpoint = createData.endpoint;
      body = createData.body;
      break;
    }
    case 'update': {
      method = 'PATCH';
      const id = data.id as string;
      delete data.id;
      const updateData = buildUpdateBody(objectType, id, data);
      endpoint = updateData.endpoint;
      body = updateData.body;
      break;
    }
    case 'delete': {
      method = 'DELETE';
      endpoint = buildDeleteEndpoint(objectType, data.id as string);
      break;
    }
  }

  // Execute the call
  let result = await executeClioCall(method, endpoint, accessToken, body);

  // Handle 401 with reactive refresh
  if (result.status === 401) {
    accessToken = await this.handleClioUnauthorized(userId);
    if (!accessToken) {
      return { success: false, error: 'Clio connection expired' };
    }
    result = await executeClioCall(method, endpoint, accessToken, body);
  }

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    details: result.data ? JSON.stringify(result.data) : undefined,
  };
}
```

---

## Part 7: Testing Strategy

### Unit Tests

Create `test/clio-oauth.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  verifyState,
  buildAuthorizationUrl,
  tokenNeedsRefresh,
} from '../src/services/clio-oauth';

describe('PKCE', () => {
  it('generates valid code verifier', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates valid code challenge', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge.length).toBeGreaterThan(0);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces different challenges for different verifiers', async () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    const c1 = await generateCodeChallenge(v1);
    const c2 = await generateCodeChallenge(v2);
    expect(c1).not.toBe(c2);
  });
});

describe('State Management', () => {
  const SECRET = 'test-secret-key';

  it('generates and verifies state', async () => {
    const verifier = generateCodeVerifier();
    const state = await generateState('user-1', 'org-1', verifier, SECRET);

    const result = await verifyState(state, SECRET);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe('user-1');
    expect(result?.orgId).toBe('org-1');
    expect(result?.verifier).toBe(verifier);
  });

  it('rejects tampered state', async () => {
    const state = await generateState('user-1', 'org-1', 'verifier', SECRET);
    const tampered = state.replace('.', 'X.');
    const result = await verifyState(tampered, SECRET);
    expect(result).toBeNull();
  });

  it('rejects wrong secret', async () => {
    const state = await generateState('user-1', 'org-1', 'verifier', SECRET);
    const result = await verifyState(state, 'wrong-secret');
    expect(result).toBeNull();
  });
});

describe('Authorization URL', () => {
  it('builds correct URL with all params', () => {
    const url = buildAuthorizationUrl({
      clientId: 'test-client',
      redirectUri: 'https://example.com/callback',
      state: 'test-state',
      codeChallenge: 'test-challenge',
    });

    expect(url).toContain('client_id=test-client');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
    expect(url).toContain('state=test-state');
    expect(url).toContain('code_challenge=test-challenge');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('response_type=code');
  });
});

describe('Token Refresh Logic', () => {
  it('detects tokens needing refresh', () => {
    const expiringSoon = {
      access_token: 'test',
      refresh_token: 'test',
      expires_at: Date.now() + 2 * 60 * 1000, // 2 minutes
    };
    expect(tokenNeedsRefresh(expiringSoon)).toBe(true);
  });

  it('detects valid tokens', () => {
    const valid = {
      access_token: 'test',
      refresh_token: 'test',
      expires_at: Date.now() + 60 * 60 * 1000, // 1 hour
    };
    expect(tokenNeedsRefresh(valid)).toBe(false);
  });
});
```

### Integration Tests

Create `test/clio-integration.spec.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

// These tests require --remote flag and actual Clio credentials
describe.skip('Clio Integration (requires --remote)', () => {
  it('exchanges auth code for tokens', async () => {
    // This would require a real auth code from Clio
    // In practice, test with mock server or manual testing
  });

  it('fetches schema from Clio', async () => {
    // Requires valid access token
  });

  it('performs read operation', async () => {
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

  <div class="card ${connected ? 'success' : 'warning'}">
    <h2>Connection Status</h2>
    <p><strong>Clio Connected:</strong> ${connected ? 'Yes' : 'No'}</p>
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
      ${schemas.map((s) => `<li>${s}</li>`).join('')}
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
      : ''
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

| Component | What It Does |
|-----------|--------------|
| `clio-oauth.ts` | PKCE generation, state signing, token exchange/refresh |
| `clio-schema.ts` | Fetches and formats Clio object schemas |
| `clio-api.ts` | Executes validated API calls with error handling |
| TenantDO updates | Token storage, schema caching, tool execution |

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
