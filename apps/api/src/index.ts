import { getAuth } from "./lib/auth";
import { TenantDO } from "./do/tenant";
import { handleTeamsMessage } from "./handlers/teams";
import { handleClioCallback } from "./handlers/clio-oauth";
import {
  handleClioConnectAuth,
  handleClioStatus,
  handleClioRefreshSchema,
  handleClioDisconnect,
} from "./handlers/clio";
import {
  handleCreateOrg,
  handleGetUserOrg,
  handleGetOrgDeletionPreview,
  handleDeleteOrg,
} from "./handlers/org";
import {
  handleGetMembers,
  handleSendInvitation,
  handleGetInvitations,
  handleRevokeInvitation,
  handleRemoveMember,
  handleUpdateMemberRole,
  handleTransferOwnership,
  handleGetInvitation,
  handleAcceptInvitation,
} from "./handlers/members";
import {
  handleGetAccountDeletionPreview,
  handleDeleteAccount,
} from "./handlers/account";
import type { Env } from "./types/env";

export { TenantDO };
export type { Env };

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://docketadmin.com",
  "https://www.docketadmin.com",
];

function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

function withCors(response: Response, request: Request): Response {
  const corsHeaders = getCorsHeaders(request);
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }

    // Health checks (no CORS needed)
    if (path === "/health") {
      return Response.json({ status: "ok" });
    }

    if (path === "/ready") {
      try {
        await env.DB.prepare("SELECT 1").first();
        return Response.json({ status: "ready", db: "ok" });
      } catch {
        return Response.json(
          { status: "not ready", db: "error" },
          { status: 503 }
        );
      }
    }

    // Auth routes (handled by better-auth)
    if (path.startsWith("/api/auth")) {
      try {
        const authResponse = await getAuth(env).handler(request);
        return withCors(authResponse, request);
      } catch (error) {
        const message =
          error instanceof Error
            ? `${error.message}\n${error.stack}`
            : String(error);
        return Response.json({ error: message }, { status: 500 });
      }
    }

    // Integration routes (no auth required)
    if (path === "/api/messages") {
      return handleTeamsMessage(request, env);
    }
    if (path === "/clio/callback") {
      return handleClioCallback(request, env);
    }

    // Try to match API routes
    const response = await routeRequest(request, env, path, method);
    if (response) {
      return withCors(response, request);
    }

    // No route matched
    return withCors(
      Response.json({ error: "Not found" }, { status: 404 }),
      request
    );
  },
};

async function routeRequest(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  // Organization routes
  if (path === "/api/org" && method === "POST") {
    return handleCreateOrg(request, env);
  }
  if (path === "/api/org" && method === "DELETE") {
    return handleDeleteOrg(request, env);
  }
  if (path === "/api/org/deletion-preview" && method === "GET") {
    return handleGetOrgDeletionPreview(request, env);
  }
  if (path === "/api/user/org" && method === "GET") {
    return handleGetUserOrg(request, env);
  }

  // Clio routes
  if (path === "/api/clio/connect" && method === "GET") {
    return handleClioConnectAuth(request, env);
  }
  if (path === "/api/clio/status" && method === "GET") {
    return handleClioStatus(request, env);
  }
  if (path === "/api/clio/disconnect" && method === "POST") {
    return handleClioDisconnect(request, env);
  }
  if (path === "/api/org/clio/refresh-schema" && method === "POST") {
    return handleClioRefreshSchema(request, env);
  }

  // Member management routes
  if (path === "/api/org/members" && method === "GET") {
    return handleGetMembers(request, env);
  }
  if (path === "/api/org/invitations" && method === "POST") {
    return handleSendInvitation(request, env);
  }
  if (path === "/api/org/invitations" && method === "GET") {
    return handleGetInvitations(request, env);
  }
  if (path === "/api/org/transfer-ownership" && method === "POST") {
    return handleTransferOwnership(request, env);
  }

  // Individual member routes: /api/org/members/:userId
  const memberMatch = path.match(/^\/api\/org\/members\/([^/]+)$/);
  if (memberMatch) {
    const userId = memberMatch[1];
    if (method === "DELETE") {
      return handleRemoveMember(request, env, userId);
    }
    if (method === "PATCH") {
      return handleUpdateMemberRole(request, env, userId);
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Invitation management: /api/org/invitations/:id
  const invitationMatch = path.match(/^\/api\/org\/invitations\/([^/]+)$/);
  if (invitationMatch && method === "DELETE") {
    return handleRevokeInvitation(request, env, invitationMatch[1]);
  }

  // Public invitation routes (no auth required for viewing)
  const publicInviteMatch = path.match(/^\/api\/invitations\/([^/]+)$/);
  if (publicInviteMatch && method === "GET") {
    return handleGetInvitation(request, env, publicInviteMatch[1]);
  }

  // Accept invitation: /api/invitations/:id/accept
  const acceptMatch = path.match(/^\/api\/invitations\/([^/]+)\/accept$/);
  if (acceptMatch && method === "POST") {
    return handleAcceptInvitation(request, env, acceptMatch[1]);
  }

  // Account routes
  if (path === "/api/account/deletion-preview" && method === "GET") {
    return handleGetAccountDeletionPreview(request, env);
  }
  if (path === "/api/account" && method === "DELETE") {
    return handleDeleteAccount(request, env);
  }

  return null;
}
