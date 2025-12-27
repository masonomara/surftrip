/**
 * Clio OAuth Service
 *
 * Handles the OAuth 2.0 flow for connecting to Clio, including:
 * - PKCE (Proof Key for Code Exchange) for secure authorization
 * - HMAC-signed state parameters to prevent CSRF attacks
 * - Encrypted token storage in Durable Object KV
 * - Token refresh and expiration handling
 */

import {
  encrypt,
  decrypt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  constantTimeEqual,
  type EncryptionEnv,
} from "../lib/encryption";
import { createLogger } from "../lib/logger";

const log = createLogger({ component: "clio-oauth" });

// Clio OAuth endpoints
const CLIO_OAUTH_AUTHORIZE = "https://app.clio.com/oauth/authorize";
const CLIO_OAUTH_TOKEN = "https://app.clio.com/oauth/token";

// How long the OAuth state parameter is valid (10 minutes)
const STATE_EXPIRY_MS = 10 * 60 * 1000;

// Refresh tokens 5 minutes before they expire to avoid race conditions
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Clio OAuth tokens structure.
 * We store expires_at (absolute time) instead of expires_in (relative)
 * so we can easily check if the token has expired.
 */
export interface ClioTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
}

/**
 * Raw token response from Clio's OAuth endpoint.
 */
interface ClioTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Data embedded in the state parameter.
 * This allows us to recover the user context after Clio redirects back.
 */
interface StatePayload {
  userId: string;
  orgId: string;
  verifier: string;
  timestamp: number;
}

/**
 * Minimal interface for Durable Object storage.
 * Allows this service to work with DO storage without tight coupling.
 */
interface DOStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

// ============================================================
// Public Interfaces for OAuth Parameters
// ============================================================

export interface AuthorizationUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export interface TokenExchangeParams {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenRefreshParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

// ============================================================
// PKCE (Proof Key for Code Exchange) Functions
// ============================================================

/**
 * Generates a random code verifier for PKCE.
 *
 * The verifier is a 32-byte random string that we keep secret during
 * the authorization flow. When we exchange the code for tokens, we
 * prove we initiated the flow by providing this verifier.
 *
 * @returns A URL-safe base64 encoded random string
 */
export function generateCodeVerifier(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  return arrayBufferToBase64(randomBytes.buffer);
}

/**
 * Generates a code challenge from a verifier.
 *
 * The challenge is a SHA-256 hash of the verifier. We send the challenge
 * to Clio during authorization, and they verify our verifier when we
 * exchange the code for tokens.
 *
 * @param verifier - The code verifier to hash
 * @returns A URL-safe base64 encoded SHA-256 hash
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );

  return arrayBufferToBase64(hash);
}

// ============================================================
// State Parameter Functions (CSRF Protection)
// ============================================================

/**
 * Signs data using HMAC-SHA256.
 *
 * Used to create tamper-proof state parameters. The signature proves
 * that we generated the state and it hasn't been modified.
 *
 * @param data - The data to sign
 * @param secret - The HMAC secret
 * @returns A URL-safe base64 encoded signature
 */
async function signWithHmac(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();

  // Import the secret as an HMAC key
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Sign the data
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));

  return arrayBufferToBase64(signature);
}

/**
 * Generates a signed state parameter for the OAuth flow.
 *
 * The state contains:
 * - userId: The user initiating the connection
 * - orgId: The organization being connected
 * - verifier: The PKCE verifier (so we can recover it after redirect)
 * - timestamp: When the state was created (for expiration)
 *
 * Format: "base64(payload).signature"
 *
 * @param userId - The user's ID
 * @param orgId - The organization's ID
 * @param verifier - The PKCE code verifier
 * @param secret - Secret for HMAC signing
 * @returns A signed state string
 */
