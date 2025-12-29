import { redirect } from "react-router";
import { apiFetch, generateRequestId } from "./api";
import type { SessionResponse, OrgMembership } from "./types";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface AuthResult {
  user: SessionResponse["user"];
  org: OrgMembership;
}

interface OptionalOrgResult {
  user: SessionResponse["user"];
  org: OrgMembership | null;
}

interface AuthOptions {
  requireAdmin?: boolean;
}

type LoaderArgs = { request: Request; context: unknown };

type AuthenticatedLoaderContext<T extends OptionalOrgResult | AuthResult> =
  T & {
    cookie: string;
    requestId: string;
    fetch: (path: string) => Promise<Response>;
  };

// -----------------------------------------------------------------------------
// Protected Loader Wrappers
// -----------------------------------------------------------------------------

/**
 * Wraps a loader that requires authentication (org optional).
 * Provides auth data plus helpers for additional API calls.
 */
export function protectedLoader<T>(
  loader: (ctx: AuthenticatedLoaderContext<OptionalOrgResult>) => Promise<T> | T
) {
  return async ({ request, context }: LoaderArgs): Promise<T> => {
    const requestId = generateRequestId();
    const cookie = request.headers.get("cookie") || "";
    const auth = await requireAuth(request, context, cookie, requestId);
    return loader({
      ...auth,
      cookie,
      requestId,
      fetch: (path: string) => apiFetch(context, path, cookie, requestId),
    });
  };
}

/**
 * Wraps a loader that requires org membership.
 * Redirects to /dashboard if user has no org.
 */
export function orgLoader<T>(
  loader: (ctx: AuthenticatedLoaderContext<AuthResult>) => Promise<T> | T,
  options: AuthOptions = {}
) {
  return async ({ request, context }: LoaderArgs): Promise<T> => {
    const requestId = generateRequestId();
    const cookie = request.headers.get("cookie") || "";
    const auth = await requireOrgAuth(
      request,
      context,
      cookie,
      requestId,
      options
    );
    return loader({
      ...auth,
      cookie,
      requestId,
      fetch: (path: string) => apiFetch(context, path, cookie, requestId),
    });
  };
}

// -----------------------------------------------------------------------------
// Core Auth Functions (used by wrappers)
// -----------------------------------------------------------------------------

export async function requireOrgAuth(
  request: Request,
  context: unknown,
  cookie: string,
  requestId: string,
  options: AuthOptions = {}
): Promise<AuthResult> {
  const sessionResponse = await apiFetch(
    context,
    "/api/auth/get-session",
    cookie,
    requestId
  );
  if (!sessionResponse.ok) throw redirect("/auth");

  const sessionData = (await sessionResponse.json()) as SessionResponse | null;
  if (!sessionData?.user) throw redirect("/auth");

  const orgResponse = await apiFetch(
    context,
    "/api/user/org",
    cookie,
    requestId
  );
  if (!orgResponse.ok) throw redirect("/dashboard");

  const orgMembership = (await orgResponse.json()) as OrgMembership | null;
  if (!orgMembership?.org) throw redirect("/dashboard");

  if (options.requireAdmin && orgMembership.role !== "admin") {
    throw redirect("/dashboard");
  }

  return { user: sessionData.user, org: orgMembership };
}

export async function requireAuth(
  request: Request,
  context: unknown,
  cookie: string,
  requestId: string
): Promise<OptionalOrgResult> {
  const sessionResponse = await apiFetch(
    context,
    "/api/auth/get-session",
    cookie,
    requestId
  );
  if (!sessionResponse.ok) throw redirect("/auth");

  const sessionData = (await sessionResponse.json()) as SessionResponse | null;
  if (!sessionData?.user) throw redirect("/auth");

  const orgResponse = await apiFetch(
    context,
    "/api/user/org",
    cookie,
    requestId
  );
  let org: OrgMembership | null = null;
  if (orgResponse.ok) {
    const orgData = (await orgResponse.json()) as OrgMembership | null;
    if (orgData?.org) org = orgData;
  }

  return { user: sessionData.user, org };
}
