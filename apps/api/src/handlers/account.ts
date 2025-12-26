import { getAuth } from "../lib/auth";
import type { Env } from "../types/env";
import {
  getDataDeletionPreview,
  deleteUserData,
} from "../services/gdpr";

/**
 * Validates the session and returns the authenticated user.
 */
async function getAuthenticatedSession(request: Request, env: Env) {
  try {
    const auth = getAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    return session;
  } catch {
    return null;
  }
}

/**
 * Gets a preview of what would be deleted if the account is deleted.
 *
 * GET /api/account/deletion-preview
 */
export async function handleGetAccountDeletionPreview(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getAuthenticatedSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preview = await getDataDeletionPreview(env.DB, session.user.id);
  return Response.json(preview);
}

/**
 * Deletes the user's account and all their data.
 * Requires typing "DELETE" to confirm.
 *
 * DELETE /api/account
 */
export async function handleDeleteAccount(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getAuthenticatedSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse request body for confirmation
  let body: { confirm?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.confirm !== "DELETE") {
    return Response.json(
      { error: "Must confirm with 'DELETE'" },
      { status: 400 }
    );
  }

  // Perform deletion
  const result = await deleteUserData(
    env.DB,
    env.R2,
    env.VECTORIZE,
    session.user.id,
    env.TENANT
  );

  if ("type" in result && result.type === "sole_owner") {
    return Response.json(
      {
        error: "sole_owner",
        message: result.message,
        orgIds: result.orgIds,
      },
      { status: 400 }
    );
  }

  return Response.json(result);
}
