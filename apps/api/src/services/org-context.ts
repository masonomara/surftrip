/**
 * Org Context Service
 *
 * Handles file uploads for organization-specific context documents.
 * These are firm documents (policies, procedures, templates) that get
 * chunked and indexed for RAG retrieval during chat conversations.
 *
 * Security features:
 * - Validates MIME types against an allowlist
 * - Verifies file magic bytes match declared type
 * - Sanitizes filenames to prevent path traversal
 * - Blocks dangerous file extensions
 */

import { Env } from "../types/env";
import { KB_CONFIG } from "../config/kb";
import { R2Paths } from "../storage/r2-paths";
import { chunkText, generateEmbeddings } from "./kb-builder";
import { createLogger, type Logger } from "../lib/logger";

// ============================================================
// Allowed MIME Types
// ============================================================

/**
 * Map of allowed MIME types to their expected file extensions.
 * We only accept document formats that can be safely processed.
 */
const ALLOWED_TYPES: Map<string, string> = new Map([
  // PDF
  ["application/pdf", ".pdf"],

  // Microsoft Office
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

  // Open Document formats
  ["application/vnd.oasis.opendocument.text", ".odt"],
  ["application/vnd.oasis.opendocument.spreadsheet", ".ods"],

  // Apple formats
  ["application/vnd.apple.numbers", ".numbers"],

  // Plain text formats
  ["text/markdown", ".md"],
  ["text/plain", ".txt"],
  ["text/html", ".html"],
  ["text/csv", ".csv"],
  ["application/xml", ".xml"],
  ["text/xml", ".xml"],
]);

// ============================================================
// Magic Bytes Verification
// ============================================================

/**
 * Magic bytes (file signatures) for binary file formats.
 * Used to verify the file content matches the declared MIME type.
 *
 * PDF files start with "%PDF" (0x25 0x50 0x44 0x46)
 * ZIP-based formats (Office, ODF) start with PK (0x50 0x4B 0x03 0x04)
 */
const MAGIC_BYTES: Map<string, Uint8Array> = new Map([
  // PDF signature
  ["application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46])],

  // ZIP-based formats (Office XML, ODF, Numbers)
  ...[
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.apple.numbers",
  ].map((type) => [type, new Uint8Array([0x50, 0x4b, 0x03, 0x04])] as const),
]);

// ============================================================
// Dangerous Extensions
// ============================================================

/**
 * File extensions that could be executable or dangerous.
 * These are blocked even if the MIME type looks safe.
 */
const DANGEROUS_EXTENSIONS = new Set([
  // Windows executables
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".ps1",
  ".scr",
  ".vbs",
  ".wsf",

  // Unix scripts
  ".sh",

  // Web scripts
  ".php",
  ".jsp",
  ".asp",
  ".aspx",
  ".cgi",

  // Scripting languages
  ".pl",
  ".py",
  ".rb",
  ".js",
]);

// ============================================================
// Filename Sanitization
// ============================================================

/**
 * Sanitizes a filename to prevent path traversal and other attacks.
 *
 * Checks for:
 * - Control characters
 * - Path traversal attempts (.. / \)
 * - Windows reserved names (CON, PRN, NUL, etc.)
 * - Hidden files (starting with .)
 * - Double extensions (file.exe.pdf)
 * - Dangerous extensions anywhere in the name
 *
 * @param filename - The original filename
 * @returns Object with either the safe filename or an error message
 */
function sanitizeFilename(filename: string): { safe: string; error?: string } {
  // Normalize unicode and strip control characters
  const cleaned = filename.normalize("NFC").replace(/[\x00-\x1f\x7f]/g, "");

  // Check length
  if (cleaned.length > 255) {
    return { safe: "", error: "Filename exceeds 255 characters" };
  }

  // Block path traversal attempts
  if (
    cleaned.includes("..") ||
    cleaned.includes("/") ||
    cleaned.includes("\\")
  ) {
    return { safe: "", error: "Invalid filename: path traversal detected" };
  }

  // Block Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const baseName = cleaned.split(".")[0];
  const isReservedName = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(
    baseName
  );

  if (isReservedName) {
    return { safe: "", error: "Invalid filename: reserved name" };
  }

  // Block hidden files
  if (cleaned.startsWith(".")) {
    return { safe: "", error: "Invalid filename: hidden files not allowed" };
  }

  // Block double extensions (file.exe.pdf)
  const parts = cleaned.toLowerCase().split(".");

  if (parts.length > 2) {
    const allowedExtensions = new Set(ALLOWED_TYPES.values());

    for (let i = 1; i < parts.length - 1; i++) {
      const middleExtension = "." + parts[i];

      if (allowedExtensions.has(middleExtension)) {
        return {
          safe: "",
          error: "Invalid filename: double extensions not allowed",
        };
      }
    }
  }

  // Block dangerous extensions anywhere in the filename
  const lowerFilename = cleaned.toLowerCase();

  for (const ext of DANGEROUS_EXTENSIONS) {
    if (lowerFilename.includes(ext)) {
      return {
        safe: "",
        error: "Invalid filename: dangerous extension detected",
      };
    }
  }

  return { safe: cleaned };
}

// ============================================================
// File Content Verification
// ============================================================

/**
 * Verifies that file content matches its declared MIME type by checking magic bytes.
 *
 * For text files, validates that the content is valid UTF-8.
 * For binary files, checks that the file signature matches.
 *
 * @param content - The file content as an ArrayBuffer
 * @param mimeType - The declared MIME type
 * @returns true if the content matches the MIME type
 */
function verifyMagicBytes(content: ArrayBuffer, mimeType: string): boolean {
  const expectedMagic = MAGIC_BYTES.get(mimeType);

  // For MIME types without magic bytes (text files), verify it's valid UTF-8
  if (!expectedMagic) {
    if (mimeType.startsWith("text/") || mimeType === "application/xml") {
      try {
        // Try to decode as UTF-8 - will throw if invalid
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
          content.slice(0, 1024)
        );
        return true;
      } catch {
        return false;
      }
    }

    // Unknown binary type without magic bytes - allow it
    return true;
  }

  // Check magic bytes at the start of the file
  const header = new Uint8Array(content.slice(0, expectedMagic.length));
  return expectedMagic.every((byte, index) => header[index] === byte);
}

