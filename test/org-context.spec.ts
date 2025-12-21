import { describe, it, expect } from "vitest";
import { validateFile } from "../src/services/org-context";

describe("validateFile", () => {
  // ==========================================================================
  // Valid Files
  // ==========================================================================

  describe("valid file types", () => {
    it("accepts valid PDF", () => {
      const result = validateFile("document.pdf", "application/pdf", 1000);

      expect(result.valid).toBe(true);
    });

    it("accepts valid DOCX", () => {
      const mimeType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const result = validateFile("doc.docx", mimeType, 1000);

      expect(result.valid).toBe(true);
    });

    it("accepts valid XLSX", () => {
      const mimeType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const result = validateFile("sheet.xlsx", mimeType, 1000);

      expect(result.valid).toBe(true);
    });

    it("accepts valid markdown", () => {
      const result = validateFile("readme.md", "text/markdown", 500);

      expect(result.valid).toBe(true);
    });

    it("accepts valid CSV", () => {
      const result = validateFile("data.csv", "text/csv", 500);

      expect(result.valid).toBe(true);
    });

    it("accepts files at exactly 25MB", () => {
      const exactLimit = 25 * 1024 * 1024;
      const result = validateFile("exact.pdf", "application/pdf", exactLimit);

      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // File Size Limits
  // ==========================================================================

  describe("file size validation", () => {
    it("rejects files over 25MB", () => {
      const overLimit = 30 * 1024 * 1024;
      const result = validateFile("large.pdf", "application/pdf", overLimit);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("25MB");
    });
  });

  // ==========================================================================
  // File Type Validation
  // ==========================================================================

  describe("file type validation", () => {
    it("rejects unsupported file types", () => {
      const result = validateFile("script.js", "application/javascript", 1000);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported");
    });

    it("rejects extension mismatch", () => {
      // File claims to be PDF but has .txt extension
      const result = validateFile("document.txt", "application/pdf", 1000);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("mismatch");
    });
  });

  // ==========================================================================
  // Path Traversal Prevention
  // ==========================================================================

  describe("path traversal prevention", () => {
    it("rejects path traversal with ..", () => {
      const result = validateFile("../../../etc/passwd", "text/plain", 100);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid filename");
    });

    it("rejects path traversal with forward slash", () => {
      const result = validateFile("foo/bar.txt", "text/plain", 100);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid filename");
    });

    it("rejects path traversal with backslash", () => {
      const result = validateFile("foo\\bar.txt", "text/plain", 100);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid filename");
    });
  });
});
