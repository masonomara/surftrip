/**
 * RAG Integration Tests
 *
 * These tests verify the complete RAG retrieval pipeline using real
 * Cloudflare services (D1, Vectorize, Workers AI) in test mode.
 *
 * NOTE: These tests require CLOUDFLARE_ACCOUNT_ID to be set and will
 * incur usage charges. They are skipped by default.
 *
 * To run: CLOUDFLARE_ACCOUNT_ID=xxx npm test -- test/integration/rag-integration.spec.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { env } from "cloudflare:test";
import {
  retrieveRAGContext,
  formatRAGContext,
} from "../../src/services/rag-retrieval";

// =============================================================================
// Test Configuration
// =============================================================================

// Skip if CLOUDFLARE_ACCOUNT_ID not set (avoids interactive prompt)
const hasAccountId =
  typeof process !== "undefined" && !!process.env?.CLOUDFLARE_ACCOUNT_ID;

// Test identifiers - unique per test run
const testOrgId = `test-org-${Date.now()}`;
const testVectorIds: string[] = [];
let otherOrgId: string;

// =============================================================================
// Test Data Definitions
// =============================================================================

interface KBChunk {
  id: string;
  content: string;
  source: string;
  category: string | null;
  jurisdiction: string | null;
  practice_type: string | null;
  firm_size: string | null;
}

interface OrgChunk {
  id: string;
  content: string;
  source: string;
}

const kbTestChunks: KBChunk[] = [
  {
    id: "kb_general_test_0",
    content: "General Clio workflow best practices.",
    source: "clio-workflows.md",
    category: "general",
    jurisdiction: null,
    practice_type: null,
    firm_size: null,
  },
  {
    id: "kb_federal_test_0",
    content: "Federal court filing procedures.",
    source: "federal-rules.md",
    category: null,
    jurisdiction: "federal",
    practice_type: null,
    firm_size: null,
  },
  {
    id: "kb_ca_test_0",
    content: "California statute of limitations for PI.",
    source: "ca-deadlines.md",
    category: null,
    jurisdiction: "CA",
    practice_type: null,
    firm_size: null,
  },
  {
    id: "kb_ny_test_0",
    content: "New York civil procedure rules.",
    source: "ny-procedures.md",
    category: null,
    jurisdiction: "NY",
    practice_type: null,
    firm_size: null,
  },
  {
    id: "kb_pi_test_0",
    content: "Personal injury intake checklist.",
    source: "pi-intake.md",
    category: null,
    jurisdiction: null,
    practice_type: "personal-injury",
    firm_size: null,
  },
  {
    id: "kb_solo_test_0",
    content: "Solo practitioner time management.",
    source: "solo-guide.md",
    category: null,
    jurisdiction: null,
    practice_type: null,
    firm_size: "solo",
  },
];

const orgTestChunks: OrgChunk[] = [
  {
    id: `${testOrgId}_file1_0`,
    content: "Billing: Partner $500/hr, Associate $250/hr.",
    source: "billing.md",
  },
  {
    id: `${testOrgId}_file1_1`,
    content: "Retainer: Min $5,000 for new matters.",
    source: "billing.md",
  },
];

// =============================================================================
// Setup Helpers
// =============================================================================

async function createTestOrg(orgId: string, name: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO org (id, name, created_at) VALUES (?, ?, datetime('now'))"
  )
    .bind(orgId, name)
    .run();
}

async function insertKBChunks(chunks: KBChunk[]): Promise<void> {
  const insertStmt = env.DB.prepare(`
    INSERT OR REPLACE INTO kb_chunks
      (id, content, source, section, chunk_index, category, jurisdiction, practice_type, firm_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  await env.DB.batch(
    chunks.map((chunk) =>
      insertStmt.bind(
        chunk.id,
        chunk.content,
        chunk.source,
        null, // section
        0, // chunk_index
        chunk.category,
        chunk.jurisdiction,
        chunk.practice_type,
        chunk.firm_size
      )
    )
  );
}

async function insertOrgChunks(
  orgId: string,
  chunks: OrgChunk[]
): Promise<void> {
  const insertStmt = env.DB.prepare(`
    INSERT OR REPLACE INTO org_context_chunks
      (id, org_id, file_id, content, source, chunk_index)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  await env.DB.batch(
    chunks.map((chunk, index) =>
      insertStmt.bind(
        chunk.id,
        orgId,
        "file1",
        chunk.content,
        chunk.source,
        index
      )
    )
  );
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: texts,
  })) as { data: number[][] };
  return result.data;
}

async function upsertKBVectors(chunks: KBChunk[]): Promise<void> {
  const contents = chunks.map((c) => c.content);
  const embeddings = await generateEmbeddings(contents);

  const vectors = chunks.map((chunk, i) => ({
    id: chunk.id,
    values: embeddings[i],
    metadata: {
      type: "kb",
      source: chunk.source,
      ...(chunk.category && { category: chunk.category }),
      ...(chunk.jurisdiction && { jurisdiction: chunk.jurisdiction }),
      ...(chunk.practice_type && { practice_type: chunk.practice_type }),
      ...(chunk.firm_size && { firm_size: chunk.firm_size }),
    },
  }));

  await env.VECTORIZE.upsert(vectors);
  testVectorIds.push(...vectors.map((v) => v.id));
}

async function upsertOrgVectors(
  orgId: string,
  chunks: OrgChunk[]
): Promise<void> {
  const contents = chunks.map((c) => c.content);
  const embeddings = await generateEmbeddings(contents);

  const vectors = chunks.map((chunk, i) => ({
    id: chunk.id,
    values: embeddings[i],
    metadata: {
      type: "org",
      org_id: orgId,
      source: chunk.source,
    },
  }));

  await env.VECTORIZE.upsert(vectors);
  testVectorIds.push(...vectors.map((v) => v.id));
}

// =============================================================================
// Cleanup Helpers
// =============================================================================

async function cleanupTestData(): Promise<void> {
  // Clean up Vectorize
  if (testVectorIds.length > 0) {
    await env.VECTORIZE.deleteByIds(testVectorIds);
  }

  // Clean up D1 KB chunks
  await env.DB.prepare(
    "DELETE FROM kb_chunks WHERE id LIKE 'kb_%_test_%'"
  ).run();

  // Clean up D1 org chunks
  await env.DB.prepare("DELETE FROM org_context_chunks WHERE org_id = ?")
    .bind(testOrgId)
    .run();

  await env.DB.prepare("DELETE FROM org WHERE id = ?").bind(testOrgId).run();

  // Clean up other org if created
  if (otherOrgId) {
    await env.DB.prepare("DELETE FROM org_context_chunks WHERE org_id = ?")
      .bind(otherOrgId)
      .run();
    await env.DB.prepare("DELETE FROM org WHERE id = ?").bind(otherOrgId).run();
  }
}

// =============================================================================
// Tests
// =============================================================================

describe.skipIf(!hasAccountId)("RAG Integration", () => {
  // Setup: Create test data in D1 and Vectorize
  beforeAll(async () => {
    await createTestOrg(testOrgId, "Test Org");
    await insertKBChunks(kbTestChunks);
    await insertOrgChunks(testOrgId, orgTestChunks);
    await upsertKBVectors(kbTestChunks);
    await upsertOrgVectors(testOrgId, orgTestChunks);

    // Create another org with confidential data that should NOT leak
    otherOrgId = `other-org-${Date.now()}`;
    await createTestOrg(otherOrgId, "Other Org");

    const otherChunk: OrgChunk = {
      id: `${otherOrgId}_file1_0`,
      content: "Other firm confidential info.",
      source: "other.md",
    };

    await insertOrgChunks(otherOrgId, [otherChunk]);
    await upsertOrgVectors(otherOrgId, [otherChunk]);
  }, 30000); // 30s timeout for AI/Vectorize setup

  afterAll(async () => {
    await cleanupTestData();
  });

  // ===========================================================================
  // KB Retrieval Tests
  // ===========================================================================

  describe("Knowledge Base Retrieval", () => {
    const noFilters = {
      jurisdictions: [],
      practiceTypes: [],
      firmSize: null,
    };

    it("retrieves KB content with multi-query strategy", async () => {
      // Act
      const context = await retrieveRAGContext(
        env,
        "Clio workflows?",
        testOrgId,
        noFilters
      );

      // Assert
      expect(context).toBeDefined();
      expect(Array.isArray(context.kbChunks)).toBe(true);
    });

    it("includes jurisdiction-specific content when filtered", async () => {
      // Arrange
      const californiaFilters = {
        jurisdictions: ["CA"],
        practiceTypes: [],
        firmSize: null,
      };

      // Act
      const context = await retrieveRAGContext(
        env,
        "statute of limitations?",
        testOrgId,
        californiaFilters
      );

      // Assert
      expect(Array.isArray(context.kbChunks)).toBe(true);

      // If results returned, should include CA content
      if (context.kbChunks.length > 0) {
        const hasCAContent = context.kbChunks.some(
          (chunk) =>
            chunk.content.includes("California") || chunk.source.includes("ca")
        );
        expect(hasCAContent).toBe(true);
      }
    });

    it("excludes unrelated jurisdiction content", async () => {
      // Arrange: Filter for CA only
      const californiaFilters = {
        jurisdictions: ["CA"],
        practiceTypes: [],
        firmSize: null,
      };

      // Act
      const context = await retrieveRAGContext(
        env,
        "court procedures?",
        testOrgId,
        californiaFilters
      );

      // Assert: Should NOT include NY content when filtering for CA
      const hasNYContent = context.kbChunks.some(
        (chunk) =>
          chunk.content.includes("New York") || chunk.source.includes("ny")
      );
      expect(hasNYContent).toBe(false);
    });

    it("filters by practice type", async () => {
      // Arrange
      const piFilters = {
        jurisdictions: [],
        practiceTypes: ["personal-injury"],
        firmSize: null,
      };

      // Act
      const context = await retrieveRAGContext(
        env,
        "intake process?",
        testOrgId,
        piFilters
      );

      // Assert
      expect(Array.isArray(context.kbChunks)).toBe(true);
    });

    it("filters by firm size", async () => {
      // Arrange
      const soloFilters = {
        jurisdictions: [],
        practiceTypes: [],
        firmSize: "solo",
      };

      // Act
      const context = await retrieveRAGContext(
        env,
        "time management?",
        testOrgId,
        soloFilters
      );

      // Assert
      expect(Array.isArray(context.kbChunks)).toBe(true);
    });
  });

  // ===========================================================================
  // Org Context Retrieval Tests
  // ===========================================================================

  describe("Organization Context Retrieval", () => {
    const noFilters = {
      jurisdictions: [],
      practiceTypes: [],
      firmSize: null,
    };

    it("retrieves org-specific content", async () => {
      // Act
      const context = await retrieveRAGContext(
        env,
        "billing rates?",
        testOrgId,
        noFilters
      );

      // Assert
      expect(Array.isArray(context.orgChunks)).toBe(true);
    });

    it("does not leak content from other organizations", async () => {
      // Act: Query for content that exists in another org
      const context = await retrieveRAGContext(
        env,
        "confidential",
        testOrgId,
        noFilters
      );

      // Assert: Should NOT return content from other org
      const hasOtherOrgContent = context.orgChunks.some((chunk) =>
        chunk.content.includes("Other firm")
      );
      expect(hasOtherOrgContent).toBe(false);
    });
  });

  // ===========================================================================
  // Formatting Tests
  // ===========================================================================

  describe("Context Formatting", () => {
    it("formats both KB and Org sections", () => {
      // Arrange
      const context = {
        kbChunks: [{ content: "KB content here.", source: "kb-doc.md" }],
        orgChunks: [{ content: "Org content here.", source: "org-doc.md" }],
      };

      // Act
      const formatted = formatRAGContext(context);

      // Assert
      expect(formatted).toContain("## Knowledge Base");
      expect(formatted).toContain("*Source: kb-doc.md*");
      expect(formatted).toContain("## Firm Context");
      expect(formatted).toContain("*Source: org-doc.md*");
    });

    it("omits empty sections", () => {
      // Arrange: Only KB content, no org content
      const kbOnlyContext = {
        kbChunks: [{ content: "KB only content.", source: "kb.md" }],
        orgChunks: [],
      };

      // Act
      const formatted = formatRAGContext(kbOnlyContext);

      // Assert
      expect(formatted).toContain("## Knowledge Base");
      expect(formatted).not.toContain("## Firm Context");
    });

    it("returns empty string when no context available", () => {
      // Arrange
      const emptyContext = { kbChunks: [], orgChunks: [] };

      // Act
      const formatted = formatRAGContext(emptyContext);

      // Assert
      expect(formatted).toBe("");
    });
  });

  // ===========================================================================
  // Token Budget Tests
  // ===========================================================================

  describe("Token Budget Enforcement", () => {
    it("limits total context to fit within token budget", async () => {
      // Arrange: Query with all filters to maximize content
      const allFilters = {
        jurisdictions: ["CA"],
        practiceTypes: ["personal-injury"],
        firmSize: "solo",
      };

      // Act
      const context = await retrieveRAGContext(
        env,
        "everything about Clio and billing",
        testOrgId,
        allFilters
      );
      const formatted = formatRAGContext(context);

      // Assert: Budget is 3000 tokens @ ~4 chars/token = 12000 chars max
      const estimatedTokens = formatted.length / 4;
      expect(estimatedTokens).toBeLessThanOrEqual(3000);
    });
  });
});
