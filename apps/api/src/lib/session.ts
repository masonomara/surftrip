import { getAuth } from "./auth";
import type { Env } from "../types/env";

export async function getSession(request: Request, env: Env) {
  try {
    return await getAuth(env).api.getSession({ headers: request.headers });
  } catch {
    return null;
  }
}

interface MembershipRow {
  org_id: string;
  role: string;
  is_owner: number;
}

export async function getMembership(
  db: D1Database,
  userId: string,
  requireAdmin = false
) {
  const query = requireAdmin
    ? `SELECT org_id, role, is_owner FROM org_members WHERE user_id = ? AND role = 'admin'`
    : `SELECT org_id, role, is_owner FROM org_members WHERE user_id = ?`;
  return db.prepare(query).bind(userId).first<MembershipRow>();
}
