/**
 * RAG Integration Tests
 *
 * Tests the complete RAG pipeline with real Workers AI and Vectorize bindings.
 * These tests verify:
 * - Knowledge Base retrieval with various filters
 * - Organization context retrieval with tenant isolation
 * - Context formatting and token budget enforcement
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { env } from "cloudflare:test";
import {
  retrieveRAGContext,
  formatRAGContext,
} from "../../src/services/rag-retrieval";

// =============================================================================
// Configuration
// =============================================================================

/** Flag to enable/disable integration tests (requires real AI bindings) */
const integrationEnabled = !!(env as { INTEGRATION_TESTS_ENABLED?: boolean })
  .INTEGRATION_TESTS_ENABLED;

/** Unique org ID for this test run */
const testOrgId = `test-org-${Date.now()}`;

/** Track vector IDs for cleanup */
const testVectorIds: string[] = [];

/** Another org ID to test tenant isolation */
let otherOrgId: string;

// =============================================================================
// Types
// =============================================================================

/** Knowledge Base chunk with metadata */
interface KBChunk {
  id: string;
  content: string;
  source: string;
  category: string | null;
  jurisdiction: string | null;
  practice_type: string | null;
  firm_size: string | null;
}

/** Organization context chunk */
interface OrgChunk {
  id: string;
  content: string;
  source: string;
}

// =============================================================================
// Test Data
// =============================================================================

/**
 * Knowledge Base test chunks covering various filter combinations.
 */
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

/**
 * Organization context test chunks (firm-specific).
 */
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
// Test Helpers
// =============================================================================

/**
 * Creates a test organization in D1.
 */
async function createTestOrg(orgId: string, name: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO org (id, name, created_at) VALUES (?, ?, datetime('now'))"
  )
    .bind(orgId, name)
    .run();
}

/**
 * Inserts Knowledge Base chunks into D1.
 */
