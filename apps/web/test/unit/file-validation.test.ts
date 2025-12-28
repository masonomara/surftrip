import { describe, it, expect } from "vitest";
import {
  validateFile,
  sanitizeFilename,
  formatFileSize,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
} from "~/lib/file-validation";

/**
 * Helper to create a mock File object
 */
function createMockFile(
  name: string,
  size: number,
  type: string
): File {
  const blob = new Blob(["x".repeat(Math.min(size, 100))], { type });
  Object.defineProperty(blob, "size", { value: size });
  Object.defineProperty(blob, "name", { value: name });
  return blob as File;
}

// ============================================================
// File Validation Tests
// ============================================================

describe("validateFile", () => {
  describe("valid files", () => {
    it("accepts valid PDF", () => {
      const file = createMockFile("document.pdf", 1000, "application/pdf");
      const result = validateFile(file);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("accepts valid DOCX", () => {
      const file = createMockFile(
        "report.docx",
        5000,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it("accepts valid XLSX", () => {
      const file = createMockFile(
        "data.xlsx",
        10000,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it("accepts valid Markdown", () => {
      const file = createMockFile("notes.md", 500, "text/markdown");
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it("accepts valid plain text", () => {
      const file = createMockFile("readme.txt", 200, "text/plain");
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it("accepts valid CSV", () => {
      const file = createMockFile("data.csv", 1500, "text/csv");
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it("accepts file at exactly 25MB", () => {
      const file = createMockFile("large.pdf", MAX_FILE_SIZE, "application/pdf");
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });
  });

  describe("rejects unsupported file types", () => {
    it("rejects executable files", () => {
      const file = createMockFile("program.exe", 1000, "application/x-msdownload");
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("rejects JavaScript files", () => {
      const file = createMockFile("script.js", 500, "application/javascript");
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("rejects image files", () => {
      const file = createMockFile("photo.jpg", 2000, "image/jpeg");
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("rejects files with empty MIME type", () => {
      const file = createMockFile("mystery", 1000, "");
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("rejects ZIP files", () => {
      const file = createMockFile("archive.zip", 5000, "application/zip");
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });
  });

  describe("rejects files over 25MB", () => {
    it("rejects file 1 byte over limit", () => {
      const file = createMockFile("huge.pdf", MAX_FILE_SIZE + 1, "application/pdf");
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds 25MB limit");
    });

    it("rejects 50MB file", () => {
      const file = createMockFile("massive.docx", 50 * 1024 * 1024,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds 25MB limit");
    });

    it("rejects 100MB file", () => {
      const file = createMockFile("giant.pdf", 100 * 1024 * 1024, "application/pdf");
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds 25MB limit");
    });
  });
});

// ============================================================
// Filename Sanitization Tests
// ============================================================

describe("sanitizeFilename", () => {
  describe("removes special characters", () => {
    it("replaces unicode characters with underscores", () => {
      const result = sanitizeFilename("document\u00A9.pdf");
      expect(result.sanitized).toBe("document_.pdf");
      expect(result.error).toBeUndefined();
    });

    it("replaces brackets and parentheses", () => {
      const result = sanitizeFilename("file[1](2).pdf");
      expect(result.sanitized).toBe("file_1_2_.pdf");
    });

    it("replaces ampersand and other symbols", () => {
      const result = sanitizeFilename("Tom & Jerry's File!.pdf");
      expect(result.sanitized).toBe("Tom_Jerry_s_File_.pdf");
    });

    it("removes control characters", () => {
      const result = sanitizeFilename("file\x00\x1f\x7fname.pdf");
      expect(result.sanitized).not.toContain("\x00");
      expect(result.sanitized).not.toContain("\x1f");
      expect(result.sanitized).not.toContain("\x7f");
    });

    it("collapses multiple underscores", () => {
      const result = sanitizeFilename("file___name.pdf");
      expect(result.sanitized).toBe("file_name.pdf");
    });
  });

  describe("prevents path traversal", () => {
    it("rejects double dot sequences", () => {
      const result = sanitizeFilename("../etc/passwd");
      expect(result.error).toBe("Invalid filename: path traversal detected");
    });

    it("rejects forward slashes", () => {
      const result = sanitizeFilename("path/to/file.pdf");
      expect(result.error).toBe("Invalid filename: path traversal detected");
    });

    it("rejects backslashes", () => {
      const result = sanitizeFilename("path\\to\\file.pdf");
      expect(result.error).toBe("Invalid filename: path traversal detected");
    });

    it("rejects hidden traversal attempts", () => {
      const result = sanitizeFilename("..\\..\\secret.pdf");
      expect(result.error).toBe("Invalid filename: path traversal detected");
    });
  });

  describe("removes double extensions", () => {
    it("rejects file.pdf.exe", () => {
      const result = sanitizeFilename("document.pdf.exe");
      expect(result.error).toBe("Invalid filename: double extensions not allowed");
    });

    it("rejects file.exe.pdf", () => {
      const result = sanitizeFilename("malware.exe.pdf");
      expect(result.error).toBe("Invalid filename: double extensions not allowed");
    });

    it("rejects file.docx.js", () => {
      const result = sanitizeFilename("report.docx.js");
      expect(result.error).toBe("Invalid filename: double extensions not allowed");
    });

    it("allows simple valid extensions", () => {
      const result = sanitizeFilename("report.pdf");
      expect(result.error).toBeUndefined();
      expect(result.sanitized).toBe("report.pdf");
    });

    it("allows dots in filename body", () => {
      const result = sanitizeFilename("v1.2.3.pdf");
      expect(result.error).toBeUndefined();
      expect(result.sanitized).toBe("v1.2.3.pdf");
    });
  });

  describe("truncates long filenames", () => {
    it("truncates filename over 255 characters", () => {
      const longName = "a".repeat(300) + ".pdf";
      const result = sanitizeFilename(longName);
      expect(result.sanitized.length).toBeLessThanOrEqual(255);
    });

    it("preserves extension when truncating", () => {
      const longName = "a".repeat(300) + ".pdf";
      const result = sanitizeFilename(longName);
      expect(result.sanitized).toMatch(/\.pdf$/);
    });

    it("accepts filename at exactly 255 characters", () => {
      const exactName = "a".repeat(251) + ".pdf";
      expect(exactName.length).toBe(255);
      const result = sanitizeFilename(exactName);
      expect(result.error).toBeUndefined();
      expect(result.sanitized.length).toBe(255);
    });
  });

  describe("blocks dangerous extensions", () => {
    it("rejects .exe files", () => {
      const result = sanitizeFilename("program.exe");
      expect(result.error).toBe("Invalid filename: dangerous extension");
    });

    it("rejects .sh files", () => {
      const result = sanitizeFilename("script.sh");
      expect(result.error).toBe("Invalid filename: dangerous extension");
    });

    it("rejects .php files", () => {
      const result = sanitizeFilename("backdoor.php");
      expect(result.error).toBe("Invalid filename: dangerous extension");
    });
  });

  describe("blocks Windows reserved names", () => {
    it("rejects CON", () => {
      const result = sanitizeFilename("CON.pdf");
      expect(result.error).toBe("Invalid filename: reserved name");
    });

    it("rejects PRN", () => {
      const result = sanitizeFilename("prn.txt");
      expect(result.error).toBe("Invalid filename: reserved name");
    });

    it("rejects NUL", () => {
      const result = sanitizeFilename("NUL.docx");
      expect(result.error).toBe("Invalid filename: reserved name");
    });

    it("rejects COM1", () => {
      const result = sanitizeFilename("COM1.pdf");
      expect(result.error).toBe("Invalid filename: reserved name");
    });

    it("rejects LPT1", () => {
      const result = sanitizeFilename("LPT1.pdf");
      expect(result.error).toBe("Invalid filename: reserved name");
    });
  });

  describe("blocks hidden files", () => {
    it("rejects files starting with dot", () => {
      const result = sanitizeFilename(".htaccess");
      expect(result.error).toBe("Invalid filename: hidden files not allowed");
    });

    it("rejects .gitignore", () => {
      const result = sanitizeFilename(".gitignore");
      expect(result.error).toBe("Invalid filename: hidden files not allowed");
    });
  });
});

// ============================================================
// Format File Size Tests
// ============================================================

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("formats exactly 1 KB", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("formats exactly 1 MB", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
  });
});

// ============================================================
// Constants Tests
// ============================================================

describe("constants", () => {
  it("MAX_FILE_SIZE is 25MB", () => {
    expect(MAX_FILE_SIZE).toBe(25 * 1024 * 1024);
  });

  it("ALLOWED_MIME_TYPES includes common document types", () => {
    expect(ALLOWED_MIME_TYPES).toContain("application/pdf");
    expect(ALLOWED_MIME_TYPES).toContain("text/plain");
    expect(ALLOWED_MIME_TYPES).toContain("text/markdown");
    expect(ALLOWED_MIME_TYPES).toContain("text/csv");
  });

  it("ALLOWED_MIME_TYPES includes Office formats", () => {
    expect(ALLOWED_MIME_TYPES).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(ALLOWED_MIME_TYPES).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });
});
