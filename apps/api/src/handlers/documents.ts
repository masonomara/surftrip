import type { AdminContext } from "../lib/session";
import { createLogger, generateRequestId } from "../lib/logger";
import type { Env } from "../types/env";
import {
  listOrgContext,
  uploadOrgContext,
  deleteOrgContext,
  getOrgContextDocument,
} from "../services/org-context";

/**
 * GET /api/documents
 * Lists all documents for the authenticated user's organization.
 */
export async function handleGetDocuments(
  _request: Request,
  env: Env,
  ctx: AdminContext
): Promise<Response> {
  const documents = await listOrgContext(env, ctx.orgId);
  return Response.json(documents);
}

/**
 * POST /api/documents
 * Uploads a new document to the organization's context.
 */
export async function handleUploadDocument(
  request: Request,
  env: Env,
  ctx: AdminContext
): Promise<Response> {
  const log = createLogger({
    requestId: generateRequestId(),
    handler: "uploadDocument",
  });

  const orgLog = log.child({ orgId: ctx.orgId, userId: ctx.user.id });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    orgLog.warn("Upload rejected: invalid form data");
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

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

  const fileBuffer = await file.arrayBuffer();
  const result = await uploadOrgContext(
    env,
    ctx.orgId,
    file.name,
    file.type,
    fileBuffer,
    ctx.user.id,
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

  const document = await getOrgContextDocument(env, ctx.orgId, result.fileId!);
  return Response.json(document, { status: 201 });
}

/**
 * DELETE /api/documents/:documentId
 * Deletes a document from the organization's context.
 */
export async function handleDeleteDocument(
  _request: Request,
  env: Env,
  ctx: AdminContext,
  documentId: string
): Promise<Response> {
  const existingDocument = await getOrgContextDocument(
    env,
    ctx.orgId,
    documentId
  );

  if (!existingDocument) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  const result = await deleteOrgContext(env, ctx.orgId, documentId);

  if (!result.success) {
    return Response.json(
      { error: result.error || "Delete failed" },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