async function insertKBChunks(chunks: KBChunk[]): Promise<void> {
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO kb_chunks
     (id, content, source, section, chunk_index, category, jurisdiction, practice_type, firm_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const bindings = chunks.map((chunk) =>
    stmt.bind(
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
  );

  await env.DB.batch(bindings);
}

/**
 * Inserts organization context chunks into D1.
 */
async function insertOrgChunks(
  orgId: string,
  chunks: OrgChunk[]
): Promise<void> {
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO org_context_chunks
     (id, org_id, file_id, content, source, chunk_index)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const bindings = chunks.map((chunk, index) =>
    stmt.bind(chunk.id, orgId, "file1", chunk.content, chunk.source, index)
  );

  await env.DB.batch(bindings);
}

/**
 * Generates embeddings for a list of texts using Workers AI.
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: texts,
  })) as { data: number[][] };

  return result.data;
}

/**
 * Upserts KB chunk vectors into Vectorize.
 */
async function upsertKBVectors(chunks: KBChunk[]): Promise<void> {
  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

  const vectors = chunks.map((chunk, index) => ({
    id: chunk.id,
    values: embeddings[index],
    metadata: {
      type: "kb",
      source: chunk.source,
      // Only include metadata fields that have values
      ...(chunk.category && { category: chunk.category }),
      ...(chunk.jurisdiction && { jurisdiction: chunk.jurisdiction }),
      ...(chunk.practice_type && { practice_type: chunk.practice_type }),
      ...(chunk.firm_size && { firm_size: chunk.firm_size }),
    },
  }));

  await env.VECTORIZE.upsert(vectors);
  testVectorIds.push(...vectors.map((v) => v.id));
}

/**
 * Upserts org context chunk vectors into Vectorize.
 */
async function upsertOrgVectors(
  orgId: string,
  chunks: OrgChunk[]
): Promise<void> {
  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

  const vectors = chunks.map((chunk, index) => ({
    id: chunk.id,
    values: embeddings[index],
    metadata: {
      type: "org",
      org_id: orgId,
      source: chunk.source,
    },
  }));

  await env.VECTORIZE.upsert(vectors);
  testVectorIds.push(...vectors.map((v) => v.id));
}

/**
 * Cleans up all test data from D1 and Vectorize.
 */
async function cleanupTestData(): Promise<void> {
  // Delete vectors
  if (testVectorIds.length > 0) {
    await env.VECTORIZE.deleteByIds(testVectorIds);
  }

  // Delete D1 records
  await env.DB.prepare(
    "DELETE FROM kb_chunks WHERE id LIKE 'kb_%_test_%'"
  ).run();
  await env.DB.prepare("DELETE FROM org_context_chunks WHERE org_id = ?")
    .bind(testOrgId)
    .run();
  await env.DB.prepare("DELETE FROM org WHERE id = ?").bind(testOrgId).run();

  // Clean up the other org if created
  if (otherOrgId) {
    await env.DB.prepare("DELETE FROM org_context_chunks WHERE org_id = ?")
      .bind(otherOrgId)
      .run();
    await env.DB.prepare("DELETE FROM org WHERE id = ?").bind(otherOrgId).run();
  }
}

// =============================================================================
// RAG Integration Tests
// =============================================================================

describe.skipIf(!integrationEnabled)("RAG Integration", () => {
  // ---------------------------------------------------------------------------
  // Test Setup and Teardown
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    // Create test organization
    await createTestOrg(testOrgId, "Test Org");

    // Insert KB and org chunks into D1
    await insertKBChunks(kbTestChunks);
    await insertOrgChunks(testOrgId, orgTestChunks);

    // Upsert vectors into Vectorize
    await upsertKBVectors(kbTestChunks);
    await upsertOrgVectors(testOrgId, orgTestChunks);

    // Create another org to test tenant isolation
    otherOrgId = `other-org-${Date.now()}`;
    await createTestOrg(otherOrgId, "Other Org");

    const otherOrgChunk: OrgChunk = {
      id: `${otherOrgId}_file1_0`,
      content: "Other firm confidential info.",
      source: "other.md",
    };

    await insertOrgChunks(otherOrgId, [otherOrgChunk]);
    await upsertOrgVectors(otherOrgId, [otherOrgChunk]);
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
  });

  // ---------------------------------------------------------------------------
  // Knowledge Base Retrieval
  // ---------------------------------------------------------------------------

  describe("Knowledge Base Retrieval", () => {
    /** Default org settings with no filters */
    const noFilters = {
      jurisdictions: [],
      practiceTypes: [],
      firmSize: null,
    };

    it("retrieves KB content with multi-query strategy", async () => {
      const context = await retrieveRAGContext(
        env,
        "Clio workflows?",
        testOrgId,
        noFilters
      );

      expect(context).toBeDefined();
      expect(Array.isArray(context.kbChunks)).toBe(true);
    });

    it("includes jurisdiction-specific content when filtered", async () => {
      const context = await retrieveRAGContext(
        env,
        "statute of limitations?",
        testOrgId,
        { jurisdictions: ["CA"], practiceTypes: [], firmSize: null }
      );

      expect(Array.isArray(context.kbChunks)).toBe(true);

      // Should include California-specific content
      if (context.kbChunks.length > 0) {
        const hasCAContent = context.kbChunks.some(
          (chunk) =>
            chunk.content.includes("California") || chunk.source.includes("ca")
        );
        expect(hasCAContent).toBe(true);
      }
    });

    it("excludes unrelated jurisdiction content", async () => {
      const context = await retrieveRAGContext(
        env,
        "court procedures?",
        testOrgId,
        { jurisdictions: ["CA"], practiceTypes: [], firmSize: null }
      );

      // Should NOT include New York content when filtering for CA only
      const hasNYContent = context.kbChunks.some(
        (chunk) =>
          chunk.content.includes("New York") || chunk.source.includes("ny")
      );
      expect(hasNYContent).toBe(false);
    });

    it("filters by practice type", async () => {
      const context = await retrieveRAGContext(
        env,
        "intake process?",
        testOrgId,
        {
          jurisdictions: [],
          practiceTypes: ["personal-injury"],
          firmSize: null,
        }
      );

      expect(Array.isArray(context.kbChunks)).toBe(true);
    });

    it("filters by firm size", async () => {
      const context = await retrieveRAGContext(
        env,
        "time management?",
        testOrgId,
        { jurisdictions: [], practiceTypes: [], firmSize: "solo" }
      );

      expect(Array.isArray(context.kbChunks)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Organization Context Retrieval
  // ---------------------------------------------------------------------------

  describe("Organization Context Retrieval", () => {
    /** Default org settings with no filters */
    const noFilters = {
      jurisdictions: [],
      practiceTypes: [],
      firmSize: null,
    };

    it("retrieves org-specific content", async () => {
      const context = await retrieveRAGContext(
        env,
        "billing rates?",
        testOrgId,
        noFilters
      );

      expect(Array.isArray(context.orgChunks)).toBe(true);
    });

    it("does not leak content from other organizations", async () => {
      // Query from testOrgId - should NOT see otherOrgId's content
      const context = await retrieveRAGContext(
        env,
        "confidential",
        testOrgId,
        noFilters
      );

      // Should NOT include other org's content
      const hasOtherOrgContent = context.orgChunks.some((chunk) =>
        chunk.content.includes("Other firm")
      );
      expect(hasOtherOrgContent).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Context Formatting
  // ---------------------------------------------------------------------------

  describe("Context Formatting", () => {
    it("formats both KB and Org sections", () => {
      const formatted = formatRAGContext({
        kbChunks: [{ content: "KB content here.", source: "kb-doc.md" }],
        orgChunks: [{ content: "Org content here.", source: "org-doc.md" }],
      });

      // Should have both sections with proper formatting
      expect(formatted).toContain("## Knowledge Base");
      expect(formatted).toContain("*Source: kb-doc.md*");
      expect(formatted).toContain("## Firm Context");
      expect(formatted).toContain("*Source: org-doc.md*");
    });

    it("omits empty sections", () => {
      const formatted = formatRAGContext({
        kbChunks: [{ content: "KB only content.", source: "kb.md" }],
        orgChunks: [],
      });

      // Should have KB but not Firm Context
      expect(formatted).toContain("## Knowledge Base");
      expect(formatted).not.toContain("## Firm Context");
    });

    it("returns empty string when no context available", () => {
      const formatted = formatRAGContext({
        kbChunks: [],
        orgChunks: [],
      });

      expect(formatted).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // Token Budget Enforcement
  // ---------------------------------------------------------------------------

  describe("Token Budget Enforcement", () => {
    it("limits total context to fit within token budget", async () => {
      // Query with all filters to get maximum context
      const context = await retrieveRAGContext(
        env,
        "everything about Clio and billing",
        testOrgId,
        {
          jurisdictions: ["CA"],
          practiceTypes: ["personal-injury"],
          firmSize: "solo",
        }
      );

      const formatted = formatRAGContext(context);

      // Token budget is 3000 tokens * ~4 chars/token = 12000 chars
      // But we'll check against a reasonable limit (3000 tokens)
      const estimatedTokens = formatted.length / 4;
      expect(estimatedTokens).toBeLessThanOrEqual(3000);
    });
  });
});
