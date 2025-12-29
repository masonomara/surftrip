import type { MemberContext, AdminContext } from "../lib/session";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthorizationUrl,
  verifyState,
  exchangeCodeForTokens,
} from "../services/clio-oauth";
import { createLogger, generateRequestId } from "../lib/logger";
import type { Env } from "../types/env";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ClioStatusResponse {
  connected: boolean;
  customFieldsCount: number;
  schemaVersion?: number;
  lastSyncedAt?: number;
}

interface SchemaRefreshResponse {
  count?: number;
}

// -----------------------------------------------------------------------------
// Connect to Clio (OAuth flow start)
// -----------------------------------------------------------------------------

export async function handleClioConnectAuth(
  request: Request,
  env: Env,
  ctx: MemberContext
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createLogger({ requestId, handler: "clio-connect" });
  const url = new URL(request.url);

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = await generateState(
    ctx.user.id,
    ctx.orgId,
    codeVerifier,
    env.CLIO_CLIENT_SECRET
  );
  const redirectUri = url.origin + "/clio/callback";

  const authUrl = buildAuthorizationUrl({
    clientId: env.CLIO_CLIENT_ID,
    redirectUri,
    state,
    codeChallenge,
  });

  log.info("Redirecting to Clio OAuth", { orgId: ctx.orgId });
  return Response.redirect(authUrl, 302);
}

// -----------------------------------------------------------------------------
// Get Clio Status
// -----------------------------------------------------------------------------

export async function handleClioStatus(
  _request: Request,
  env: Env,
  ctx: MemberContext
): Promise<Response> {
  const doStub = env.TENANT.get(env.TENANT.idFromName(ctx.orgId));
  const doRequest = new Request("https://do/get-clio-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: ctx.user.id,
      requestId: generateRequestId(),
    }),
  });

  const response = await doStub.fetch(doRequest);

  if (!response.ok) {
    return Response.json({ connected: false, schemaLoaded: false });
  }

  const doStatus = (await response.json()) as ClioStatusResponse;

  return Response.json({
    connected: doStatus.connected,
    schemaLoaded: doStatus.customFieldsCount > 0,
    schemaVersion: doStatus.schemaVersion,
    lastSyncedAt: doStatus.lastSyncedAt,
  });
}

// -----------------------------------------------------------------------------
// Refresh Clio Schema
// -----------------------------------------------------------------------------

export async function handleClioRefreshSchema(
  _request: Request,
  env: Env,
  ctx: AdminContext
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createLogger({ requestId, handler: "clio-refresh-schema" });

  const doStub = env.TENANT.get(env.TENANT.idFromName(ctx.orgId));
  const doRequest = new Request("https://do/refresh-schema", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: ctx.user.id,
      requestId,
    }),
  });

  const response = await doStub.fetch(doRequest);

  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    log.error("Schema refresh failed", { status: response.status });
    return Response.json(error, { status: response.status });
  }

  const result = (await response.json()) as SchemaRefreshResponse;
  log.info("Schema refreshed successfully", { count: result.count });

  return Response.json(result);
}

// -----------------------------------------------------------------------------
// Disconnect from Clio
// -----------------------------------------------------------------------------

export async function handleClioDisconnect(
  _request: Request,
  env: Env,
  ctx: MemberContext
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createLogger({ requestId, handler: "clio-disconnect" });

  const doStub = env.TENANT.get(env.TENANT.idFromName(ctx.orgId));
  const doRequest = new Request("https://do/delete-clio-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: ctx.user.id,
      requestId,
    }),
  });

  const response = await doStub.fetch(doRequest);

  if (!response.ok) {
    log.error("Failed to disconnect Clio");
    return Response.json(
      { error: "Failed to disconnect" },
      { status: response.status }
    );
  }

  log.info("Clio disconnected successfully", { orgId: ctx.orgId });
  return Response.json({ success: true });
}

// -----------------------------------------------------------------------------
// Handle Clio OAuth Callback
// -----------------------------------------------------------------------------

export async function handleClioCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createLogger({ requestId, handler: "clio-callback" });
  const url = new URL(request.url);

  // Build the settings page URL (for redirects)
  const webOrigin = url.origin.replace("api.", "");
  const settingsUrl = `${webOrigin}/org/clio`;

  // Check for OAuth errors
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    log.warn("OAuth authorization denied", { error: oauthError });
    return Response.redirect(`${settingsUrl}?error=denied`);
  }

  // Extract code and state from callback
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    log.warn("Missing code or state in callback");
    return Response.redirect(`${settingsUrl}?error=invalid_request`);
  }

  // Verify the state parameter
  const stateData = await verifyState(state, env.CLIO_CLIENT_SECRET);
  if (!stateData) {
    log.warn("State verification failed");
    return Response.redirect(`${settingsUrl}?error=invalid_state`);
  }

  const { userId, orgId, verifier } = stateData;

  try {
    // Exchange authorization code for tokens
    const redirectUri = url.origin + "/clio/callback";
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      clientId: env.CLIO_CLIENT_ID,
      clientSecret: env.CLIO_CLIENT_SECRET,
      redirectUri,
    });

    // Store the tokens in the Durable Object
    const doStub = env.TENANT.get(env.TENANT.idFromName(orgId));

    const storeRequest = new Request("https://do/store-clio-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, tokens, requestId }),
    });

    const storeResponse = await doStub.fetch(storeRequest);
    if (!storeResponse.ok) {
      log.error("Failed to store Clio tokens");
      return Response.redirect(`${settingsUrl}?error=exchange_failed`);
    }

    // Provision the Clio schema
    const provisionRequest = new Request("https://do/provision-schema", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, requestId }),
    });

    await doStub.fetch(provisionRequest);

    log.info("Clio connected successfully", { userId, orgId });
    return Response.redirect(`${settingsUrl}?success=connected`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("Clio callback failed", { error: errorMessage });
    return Response.redirect(`${settingsUrl}?error=exchange_failed`);
  }
}
