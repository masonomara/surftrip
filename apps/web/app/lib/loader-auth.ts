import { redirect } from "react-router";
import { apiFetch } from "./api";
import type { SessionResponse, OrgMembership } from "./types";

interface AuthResult {
  user: SessionResponse["user"];
  org: OrgMembership;
}

interface AuthOptions {
  requireAdmin?: boolean;
}

export async function requireOrgAuth(
  request: Request,
  context: unknown,
  options: AuthOptions = {}
): Promise<AuthResult> {
  const cookie = request.headers.get("cookie") || "";

  const sessionResponse = await apiFetch(
    context,
    "/api/auth/get-session",
    cookie
  );
  if (!sessionResponse.ok) throw redirect("/auth");

  const sessionData = (await sessionResponse.json()) as SessionResponse | null;
  if (!sessionData?.user) throw redirect("/auth");

  const orgResponse = await apiFetch(context, "/api/user/org", cookie);
  if (!orgResponse.ok) throw redirect("/dashboard");

  const orgMembership = (await orgResponse.json()) as OrgMembership | null;
  if (!orgMembership?.org) throw redirect("/dashboard");

  if (options.requireAdmin && orgMembership.role !== "admin") {
    throw redirect("/dashboard");
  }

  return { user: sessionData.user, org: orgMembership };
}

interface OptionalOrgResult {
  user: SessionResponse["user"];
  org: OrgMembership | null;
}

export async function requireAuth(
  request: Request,
  context: unknown
): Promise<OptionalOrgResult> {
  const cookie = request.headers.get("cookie") || "";

  const sessionResponse = await apiFetch(
    context,
    "/api/auth/get-session",
    cookie
  );
  if (!sessionResponse.ok) throw redirect("/auth");

  const sessionData = (await sessionResponse.json()) as SessionResponse | null;
  if (!sessionData?.user) throw redirect("/auth");

  const orgResponse = await apiFetch(context, "/api/user/org", cookie);
  let org: OrgMembership | null = null;
  if (orgResponse.ok) {
    const orgData = (await orgResponse.json()) as OrgMembership | null;
    if (orgData?.org) org = orgData;
  }

  return { user: sessionData.user, org };
}
