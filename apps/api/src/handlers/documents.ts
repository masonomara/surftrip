import { getSession, getMembership } from "../lib/session";
import { createLogger, generateRequestId } from "../lib/logger";
import type { Env } from "../types/env";
import {
  listOrgContext,
  uploadOrgContext,
  deleteOrgContext,
  getOrgContextDocument,
} from "../services/org-context";

// ============================================================================
// Types
// ============================================================================

interface AuthenticatedUser {
  userId: string;
  orgId: string;
}

// ============================================================================
// Authentication Helper
// ============================================================================

/**
 * Checks if the request is from an authenticated admin user.
 * Returns the user info if authenticated, or an error Response if not.
 */
async function requireAdmin(
  request: Request,
  env: Env
): Promise<AuthenticatedUser | Response> {
  const session = await getSession(request, env);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getMembership(env.DB, session.user.id, true);

  if (!membership) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  return {
    userId: session.user.id,
    orgId: membership.org_id,
  };
}

/**
 * Type guard to check if the auth result is an error response.
 */
function isAuthError(result: AuthenticatedUser | Response): result is Response {
  return result instanceof Response;
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /api/documents
 * Lists all documents for the authenticated user's organization.
 */
export async function handleGetDocuments(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireAdmin(request, env);

  if (isAuthError(auth)) {
    return auth;
  }

  const documents = await listOrgContext(env, auth.orgId);
  return Response.json(documents);
}

/**
 * POST /api/documents
 * Uploads a new document to the organization's context.
 */
export async function handleUploadDocument(
  request: Request,
  env: Env
): Promise<Response> {
  const log = createLogger({
    requestId: generateRequestId(),
    handler: "uploadDocument",
  });

  // Check authentication
  const auth = await requireAdmin(request, env);

  if (isAuthError(auth)) {
    log.warn("Upload rejected: unauthorized");
    return auth;
  }

  const orgLog = log.child({ orgId: auth.orgId, userId: auth.userId });

  // Parse the form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    orgLog.warn("Upload rejected: invalid form data");
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  // Validate the file
  const file = formData.get("file");

  if (!(file instanceof File)) {
    orgLog.warn("Upload rejected: no file provided");
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  orgLog.info("Upload started", {
    filename: file.name,
    mimeType: file.type,
    size: file.size,
  });

  // Process the upload
  const fileBuffer = await file.arrayBuffer();
  const result = await uploadOrgContext(
    env,
    auth.orgId,
    file.name,
    file.type,
    fileBuffer,
    auth.userId,
    orgLog
  );

  if (!result.success) {
    orgLog.error("Upload failed", { error: result.error });
    return Response.json(
      { error: result.error || "Upload failed" },
      { status: 400 }
    );
  }

  orgLog.info("Upload complete", {
    fileId: result.fileId,
    chunksCreated: result.chunksCreated,
  });

  // Return the newly created document
  const document = await getOrgContextDocument(env, auth.orgId, result.fileId!);
  return Response.json(document, { status: 201 });
}

/**
 * DELETE /api/documents/:documentId
 * Deletes a document from the organization's context.
 */
export async function handleDeleteDocument(
  request: Request,
  env: Env,
  documentId: string
): Promise<Response> {
  const auth = await requireAdmin(request, env);

  if (isAuthError(auth)) {
    return auth;
  }

  // Check if the document exists and belongs to this org
  const existingDocument = await getOrgContextDocument(
    env,
    auth.orgId,
    documentId
  );

  if (!existingDocument) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  // Delete the document
  const result = await deleteOrgContext(env, auth.orgId, documentId);

  if (!result.success) {
    return Response.json(
      { error: result.error || "Delete failed" },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