// ============================================================
// Public Validation Function
// ============================================================

/**
 * Validates a file for upload.
 *
 * Checks:
 * 1. Filename is safe (sanitized)
 * 2. File size is within limits (25MB)
 * 3. MIME type is in the allowlist
 * 4. Extension matches the declared MIME type
 * 5. File content matches the declared MIME type (magic bytes)
 *
 * @param filename - The file's name
 * @param mimeType - The declared MIME type
 * @param size - The file size in bytes
 * @param content - Optional file content for magic byte verification
 * @returns Object indicating validity and any error message
 */
export function validateFile(
  filename: string,
  mimeType: string,
  size: number,
  content?: ArrayBuffer
): { valid: boolean; error?: string } {
  // Validate filename
  const { safe, error: filenameError } = sanitizeFilename(filename);

  if (filenameError) {
    return { valid: false, error: filenameError };
  }

  // Check file size
  if (size > KB_CONFIG.MAX_FILE_SIZE) {
    return { valid: false, error: "File exceeds 25MB limit" };
  }

  // Check MIME type is allowed
  const expectedExtension = ALLOWED_TYPES.get(mimeType);

  if (!expectedExtension) {
    return { valid: false, error: `Unsupported file type: ${mimeType}` };
  }

  // Verify extension matches MIME type
  const actualExtension = safe.toLowerCase().slice(safe.lastIndexOf("."));

  if (actualExtension !== expectedExtension) {
    return {
      valid: false,
      error: `Extension mismatch: expected ${expectedExtension}`,
    };
  }

  // Verify magic bytes if content provided
  if (content && !verifyMagicBytes(content, mimeType)) {
    return { valid: false, error: "File content does not match declared type" };
  }

  return { valid: true };
}

// ============================================================
// Text Extraction
// ============================================================

/**
 * Extracts text content from a file using Workers AI.
 *
 * For plain text/markdown files, returns the content directly.
 * For binary formats (PDF, Office), uses AI.toMarkdown() for conversion.
 *
 * @param ai - Workers AI binding
 * @param content - File content as ArrayBuffer
 * @param mimeType - The file's MIME type
 * @param filename - The file's name (for error messages)
 * @returns Extracted text content
 */