export async function generateState(
  userId: string,
  orgId: string,
  verifier: string,
  secret: string
): Promise<string> {
  const payload: StatePayload = {
    userId,
    orgId,
    verifier,
    timestamp: Date.now(),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = arrayBufferToBase64(
    new TextEncoder().encode(payloadJson).buffer as ArrayBuffer
  );

  const signature = await signWithHmac(payloadEncoded, secret);

  return `${payloadEncoded}.${signature}`;
}

/**
 * Verifies and decodes a state parameter.
 *
 * Checks that:
 * 1. The state has the correct format (payload.signature)
 * 2. The signature is valid (state wasn't tampered with)
 * 3. The state hasn't expired (within 10 minutes)
 *
 * @param state - The state string from the callback
 * @param secret - Secret for HMAC verification
 * @returns The decoded state payload, or null if invalid
 */
export async function verifyState(
  state: string,
  secret: string
): Promise<{ userId: string; orgId: string; verifier: string } | null> {
  // State format: "payload.signature"
  const parts = state.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [payloadEncoded, signature] = parts;

  // Verify the signature using constant-time comparison
  const expectedSignature = await signWithHmac(payloadEncoded, secret);

  if (!constantTimeEqual(signature, expectedSignature)) {
    return null;
  }

  // Decode and validate the payload
  try {
    const payloadBytes = base64ToArrayBuffer(payloadEncoded);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson) as StatePayload;

    // Check if the state has expired
    const age = Date.now() - payload.timestamp;

    if (age > STATE_EXPIRY_MS) {
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

// ============================================================
// OAuth URL Building
// ============================================================

/**
 * Builds the Clio authorization URL.
 *
 * This is the URL we redirect users to when they want to connect Clio.
 *
 * @param params - Authorization parameters
 * @returns The full authorization URL
 */
export function buildAuthorizationUrl(params: AuthorizationUrlParams): string {
  const url = new URL(CLIO_OAUTH_AUTHORIZE);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

// ============================================================
// Token Exchange and Refresh
// ============================================================

/**
 * Exchanges an authorization code for access and refresh tokens.
 *
 * This is called after Clio redirects back with an authorization code.
 * We provide the code and our PKCE verifier to prove we're the same
 * party that initiated the authorization.
 *
 * @param params - Token exchange parameters
 * @returns The Clio tokens
 * @throws Error if the exchange fails
 */
export async function exchangeCodeForTokens(
  params: TokenExchangeParams
): Promise<ClioTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
  });

  const response = await fetch(CLIO_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error("Token exchange failed", {
      status: response.status,
      error: errorText,
    });
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as ClioTokenResponse;

  // Convert expires_in (seconds from now) to expires_at (absolute timestamp)
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
  };
}

/**
 * Refreshes an expired access token.
 *
 * Clio access tokens expire after a certain time. We use the refresh
 * token to get a new access token without requiring the user to
 * re-authorize.
 *
 * @param params - Token refresh parameters
 * @returns New Clio tokens
 * @throws Error if the refresh fails (e.g., refresh token revoked)
 */
export async function refreshAccessToken(
  params: TokenRefreshParams
): Promise<ClioTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const response = await fetch(CLIO_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error("Token refresh failed", {
      status: response.status,
      error: errorText,
    });
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as ClioTokenResponse;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
  };
}

// ============================================================
// Encrypted Token Storage
// ============================================================

/**
 * Stores Clio tokens in Durable Object KV with encryption.
 *
 * Tokens are encrypted using AES-GCM with a user-specific key derived
 * from the environment's encryption key. This ensures tokens are
 * protected at rest and each user's tokens use a different key.
 *
 * @param storage - The Durable Object storage
 * @param userId - The user's ID (used as encryption salt)
 * @param tokens - The Clio tokens to store
 * @param encryptionKey - The encryption key from environment
 */
export async function storeClioTokens(
  storage: DOStorage,
  userId: string,
  tokens: ClioTokens,
  encryptionKey: string
): Promise<void> {
  // Serialize and encrypt the tokens
  const plaintext = JSON.stringify(tokens);
  const encrypted = await encrypt(plaintext, userId, encryptionKey);
  const encryptedBase64 = arrayBufferToBase64(encrypted);

  // Store in KV
  await storage.put(`clio_token:${userId}`, encryptedBase64);
}

/**
 * Retrieves and decrypts Clio tokens from Durable Object KV.
 *
 * @param storage - The Durable Object storage
 * @param userId - The user's ID
 * @param env - Environment with encryption keys
 * @returns The decrypted tokens, or null if not found
 */
export async function getClioTokens(
  storage: DOStorage,
  userId: string,
  env: EncryptionEnv
): Promise<ClioTokens | null> {
  const encryptedBase64 = (await storage.get(`clio_token:${userId}`)) as
    | string
    | undefined;

  if (!encryptedBase64) {
    return null;
  }

  try {
    const encrypted = base64ToArrayBuffer(encryptedBase64);
    const plaintext = await decrypt(encrypted, userId, env);
    return JSON.parse(plaintext) as ClioTokens;
  } catch (error) {
    log.error("Failed to decrypt Clio tokens", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Deletes Clio tokens from Durable Object KV.
 *
 * Called when a user disconnects Clio or when their tokens
 * are invalid and can't be refreshed.
 *
 * @param storage - The Durable Object storage
 * @param userId - The user's ID
 */
export async function deleteClioTokens(
  storage: DOStorage,
  userId: string
): Promise<void> {
  await storage.delete(`clio_token:${userId}`);
}

/**
 * Checks if tokens need to be refreshed.
 *
 * We refresh tokens 5 minutes before they expire to avoid situations
 * where a token expires during a request.
 *
 * @param tokens - The Clio tokens to check
 * @returns true if the tokens should be refreshed
 */
export function tokenNeedsRefresh(tokens: ClioTokens): boolean {
  const timeUntilExpiry = tokens.expires_at - Date.now();
  return timeUntilExpiry <= TOKEN_REFRESH_BUFFER_MS;
}
