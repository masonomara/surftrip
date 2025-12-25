import { getAuth } from "./lib/auth";
import { TenantDO } from "./do/tenant";
import { handleTeamsMessage } from "./handlers/teams";
import { handleClioConnect, handleClioCallback } from "./handlers/clio-oauth";
import { handleCreateOrg, handleGetUserOrg } from "./handlers/org";
import type { Env } from "./types/env";

export { TenantDO };
export type { Env };

// Origins allowed to make cross-origin requests
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://docketadmin.com",
  "https://www.docketadmin.com",
];

/**
 * Builds CORS headers based on the request's origin.
 * Only allows origins from our whitelist.
 */
function getCorsHeaders(request: Request): HeadersInit {
  const requestOrigin = request.headers.get("Origin") || "";
  const isAllowedOrigin = ALLOWED_ORIGINS.includes(requestOrigin);

  return {
    "Access-Control-Allow-Origin": isAllowedOrigin
      ? requestOrigin
      : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Wraps a response with CORS headers.
 */
function addCorsHeaders(response: Response, request: Request): Response {
  const newHeaders = new Headers(response.headers);
  const corsHeaders = getCorsHeaders(request);

  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * Handles CORS preflight requests.
 */
function handleOptionsRequest(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

/**
 * Health check endpoint - always returns ok.
 */
function handleHealthCheck(): Response {
  return Response.json({ status: "ok" });
}

/**
 * Readiness check - verifies database connectivity.
 */
async function handleReadyCheck(env: Env): Promise<Response> {
  try {
    await env.DB.prepare("SELECT 1").first();
    return Response.json({ status: "ready", db: "ok" });
  } catch (error) {
    console.error("Database readiness check failed:", error);
    return Response.json({ status: "not ready", db: "error" }, { status: 503 });
  }
}

/**
 * Handles authentication requests via better-auth.
 */
async function handleAuthRequest(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const auth = getAuth(env);
    return await auth.handler(request);
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? `${error.message}\n${error.stack}`
        : String(error);
    console.error("Auth handler exception:", errorMessage);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * Main request handler - routes requests to appropriate handlers.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return handleOptionsRequest(request);
    }

    // Health and readiness checks (no CORS needed)
    if (path === "/health") {
      return handleHealthCheck();
    }

    if (path === "/ready") {
      return handleReadyCheck(env);
    }

    // Auth routes (handled by better-auth)
    if (path.startsWith("/api/auth")) {
      const response = await handleAuthRequest(request, env);
      return addCorsHeaders(response, request);
    }

    // Teams webhook
    if (path === "/api/messages") {
      return handleTeamsMessage(request, env);
    }

    // Clio OAuth flow
    if (path === "/clio/connect") {
      return handleClioConnect(request, env);
    }

    if (path === "/clio/callback") {
      return handleClioCallback(request, env);
    }

    // Organization endpoints
    if (path === "/api/org" && method === "POST") {
      const response = await handleCreateOrg(request, env);
      return addCorsHeaders(response, request);
    }

    if (path === "/api/user/org" && method === "GET") {
      const response = await handleGetUserOrg(request, env);
      return addCorsHeaders(response, request);
    }

    // No matching route
    const notFoundResponse = Response.json(
      { error: "Not found" },
      { status: 404 }
    );
    return addCorsHeaders(notFoundResponse, request);
  },
};