async function extractText(
  ai: Ai,
  content: ArrayBuffer,
  mimeType: string,
  filename: string
): Promise<string> {
  // Plain text files can be decoded directly
  if (mimeType === "text/markdown" || mimeType === "text/plain") {
    return new TextDecoder().decode(content);
  }

  // Use Workers AI to convert binary formats to markdown
  const results = await ai.toMarkdown([
    { name: filename, blob: new Blob([content], { type: mimeType }) },
  ]);

  // Check for extraction errors
  if (results[0].format === "error") {
    throw new Error(`Failed to extract text: ${results[0].error}`);
  }

  if (!results[0].data) {
    throw new Error(`No content extracted from ${filename}`);
  }

  return results[0].data;
}

// ============================================================
// Public Types
// ============================================================

/**
 * Metadata for an organization context document.
 */
export interface OrgContextDocument {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: number;
  chunkCount: number;
}

/**
 * Result of an upload operation.
 */
interface UploadResult {
  success: boolean;
  fileId?: string;
  error?: string;
  chunksCreated?: number;
}

// ============================================================
// Upload Function
// ============================================================

/**
 * Uploads a document to the organization's context.
 *
 * Process:
 * 1. Validate the file (name, type, size, content)
 * 2. Store the original file in R2
 * 3. Extract text content
 * 4. Chunk the text for RAG
 * 5. Generate embeddings for each chunk
 * 6. Store document metadata in D1
 * 7. Store chunks in D1
 * 8. Index embeddings in Vectorize
 *
 * If any step fails, cleans up partial data.
 *
 * @param env - Environment bindings
 * @param orgId - Organization ID
 * @param filename - Original filename
 * @param mimeType - File MIME type
 * @param content - File content
 * @param userId - ID of user performing upload
 * @param parentLog - Optional parent logger
 * @returns Upload result with fileId and chunk count on success
 */
