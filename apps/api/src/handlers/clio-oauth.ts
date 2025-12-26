import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  verifyState,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
} from "../services/clio-oauth";
import { createLogger, generateRequestId } from "../lib/logger";
import type { Env } from "../types/env";

/**
 * Initiates the Clio OAuth flow.
 * Generates PKCE credentials and redirects user to Clio's authorization page.
 */
export async function handleClioConnect(
  request: Request,
  env: Env
): Promise<Response> {
  // Extract user info from headers (set by auth middleware)
  const userId = request.headers.get("X-User-Id");
  const orgId = request.headers.get("X-Org-Id");

  if (!userId || !orgId) {
    return Response.redirect("/login?redirect=/settings/clio");
  }

  // Generate PKCE credentials
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Create signed state containing user context
  const state = await generateState(
    userId,
    orgId,
    codeVerifier,
    env.CLIO_CLIENT_SECRET
  );

  // Build callback URL
  const requestUrl = new URL(request.url);
  const redirectUri = requestUrl.origin + "/clio/callback";

  // Redirect to Clio's authorization page
  const authUrl = buildAuthorizationUrl({
    clientId: env.CLIO_CLIENT_ID,
    redirectUri,
    state,
    codeChallenge,
  });

  return Response.redirect(authUrl, 302);
}

/**
 * Handles the OAuth callback from Clio.
 * Exchanges the authorization code for tokens and stores them.
 */
export async function handleClioCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createLogger({ requestId, handler: "clio-callback" });

  const url = new URL(request.url);

  // Determine web app origin - derive from API origin by removing "api." prefix
  const webOrigin = url.origin.replace("api.", "");
  const settingsUrl = `${webOrigin}/org/clio`;

  log.info("Clio OAuth callback received", {
    hasCode: url.searchParams.has("code"),
    hasState: url.searchParams.has("state"),
    hasError: url.searchParams.has("error"),
    origin: url.origin,
    webOrigin,
  });

  // Check for OAuth errors from Clio
  const oauthError = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  if (oauthError) {
    log.warn("Clio OAuth denied by user or error from Clio", {
      error: oauthError,
      errorDescription,
    });
    return Response.redirect(`${settingsUrl}?error=denied`);
  }

  // Validate required parameters
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    log.warn("Missing code or state in callback", {
      hasCode: !!code,
      hasState: !!state,
    });
    return Response.redirect(`${settingsUrl}?error=invalid_request`);
  }

  // Verify and decode the state parameter
  const stateData = await verifyState(state, env.CLIO_CLIENT_SECRET);
  if (!stateData) {
    log.warn("State verification failed - expired or tampered");
    return Response.redirect(`${settingsUrl}?error=invalid_state`);
  }

  const { userId, orgId, verifier } = stateData;
  log.info("State verified successfully", { userId, orgId });

  try {
    // Exchange code for tokens
    const redirectUri = url.origin + "/clio/callback";
    log.info("Exchanging authorization code for tokens", { redirectUri });

    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      clientId: env.CLIO_CLIENT_ID,
      clientSecret: env.CLIO_CLIENT_SECRET,
      redirectUri,
    });

    log.info("Token exchange successful", {
      tokenType: tokens.token_type,
      expiresAt: new Date(tokens.expires_at).toISOString(),
    });

    // Store tokens in the organization's Durable Object
    const doStub = env.TENANT.get(env.TENANT.idFromName(orgId));

    log.info("Storing tokens in Durable Object", { orgId });
    const storeResponse = await doStub.fetch(
      new Request("https://do/store-clio-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, tokens, requestId }),
      })
    );

    if (!storeResponse.ok) {
      const errorBody = await storeResponse.text();
      log.error("Failed to store tokens in DO", {
        status: storeResponse.status,
        error: errorBody,
      });
      return Response.redirect(`${settingsUrl}?error=exchange_failed`);
    }

    // Provision the Clio schema for this organization
    log.info("Provisioning Clio schema", { orgId });
    const schemaResponse = await doStub.fetch(
      new Request("https://do/provision-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, requestId }),
      })
    );

    if (!schemaResponse.ok) {
      log.warn("Schema provisioning failed (tokens still stored)", {
        status: schemaResponse.status,
      });
      // Don't fail the connection - schema can be provisioned later
    } else {
      const schemaResult = (await schemaResponse.json()) as { count?: number };
      log.info("Schema provisioned successfully", { count: schemaResult.count });
    }

    log.info("Clio connection completed successfully", { userId, orgId });
    return Response.redirect(`${settingsUrl}?success=connected`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    log.error("Clio callback failed", {
      error: errorMessage,
      stack: errorStack,
      userId,
      orgId,
    });

    return Response.redirect(`${settingsUrl}?error=exchange_failed`);
  }
}
