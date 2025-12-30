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
      const result = validateFile("image.png", "image/png", 1000);

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

  describe("filename length validation", () => {
    it("rejects filenames over 255 characters", () => {
      const longName = "a".repeat(252) + ".pdf";
      const result = validateFile(longName, "application/pdf", 100);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("255");
    });

    it("accepts filenames at exactly 255 characters", () => {
      const maxName = "a".repeat(251) + ".pdf";
      const result = validateFile(maxName, "application/pdf", 100);

      expect(result.valid).toBe(true);
    });
  });

  describe("double extension protection", () => {
    it("rejects double extensions with document type first", () => {
      const result = validateFile("invoice.pdf.html", "text/html", 100);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("double extensions");
    });

    it("rejects dangerous extensions anywhere in filename", () => {
      const result = validateFile("script.exe.pdf", "application/pdf", 100);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("dangerous extension");
    });

    it("accepts legitimate multi-part filenames", () => {
      const result = validateFile("report.2024.final.pdf", "application/pdf", 100);

      expect(result.valid).toBe(true);
    });
  });

  describe("magic bytes validation", () => {
    it("rejects PDF with wrong magic bytes", () => {
      const fakeContent = new TextEncoder().encode("not a pdf file").buffer;
      const result = validateFile("fake.pdf", "application/pdf", 100, fakeContent);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("does not match");
    });

    it("accepts PDF with correct magic bytes", () => {
      const pdfContent = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
      const result = validateFile("real.pdf", "application/pdf", 100, pdfContent);

      expect(result.valid).toBe(true);
    });

    it("validates text files as UTF-8", () => {
      const validText = new TextEncoder().encode("Hello world").buffer;
      const result = validateFile("notes.txt", "text/plain", 100, validText);

      expect(result.valid).toBe(true);
    });
  });
});
