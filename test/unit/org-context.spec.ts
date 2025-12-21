import { describe, it, expect } from "vitest";
import { validateFile } from "../../src/services/org-context";

describe("validateFile", () => {
  describe("valid files", () => {
    it("accepts valid PDF", () => {
      const result = validateFile("document.pdf", "application/pdf", 1000);

      expect(result.valid).toBe(true);
    });

    it("accepts valid DOCX", () => {
      const result = validateFile(
        "doc.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        1000
      );

      expect(result.valid).toBe(true);
    });

    it("accepts valid XLSX", () => {
      const result = validateFile(
        "sheet.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        1000
      );

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
      const result = validateFile(
        "exact.pdf",
        "application/pdf",
        25 * 1024 * 1024
      );

      expect(result.valid).toBe(true);
    });
  });

  describe("file size validation", () => {
    it("rejects files over 25MB", () => {
      const result = validateFile(
        "large.pdf",
        "application/pdf",
        30 * 1024 * 1024
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("25MB");
    });
  });

  describe("file type validation", () => {
    it("rejects unsupported MIME types", () => {
      const result = validateFile("script.js", "application/javascript", 1000);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported");
    });

    it("rejects when extension doesn't match MIME type", () => {
      const result = validateFile("document.txt", "application/pdf", 1000);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("mismatch");
    });
  });

  describe("path traversal protection", () => {
    it("rejects .. sequences", () => {
      const result = validateFile("../../../etc/passwd", "text/plain", 100);

      expect(result.error).toContain("path traversal");
    });

    it("rejects forward slashes", () => {
      const result = validateFile("foo/bar.txt", "text/plain", 100);

      expect(result.error).toContain("path traversal");
    });

    it("rejects backslashes", () => {
      const result = validateFile("foo\\bar.txt", "text/plain", 100);

      expect(result.error).toContain("path traversal");
    });
  });

  describe("Windows reserved name protection", () => {
    it("rejects CON", () => {
      const result = validateFile("CON.txt", "text/plain", 100);

      expect(result.error).toContain("reserved name");
    });

    it("rejects NUL", () => {
      const result = validateFile("NUL.pdf", "application/pdf", 100);

      expect(result.error).toContain("reserved name");
    });

    it("rejects COM1 (case insensitive)", () => {
      const result = validateFile("com1.txt", "text/plain", 100);

      expect(result.error).toContain("reserved name");
    });

    it("rejects LPT1", () => {
      const result = validateFile("LPT1.md", "text/markdown", 100);

      expect(result.error).toContain("reserved name");
    });
  });

  describe("hidden files protection", () => {
    it("rejects files starting with dot", () => {
      const result = validateFile(".htaccess", "text/plain", 100);

      expect(result.error).toContain("hidden files");
    });

    it("rejects .env files", () => {
      const result = validateFile(".env", "text/plain", 100);

      expect(result.error).toContain("hidden files");
    });
  });

  describe("control character handling", () => {
    it("strips null bytes and still validates", () => {
      const result = validateFile("doc\x00ument.pdf", "application/pdf", 100);

      expect(result.valid).toBe(true);
    });

    it("strips other control chars and still validates", () => {
      const result = validateFile("doc\x1fument.pdf", "application/pdf", 100);

      expect(result.valid).toBe(true);
    });
  });
});
