/**
 * File Validation Utilities
 *
 * Client-side validation for file uploads before sending to the API.
 * The API performs additional server-side validation (magic bytes, etc.)
 */

// Allowed MIME types for document upload
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.apple.numbers",
  "application/xml",
  "text/markdown",
  "text/plain",
  "text/html",
  "text/csv",
  "text/xml",
] as const;

// Maximum file size: 25MB
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Dangerous extensions that should be blocked
const DANGEROUS_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".ps1",
  ".scr",
  ".vbs",
  ".wsf",
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
]);

// Valid extensions that could appear as double extensions
const DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".odt",
  ".ods",
  ".numbers",
  ".md",
  ".txt",
  ".html",
  ".csv",
  ".xml",
]);

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a file for upload.
 *
 * @param file - The File object to validate
 * @returns ValidationResult with valid flag and optional error
 */
export function validateFile(file: File): ValidationResult {
  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.type || "unknown"}`,
    };
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File exceeds 25MB limit (${formatFileSize(file.size)})`,
    };
  }

  // Validate filename
  const filenameResult = sanitizeFilename(file.name);
  if (filenameResult.error) {
    return { valid: false, error: filenameResult.error };
  }

  return { valid: true };
}

/**
 * Sanitizes a filename and checks for security issues.
 *
 * @param filename - The original filename
 * @returns Object with sanitized filename or error
 */
export function sanitizeFilename(filename: string): {
  sanitized: string;
  error?: string;
} {
  // Strip control characters
  let cleaned = filename.replace(/[\x00-\x1f\x7f]/g, "");

  // Remove special characters (keep alphanumeric, dots, hyphens, underscores)
  cleaned = cleaned.replace(/[^a-zA-Z0-9.\-_\s]/g, "_");

  // Collapse multiple underscores/spaces
  cleaned = cleaned.replace(/[_\s]+/g, "_");

  // Truncate to 255 characters
  if (cleaned.length > 255) {
    const ext = getExtension(cleaned);
    const maxBase = 255 - ext.length;
    cleaned = cleaned.slice(0, maxBase) + ext;
  }

  // Check for path traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return { sanitized: "", error: "Invalid filename: path traversal detected" };
  }

  // Check for Windows reserved names
  const baseName = cleaned.split(".")[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName)) {
    return { sanitized: "", error: "Invalid filename: reserved name" };
  }

  // Check for hidden files
  if (cleaned.startsWith(".")) {
    return { sanitized: "", error: "Invalid filename: hidden files not allowed" };
  }

  // Check for double extensions (e.g., file.pdf.exe or file.exe.pdf)
  const parts = cleaned.toLowerCase().split(".");
  if (parts.length > 2) {
    for (let i = 1; i < parts.length - 1; i++) {
      const middleExt = "." + parts[i];
      if (DOCUMENT_EXTENSIONS.has(middleExt) || DANGEROUS_EXTENSIONS.has(middleExt)) {
        return { sanitized: "", error: "Invalid filename: double extensions not allowed" };
      }
    }
  }

  // Check for dangerous extensions
  const lowerFilename = cleaned.toLowerCase();
  for (const ext of DANGEROUS_EXTENSIONS) {
    if (lowerFilename.endsWith(ext)) {
      return { sanitized: "", error: "Invalid filename: dangerous extension" };
    }
  }

  return { sanitized: cleaned };
}

/**
 * Gets the file extension from a filename.
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.slice(lastDot) : "";
}

/**
 * Formats file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
