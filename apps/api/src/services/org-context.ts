/**
 * Org Context Management
 *
 * Handles uploading, processing, and deleting organization-specific documents
 * for RAG (Retrieval-Augmented Generation). Documents are:
 * 1. Stored in R2
 * 2. Chunked and stored in D1
 * 3. Embedded and indexed in Vectorize
 */

import { Env } from "../types/env";
import { KB_CONFIG } from "../config/kb";
import { R2Paths } from "../storage/r2-paths";
import { chunkText, generateEmbeddings } from "./kb-builder";

const MAX_FILENAME_LENGTH = 255;

// Map of allowed MIME types to their expected file extensions
const ALLOWED_FILE_TYPES: Map<string, string> = new Map([
  ["application/pdf", ".pdf"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".docx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pptx",
  ],
  ["application/vnd.oasis.opendocument.text", ".odt"],
  ["application/vnd.oasis.opendocument.spreadsheet", ".ods"],
  ["application/vnd.apple.numbers", ".numbers"],
  ["text/markdown", ".md"],
  ["text/plain", ".txt"],
  ["text/html", ".html"],
  ["text/csv", ".csv"],
  ["application/xml", ".xml"],
  ["text/xml", ".xml"],
]);

// Magic bytes for MIME type verification
const MAGIC_BYTES: Map<string, Uint8Array> = new Map([
  ["application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46])], // %PDF
  // OOXML and ODF formats are ZIP-based
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  ],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  ],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  ],
  [
    "application/vnd.oasis.opendocument.text",
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  ],
  [
    "application/vnd.oasis.opendocument.spreadsheet",
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  ],
  ["application/vnd.apple.numbers", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
]);

// Dangerous extensions that should never appear in filenames
const DANGEROUS_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".ps1",
  ".sh",
  ".php",
  ".jsp",
  ".asp",
  ".aspx",
  ".cgi",
  ".pl",
  ".py",
  ".rb",
  ".js",
  ".vbs",
  ".wsf",
  ".scr",
]);

/**
 * Clean and validate a filename for security issues.
 */
function sanitizeFilename(filename: string): { safe: string; error?: string } {
  // Normalize unicode and strip control characters
  const cleaned = filename.normalize("NFC").replace(/[\x00-\x1f\x7f]/g, "");

  // Check filename length
  if (cleaned.length > MAX_FILENAME_LENGTH) {
    return {
      safe: "",
      error: `Filename exceeds ${MAX_FILENAME_LENGTH} characters`,
    };
  }

  // Check for path traversal attempts
  if (
    cleaned.includes("..") ||
    cleaned.includes("/") ||
    cleaned.includes("\\")
  ) {
    return { safe: "", error: "Invalid filename: path traversal detected" };
  }

  // Reject Windows reserved device names
  const baseName = cleaned.split(".")[0];
  const windowsReserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (windowsReserved.test(baseName)) {
    return { safe: "", error: "Invalid filename: reserved name" };
  }

  // Reject hidden files (dot prefix)
  if (cleaned.startsWith(".")) {
    return { safe: "", error: "Invalid filename: hidden files not allowed" };
  }

  // Reject double extensions (e.g., file.pdf.exe, file.txt.php)
  const parts = cleaned.toLowerCase().split(".");
  if (parts.length > 2) {
    // Check non-final extensions for document types (indicates double extension attack)
    const allowedExtensions = new Set(ALLOWED_FILE_TYPES.values());
    for (let i = 1; i < parts.length - 1; i++) {
      const ext = "." + parts[i];
      if (allowedExtensions.has(ext)) {
        return {
          safe: "",
          error: "Invalid filename: double extensions not allowed",
        };
      }
    }
  }
  // Check if any dangerous extension appears anywhere in filename
  for (const ext of DANGEROUS_EXTENSIONS) {
    if (cleaned.toLowerCase().includes(ext)) {
      return {
        safe: "",
        error: "Invalid filename: dangerous extension detected",
      };
    }
  }

  return { safe: cleaned };
}

/**
 * Verify file content matches claimed MIME type via magic bytes.
 */
