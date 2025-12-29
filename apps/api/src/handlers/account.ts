import { getSession } from "../lib/session";
import type { Env } from "../types/env";
import { getDataDeletionPreview, deleteUserData } from "../services/gdpr";

// -----------------------------------------------------------------------------
// Get Account Deletion Preview
// -----------------------------------------------------------------------------

export async function handleGetAccountDeletionPreview(
  request: Request,
  env: Env
): Promise<Response> {
  // Verify user is authenticated
  const session = await getSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get deletion preview data
  const preview = await getDataDeletionPreview(env.DB, session.user.id);

  return Response.json(preview);
}

// -----------------------------------------------------------------------------
// Update Account
// -----------------------------------------------------------------------------

export async function handleUpdateAccount(
  request: Request,
  env: Env
): Promise<Response> {
  // Verify user is authenticated
  const session = await getSession(request, env);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse request body
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Handle name update
  if (body.name !== undefined) {
    const trimmedName = body.name.trim();

    // Validate name
    if (trimmedName.length === 0) {
      return Response.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    if (trimmedName.length > 100) {
      return Response.json(
        { error: "Name must be 100 characters or less" },
        { status: 400 }
      );
    }

    // Update the user's name in the database
    await env.DB.prepare(
      "UPDATE user SET name = ?, updated_at = ? WHERE id = ?"
    )
      .bind(trimmedName, Date.now(), session.user.id)
      .run();

    return Response.json({ success: true, name: trimmedName });
  }

  return Response.json({ error: "No fields to update" }, { status: 400 });
}

// -----------------------------------------------------------------------------
// Delete Account
// -----------------------------------------------------------------------------

export async function handleDeleteAccount(
  request: Request,
  env: Env
): Promise<Response> {
  // Verify user is authenticated
  const session = await getSession(request, env);
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

  // Verify email confirmation matches
  if (!body.confirmEmail || body.confirmEmail !== session.user.email) {
    return Response.json({ error: "Email does not match" }, { status: 400 });
  }

  // Attempt to delete user data
  const result = await deleteUserData(
    env.DB,
    env.R2,
    env.VECTORIZE,
    session.user.id,
    env.TENANT
  );

  // Check if deletion was blocked (e.g., user is sole owner of an org)
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
