/**
 * Account Handlers
 *
 * HTTP handlers for user account management, including:
 * - Deletion preview (shows what data will be removed)
 * - Account deletion with email confirmation
 */

import { getAuth } from "../lib/auth";
import type { Env } from "../types/env";
import { getDataDeletionPreview, deleteUserData } from "../services/gdpr";

/**
 * Attempts to get the authenticated user session from the request.
 * Returns null if authentication fails or no session exists.
 */
async function getAuthenticatedSession(request: Request, env: Env) {
  try {
    return await getAuth(env).api.getSession({ headers: request.headers });
  } catch {
    return null;
  }
}

/**
 * GET /api/account/deletion-preview
 *
 * Returns a summary of all data that will be deleted if the user
 * deletes their account. This helps users understand the impact
 * of account deletion before confirming.
 *
 * Response includes counts of:
 * - Messages they've sent
 * - Organizations they own (which will be deleted)
 * - Organizations they're a member of (which they'll be removed from)
 * - Documents they've uploaded
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
 * PATCH /api/account
 *
 * Updates the authenticated user's account information.
 * Currently supports updating the user's display name.
 *
 * Request body: { name?: string }
 */
export async function handleUpdateAccount(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getAuthenticatedSession(request, env);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate name if provided
  if (body.name !== undefined) {
    const trimmedName = body.name.trim();

    if (trimmedName.length === 0) {
      return Response.json({ error: "Name cannot be empty" }, { status: 400 });
    }

    if (trimmedName.length > 100) {
      return Response.json(
        { error: "Name must be 100 characters or less" },
        { status: 400 }
      );
    }

    // Update the user's name
    await env.DB.prepare(
      "UPDATE user SET name = ?, updated_at = ? WHERE id = ?"
    )
      .bind(trimmedName, Date.now(), session.user.id)
      .run();

    return Response.json({ success: true, name: trimmedName });
  }

  return Response.json({ error: "No fields to update" }, { status: 400 });
}

/**
 * DELETE /api/account
 *
 * Permanently deletes the user's account and all associated data.
 * Requires email confirmation to prevent accidental deletion.
 *
 * If the user is the sole owner of any organizations, returns an error
 * with the list of org IDs. The user must either:
 * - Transfer ownership to another admin
 * - Delete the organization first
 *
 * Request body: { confirmEmail: string }
 *
 * Response on success: { deleted: { ... counts ... } }
 * Response on sole_owner error: { error: "sole_owner", orgIds: [...] }
 */
export async function handleDeleteAccount(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getAuthenticatedSession(request, env);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse request body
  let body: { confirmEmail?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Verify email matches to confirm this destructive action
  if (!body.confirmEmail || body.confirmEmail !== session.user.email) {
    return Response.json({ error: "Email does not match" }, { status: 400 });
  }

  // Delete all user data
  const result = await deleteUserData(
    env.DB,
    env.R2,
    env.VECTORIZE,
    session.user.id,
    env.TENANT
  );

  // Check if deletion was blocked because user is sole owner
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