function verifyMagicBytes(content: ArrayBuffer, mimeType: string): boolean {
  const expected = MAGIC_BYTES.get(mimeType);
  if (!expected) {
    // Text formats don't have magic bytes - verify they're valid UTF-8
    if (mimeType.startsWith("text/") || mimeType === "application/xml") {
      try {
        const decoder = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: false,
        });
        decoder.decode(content.slice(0, 1024));
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  const header = new Uint8Array(content.slice(0, expected.length));
  return expected.every((byte, i) => header[i] === byte);
}

/**
 * Validate an uploaded file for security and type constraints.
 */
export function validateFile(
  filename: string,
  mimeType: string,
  size: number,
  content?: ArrayBuffer
): { valid: boolean; error?: string } {
  // Check filename is safe
  const { safe, error } = sanitizeFilename(filename);
  if (error) {
    return { valid: false, error };
  }

  // Check file size (25MB limit)
  if (size > KB_CONFIG.MAX_FILE_SIZE) {
    return { valid: false, error: "File exceeds 25MB limit" };
  }

  // Check MIME type is allowed
  const expectedExt = ALLOWED_FILE_TYPES.get(mimeType);
  if (!expectedExt) {
    return { valid: false, error: `Unsupported file type: ${mimeType}` };
  }

  // Verify extension matches MIME type
  const actualExt = safe.toLowerCase().slice(safe.lastIndexOf("."));
  if (actualExt !== expectedExt) {
    return {
      valid: false,
      error: `Extension mismatch: expected ${expectedExt}`,
    };
  }

  // Verify MIME type via magic bytes if content provided
  if (content && !verifyMagicBytes(content, mimeType)) {
    return { valid: false, error: "File content does not match declared type" };
  }

  return { valid: true };
}

/**
 * Extract text from a file using Workers AI.
 * Plain text and markdown are passed through directly.
 */
async function extractText(
  ai: Ai,
  content: ArrayBuffer,
  mimeType: string,
  filename: string
): Promise<string> {
  // Plain text formats don't need AI extraction
  if (mimeType === "text/markdown" || mimeType === "text/plain") {
    return new TextDecoder().decode(content);
  }

  // Use Workers AI to convert document to markdown
  const blob = new Blob([content], { type: mimeType });
  const results = await ai.toMarkdown([{ name: filename, blob }]);

  if (results[0].format === "error") {
    throw new Error(`Failed to extract text: ${results[0].error}`);
  }

  if (!results[0].data) {
    throw new Error(`No content extracted from ${filename}`);
  }

  return results[0].data;
}

interface UploadResult {
  success: boolean;
  fileId?: string;
  error?: string;
  chunksCreated?: number;
}

/**
 * Upload and process an org context document.
 *
 * 1. Validates the file
 * 2. Stores original in R2
 * 3. Extracts text and chunks it
 * 4. Stores chunks in D1
 * 5. Generates embeddings and indexes in Vectorize
 */
export async function uploadOrgContext(
  env: Env,
  orgId: string,
  filename: string,
  mimeType: string,
  content: ArrayBuffer,
  userId?: string
): Promise<UploadResult> {
  // Validate the file first
  const validation = validateFile(
    filename,
    mimeType,
    content.byteLength,
    content
  );
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const fileId = crypto.randomUUID();

  try {
    // Store the original file in R2
    await env.R2.put(R2Paths.orgDoc(orgId, fileId), content, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename },
    });

    // Extract text and chunk it
    const text = await extractText(env.AI, content, mimeType, filename);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      throw new Error("No content extracted from file");
    }

    // Generate embeddings for all chunks
    const embeddings = await generateEmbeddings(env.AI, chunks);

    // Store chunks in D1
    const insertQuery = `
      INSERT INTO org_context_chunks (id, org_id, file_id, content, source, chunk_index, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const insertStmt = env.DB.prepare(insertQuery);

    await env.DB.batch(
      chunks.map((chunk, index) =>
        insertStmt.bind(
          `${orgId}_${fileId}_${index}`,
          orgId,
          fileId,
          chunk,
          filename,
          index,
          userId ?? null
        )
      )
    );

    // Index embeddings in Vectorize
    const vectors = chunks.map((_, index) => ({
      id: `${orgId}_${fileId}_${index}`,
      values: embeddings[index],
      metadata: {
        type: "org",
        org_id: orgId,
        source: filename,
      },
    }));

    // Upsert in batches to respect Vectorize limits
    for (let i = 0; i < vectors.length; i += KB_CONFIG.VECTORIZE_BATCH_SIZE) {
      const batch = vectors.slice(i, i + KB_CONFIG.VECTORIZE_BATCH_SIZE);
      await env.VECTORIZE.upsert(batch);
    }

    return {
      success: true,
      fileId,
      chunksCreated: chunks.length,
    };
  } catch (error) {
    // Clean up the R2 file if anything fails
    await env.R2.delete(R2Paths.orgDoc(orgId, fileId));

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Delete an org context document and all its associated data.
 */
export async function deleteOrgContext(
  env: Env,
  orgId: string,
  fileId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Find all chunk IDs for this file
    const chunks = await env.DB.prepare(
      "SELECT id FROM org_context_chunks WHERE org_id = ? AND file_id = ?"
    )
      .bind(orgId, fileId)
      .all<{ id: string }>();

    // Delete from Vectorize in batches
    if (chunks.results.length > 0) {
      const ids = chunks.results.map((row) => row.id);

      for (let i = 0; i < ids.length; i += KB_CONFIG.VECTORIZE_BATCH_SIZE) {
        const batch = ids.slice(i, i + KB_CONFIG.VECTORIZE_BATCH_SIZE);
        await env.VECTORIZE.deleteByIds(batch);
      }
    }

    // Delete from D1
    await env.DB.prepare(
      "DELETE FROM org_context_chunks WHERE org_id = ? AND file_id = ?"
    )
      .bind(orgId, fileId)
      .run();

    // Delete from R2
    await env.R2.delete(R2Paths.orgDoc(orgId, fileId));

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List all context documents for an org.
 */
export async function listOrgContext(
  env: Env,
  orgId: string
): Promise<Array<{ fileId: string; source: string; chunkCount: number }>> {
  const query = `
    SELECT file_id, source, COUNT(*) as chunk_count
    FROM org_context_chunks
    WHERE org_id = ?
    GROUP BY file_id, source
  `;

  const result = await env.DB.prepare(query)
    .bind(orgId)
    .all<{ file_id: string; source: string; chunk_count: number }>();

  return result.results.map((row) => ({
    fileId: row.file_id,
    source: row.source,
    chunkCount: row.chunk_count,
  }));
}
