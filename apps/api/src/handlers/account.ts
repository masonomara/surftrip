import type { AuthContext } from "../lib/session";
import type { Env } from "../types/env";
import { getDataDeletionPreview, deleteUserData } from "../services/gdpr";

// -----------------------------------------------------------------------------
// Get Account Deletion Preview
// -----------------------------------------------------------------------------

export async function handleGetAccountDeletionPreview(
  _request: Request,
  env: Env,
  ctx: AuthContext
): Promise<Response> {
  const preview = await getDataDeletionPreview(env.DB, ctx.user.id);
  return Response.json(preview);
}

// -----------------------------------------------------------------------------
// Update Account
// -----------------------------------------------------------------------------

export async function handleUpdateAccount(
  request: Request,
  env: Env,
  ctx: AuthContext
): Promise<Response> {
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

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

    await env.DB.prepare(
      "UPDATE user SET name = ?, updated_at = ? WHERE id = ?"
    )
      .bind(trimmedName, Date.now(), ctx.user.id)
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
  env: Env,
  ctx: AuthContext
): Promise<Response> {
  let body: { confirmEmail?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.confirmEmail || body.confirmEmail !== ctx.user.email) {
    return Response.json({ error: "Email does not match" }, { status: 400 });
  }

  const result = await deleteUserData(
    env.DB,
    env.R2,
    env.VECTORIZE,
    ctx.user.id,
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