export async function uploadOrgContext(
  env: Env,
  orgId: string,
  filename: string,
  mimeType: string,
  content: ArrayBuffer,
  userId?: string,
  parentLog?: Logger
): Promise<UploadResult> {
  const log =
    parentLog?.child({ service: "orgContext" }) ??
    createLogger({ service: "orgContext" });

  // Step 1: Validate the file
  const validation = validateFile(
    filename,
    mimeType,
    content.byteLength,
    content
  );

  if (!validation.valid) {
    log.warn("Validation failed", { error: validation.error });
    return { success: false, error: validation.error };
  }

  const fileId = crypto.randomUUID();

  try {
    // Step 2: Store original file in R2
    await env.R2.put(R2Paths.orgDoc(orgId, fileId), content, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename },
    });

    // Step 3: Extract text content
    const text = await extractText(env.AI, content, mimeType, filename);

    // Step 4: Chunk the text
    const chunks = chunkText(text);

    if (!chunks.length) {
      throw new Error("No content extracted from file");
    }

    // Step 5: Generate embeddings
    const embeddings = await generateEmbeddings(env.AI, chunks);

    // Step 6: Store document metadata
    await env.DB.prepare(
      `INSERT INTO org_context_documents (id, org_id, filename, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        fileId,
        orgId,
        filename,
        mimeType,
        content.byteLength,
        userId ?? null
      )
      .run();

    // Step 7: Store chunks
    // Use a shortened file ID for chunk IDs to keep them reasonable length
    const shortFileId = fileId.replace(/-/g, "");

    const insertChunk = env.DB.prepare(
      `INSERT INTO org_context_chunks (id, org_id, file_id, content, source, chunk_index, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const chunkInserts = chunks.map((chunk, index) =>
      insertChunk.bind(
        `${shortFileId}_${index}`,
        orgId,
        fileId,
        chunk,
        filename,
        index,
        userId ?? null
      )
    );

    await env.DB.batch(chunkInserts);

    // Step 8: Index embeddings in Vectorize
    const vectors = chunks.map((_, index) => ({
      id: `${shortFileId}_${index}`,
      values: embeddings[index],
      metadata: { type: "org", org_id: orgId, source: filename },
    }));

    // Upsert in batches
    for (let i = 0; i < vectors.length; i += KB_CONFIG.VECTORIZE_BATCH_SIZE) {
      const batch = vectors.slice(i, i + KB_CONFIG.VECTORIZE_BATCH_SIZE);
      await env.VECTORIZE.upsert(batch);
    }

    log.info("Upload complete", { fileId, chunksCreated: chunks.length });
    return { success: true, fileId, chunksCreated: chunks.length };
  } catch (error) {
    // Clean up the R2 file if anything failed
    log.error("Upload failed", { error });
    await env.R2.delete(R2Paths.orgDoc(orgId, fileId));

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// Delete Function
// ============================================================

/**
 * Deletes a document and all associated data.
 *
 * Removes:
 * - Vector embeddings from Vectorize
 * - Chunks from D1
 * - Document metadata from D1
 * - Original file from R2
 *
 * @param env - Environment bindings
 * @param orgId - Organization ID
 * @param fileId - Document ID to delete
 * @returns Result indicating success or error
 */
export async function deleteOrgContext(
  env: Env,
  orgId: string,
  fileId: string
): Promise<{ success: boolean; error?: string }> {
  const log = createLogger({ service: "orgContext", orgId, fileId });

  try {
    // Get chunk IDs to delete from Vectorize
    const chunks = await env.DB.prepare(
      "SELECT id FROM org_context_chunks WHERE org_id = ? AND file_id = ?"
    )
      .bind(orgId, fileId)
      .all<{ id: string }>();

    // Delete from Vectorize in batches
    if (chunks.results.length > 0) {
      const chunkIds = chunks.results.map((row) => row.id);

      for (
        let i = 0;
        i < chunkIds.length;
        i += KB_CONFIG.VECTORIZE_BATCH_SIZE
      ) {
        const batch = chunkIds.slice(i, i + KB_CONFIG.VECTORIZE_BATCH_SIZE);
        await env.VECTORIZE.deleteByIds(batch);
      }
    }

    // Delete from D1 (chunks and document metadata)
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM org_context_chunks WHERE org_id = ? AND file_id = ?"
      ).bind(orgId, fileId),
      env.DB.prepare(
        "DELETE FROM org_context_documents WHERE id = ? AND org_id = ?"
      ).bind(fileId, orgId),
    ]);

    // Delete from R2
    await env.R2.delete(R2Paths.orgDoc(orgId, fileId));

    log.info("Document deleted");
    return { success: true };
  } catch (error) {
    log.error("Delete failed", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// List & Get Functions
// ============================================================

/**
 * Lists all documents for an organization.
 *
 * @param env - Environment bindings
 * @param orgId - Organization ID
 * @returns Array of document metadata, newest first
 */
export async function listOrgContext(
  env: Env,
  orgId: string
): Promise<OrgContextDocument[]> {
  const query = `
    SELECT
      d.id,
      d.filename,
      d.mime_type,
      d.size,
      d.created_at,
      COUNT(c.id) as chunk_count
    FROM org_context_documents d
    LEFT JOIN org_context_chunks c
      ON c.org_id = d.org_id AND c.file_id = d.id
    WHERE d.org_id = ?
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `;

  const result = await env.DB.prepare(query).bind(orgId).all<{
    id: string;
    filename: string;
    mime_type: string;
    size: number;
    created_at: number;
    chunk_count: number;
  }>();

  return result.results.map((row) => ({
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    uploadedAt: row.created_at,
    chunkCount: row.chunk_count,
  }));
}

/**
 * Gets a single document by ID.
 *
 * @param env - Environment bindings
 * @param orgId - Organization ID
 * @param fileId - Document ID
 * @returns Document metadata or null if not found
 */
export async function getOrgContextDocument(
  env: Env,
  orgId: string,
  fileId: string
): Promise<OrgContextDocument | null> {
  const query = `
    SELECT
      d.id,
      d.filename,
      d.mime_type,
      d.size,
      d.created_at,
      COUNT(c.id) as chunk_count
    FROM org_context_documents d
    LEFT JOIN org_context_chunks c
      ON c.org_id = d.org_id AND c.file_id = d.id
    WHERE d.org_id = ? AND d.id = ?
    GROUP BY d.id
  `;

  const row = await env.DB.prepare(query).bind(orgId, fileId).first<{
    id: string;
    filename: string;
    mime_type: string;
    size: number;
    created_at: number;
    chunk_count: number;
  }>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    uploadedAt: row.created_at,
    chunkCount: row.chunk_count,
  };
}
