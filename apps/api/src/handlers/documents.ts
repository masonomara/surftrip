import { getAuth } from "../lib/auth";
import { createLogger, generateRequestId } from "../lib/logger";
import type { Env } from "../types/env";
import {
  listOrgContext,
  uploadOrgContext,
  deleteOrgContext,
  getOrgContextDocument,
} from "../services/org-context";

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
 * Checks if the user is an admin of any organization.
 * Returns the org ID if they are, null otherwise.
 */
async function getAdminMembership(
  db: D1Database,
  userId: string
): Promise<{ orgId: string } | null> {
  const row = await db
    .prepare(
      `SELECT org_id, role FROM org_members WHERE user_id = ? AND role = 'admin'`
    )
    .bind(userId)
    .first<{ org_id: string; role: string }>();

  if (!row) {
    return null;
  }

  return { orgId: row.org_id };
}

/**
 * GET /api/org/documents
 * Lists all documents uploaded to the organization's context.
 * Requires admin access.
 */
export async function handleGetDocuments(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getAuthenticatedSession(request, env);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getAdminMembership(env.DB, session.user.id);

  if (!membership) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const documents = await listOrgContext(env, membership.orgId);
  return Response.json(documents);
}

/**
 * POST /api/org/documents
 * Uploads a new document to the organization's context.
 * The document is processed, chunked, and indexed for RAG retrieval.
 * Requires admin access.
 */
export async function handleUploadDocument(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = generateRequestId();
  const log = createLogger({ requestId, handler: "uploadDocument" });

  // Authenticate the user
  const session = await getAuthenticatedSession(request, env);

  if (!session?.user) {
    log.warn("Upload rejected: unauthorized");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify admin access
  const membership = await getAdminMembership(env.DB, session.user.id);

  if (!membership) {
    log.warn("Upload rejected: not admin", { userId: session.user.id });
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const orgLog = log.child({
    orgId: membership.orgId,
    userId: session.user.id,
  });

  // Parse the multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    orgLog.warn("Upload rejected: invalid form data");
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  // Extract and validate the file
  const file = formData.get("file");
  const isValidFile = file && file instanceof File;

  if (!isValidFile) {
    orgLog.warn("Upload rejected: no file provided");
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  orgLog.info("Upload started", {
    filename: file.name,
    mimeType: file.type,
    size: file.size,
  });

  // Process the upload (validates, stores, chunks, and indexes the file)
  const fileContent = await file.arrayBuffer();
  const result = await uploadOrgContext(
    env,
    membership.orgId,
    file.name,
    file.type,
    fileContent,
    session.user.id,
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

  // Return the full document metadata
  const document = await getOrgContextDocument(
    env,
    membership.orgId,
    result.fileId!
  );

  return Response.json(document, { status: 201 });
}

/**
 * DELETE /api/org/documents/:documentId
 * Deletes a document from the organization's context.
 * Also removes all associated chunks and vector embeddings.
 * Requires admin access.
 */
export async function handleDeleteDocument(
  request: Request,
  env: Env,
  documentId: string
): Promise<Response> {
  const session = await getAuthenticatedSession(request, env);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getAdminMembership(env.DB, session.user.id);

  if (!membership) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  // Verify the document exists and belongs to this org
  const existingDocument = await getOrgContextDocument(
    env,
    membership.orgId,
    documentId
  );

  if (!existingDocument) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  // Delete the document and all associated data
  const result = await deleteOrgContext(env, membership.orgId, documentId);

  if (!result.success) {
    return Response.json(
      { error: result.error || "Delete failed" },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
