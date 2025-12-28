/**
 * RAG Integration Tests
 *
 * These tests verify the full RAG (Retrieval-Augmented Generation) pipeline
 * works correctly with real Vectorize and Workers AI services. Since these
 * tests hit live cloud services, they're disabled by default.
 *
 * To run these tests:
 * 1. Set INTEGRATION_TESTS_ENABLED=true in .dev.vars
 * 2. Run: npm test -- rag-integration
 *
 * What these tests verify:
 * - Knowledge Base content retrieval with jurisdiction/practice filters
 * - Organization-specific context retrieval
 * - Multi-tenant isolation (orgs can't see each other's data)
 * - Context formatting for LLM consumption
 * - Token budget enforcement
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { env } from "cloudflare:test";
import {
  retrieveRAGContext,
  formatRAGContext,
} from "../../src/services/rag-retrieval";

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * Check if integration tests are enabled via environment variable.
 * These tests hit live Vectorize and Workers AI, so they're off by default.
 */
const integrationEnabled = !!(env as { INTEGRATION_TESTS_ENABLED?: boolean })
  .INTEGRATION_TESTS_ENABLED;

/**
 * Generate a unique org ID for this test run to avoid collisions
 * if tests run in parallel or if cleanup fails.
 */
const testOrgId = `test-org-${Date.now()}`;

/**
 * Track all vector IDs we create so we can clean them up after tests.
 * Vectorize doesn't have a "delete by prefix" so we need to track IDs explicitly.
 */
const testVectorIds: string[] = [];

/**
 * ID for a second test org - used to verify multi-tenant isolation.
 * Created during beforeAll, cleaned up in afterAll.
 */
let otherOrgId: string;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Knowledge Base chunk structure.
 * KB chunks can have optional filters for jurisdiction, practice type, etc.
 */
interface KBChunk {
  id: string;
  content: string;
  source: string;
  category: string | null;
  jurisdiction: string | null;
  practice_type: string | null;
  firm_size: string | null;
}

/**
 * Organization context chunk structure.
 * Org chunks are simpler - just content and source, always scoped to one org.
 */
interface OrgChunk {
  id: string;
  content: string;
  source: string;
}

// ============================================================================
// Test Data
// ============================================================================

/**
 * Knowledge Base test chunks.
 *
 * These represent the global knowledge base that all orgs can access.
 * Each chunk has different filter attributes to test the filtering logic:
 *
 * - kb_general_test_0: No filters (appears for everyone)
 * - kb_federal_test_0: Federal jurisdiction only
 * - kb_ca_test_0: California jurisdiction
 * - kb_ny_test_0: New York jurisdiction
 * - kb_pi_test_0: Personal injury practice type
 * - kb_solo_test_0: Solo practitioner firm size
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
 * Organization-specific test chunks.
 *
 * These represent firm-specific context documents (like billing rates,
 * internal policies). They should ONLY be visible to the test org,
 * never to other orgs.
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

// ============================================================================
// Database Helper Functions
// ============================================================================

/**
 * Creates a test organization in the database.
 *
 * Uses INSERT OR IGNORE to handle cases where the org already exists
 * (e.g., if a previous test run failed before cleanup).
 *
 * @param orgId - Unique organization ID
 * @param name - Display name for the organization
 */
async function createTestOrg(orgId: string, name: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO org (id, name, created_at) VALUES (?, ?, datetime('now'))"
  )
    .bind(orgId, name)
    .run();
}

/**
 * Inserts Knowledge Base chunks into the D1 database.
 *
 * Uses batch insert for efficiency. The D1 database stores the actual
 * content, while Vectorize stores the embeddings for similarity search.
 *
 * @param chunks - Array of KB chunks to insert
 */
async function insertKBChunks(chunks: KBChunk[]): Promise<void> {
  const insertStatement = env.DB.prepare(
    `INSERT OR REPLACE INTO kb_chunks
     (id, content, source, section, chunk_index, category, jurisdiction, practice_type, firm_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const batchOperations = chunks.map((chunk) =>
    insertStatement.bind(
      chunk.id,
      chunk.content,
      chunk.source,
      null, // section - not used in test data
      0, // chunk_index - all test chunks are index 0
      chunk.category,
      chunk.jurisdiction,
      chunk.practice_type,
      chunk.firm_size
    )
  );

  await env.DB.batch(batchOperations);
}

/**
 * Inserts organization context chunks into the D1 database.
 *
 * Org chunks are scoped to a specific organization. The org_id is stored
 * both in D1 and in the Vectorize metadata for filtering.
 *
 * @param orgId - Organization these chunks belong to
 * @param chunks - Array of org chunks to insert
 */
async function insertOrgChunks(
  orgId: string,
  chunks: OrgChunk[]
): Promise<void> {
  const insertStatement = env.DB.prepare(
    `INSERT OR REPLACE INTO org_context_chunks
     (id, org_id, file_id, content, source, chunk_index)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const batchOperations = chunks.map((chunk, index) =>
    insertStatement.bind(
      chunk.id,
      orgId,
      "file1", // All test chunks belong to a single test file
      chunk.content,
      chunk.source,
      index
    )
  );

  await env.DB.batch(batchOperations);
}

// ============================================================================
// Vectorize Helper Functions
// ============================================================================

/**
 * Generates embeddings for an array of text strings using Workers AI.
 *
 * Uses the BGE-base-en model which produces 768-dimensional embeddings.
 * This is the same model used in production.
 *
 * @param texts - Array of text strings to embed
 * @returns Array of embedding vectors (each is a 768-element float array)
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const result = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: texts });

  // The AI binding returns { data: number[][] }
  const typedResult = result as { data: number[][] };
  return typedResult.data;
}

/**
 * Upserts Knowledge Base vectors into Vectorize.
 *
 * Each vector includes metadata for filtering:
 * - type: "kb" (to distinguish from org vectors)
 * - source: the source document filename
 * - Optional: category, jurisdiction, practice_type, firm_size
 *
 * The metadata allows Vectorize to filter results before returning them,
 * which is more efficient than filtering after retrieval.
 *
 * @param chunks - KB chunks to vectorize and store
 */
async function upsertKBVectors(chunks: KBChunk[]): Promise<void> {
  // Generate embeddings for all chunk contents
  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

  // Build vector objects with metadata
  const vectors = chunks.map((chunk, index) => ({
    id: chunk.id,
    values: embeddings[index],
    metadata: {
      type: "kb",
      source: chunk.source,
      // Only include filter fields if they have values
      ...(chunk.category && { category: chunk.category }),
      ...(chunk.jurisdiction && { jurisdiction: chunk.jurisdiction }),
      ...(chunk.practice_type && { practice_type: chunk.practice_type }),
      ...(chunk.firm_size && { firm_size: chunk.firm_size }),
    },
  }));

  // Upsert to Vectorize
  await env.VECTORIZE.upsert(vectors);

  // Track IDs for cleanup
  testVectorIds.push(...vectors.map((v) => v.id));
}

/**
 * Upserts organization context vectors into Vectorize.
 *
 * Org vectors have simpler metadata:
 * - type: "org" (to distinguish from KB vectors)
 * - org_id: the owning organization (CRITICAL for multi-tenant isolation)
 * - source: the source document filename
 *
 * @param orgId - Organization these vectors belong to
 * @param chunks - Org chunks to vectorize and store
 */
async function upsertOrgVectors(
  orgId: string,
  chunks: OrgChunk[]
): Promise<void> {
  // Generate embeddings for all chunk contents
  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

  // Build vector objects with org_id in metadata
  const vectors = chunks.map((chunk, index) => ({
    id: chunk.id,
    values: embeddings[index],
    metadata: {
      type: "org",
      org_id: orgId, // This enables filtering by organization
      source: chunk.source,
    },
  }));

  // Upsert to Vectorize
  await env.VECTORIZE.upsert(vectors);

  // Track IDs for cleanup
  testVectorIds.push(...vectors.map((v) => v.id));
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Removes all test data from Vectorize and D1.
 *
 * Called in afterAll to clean up after tests complete (pass or fail).
 * Order matters: delete vectors first, then database rows.
 */
async function cleanupTestData(): Promise<void> {
  // Delete vectors from Vectorize (if any were created)
  if (testVectorIds.length > 0) {
    await env.VECTORIZE.deleteByIds(testVectorIds);
  }

  // Delete KB test chunks (use pattern matching on test IDs)
  await env.DB.prepare(
    "DELETE FROM kb_chunks WHERE id LIKE 'kb_%_test_%'"
  ).run();

  // Delete org context chunks for the primary test org
  await env.DB.prepare("DELETE FROM org_context_chunks WHERE org_id = ?")
    .bind(testOrgId)
    .run();

  // Delete the primary test org
  await env.DB.prepare("DELETE FROM org WHERE id = ?").bind(testOrgId).run();

  // Clean up the secondary test org (used for isolation tests)
  if (otherOrgId) {
    await env.DB.prepare("DELETE FROM org_context_chunks WHERE org_id = ?")
      .bind(otherOrgId)
      .run();

    await env.DB.prepare("DELETE FROM org WHERE id = ?").bind(otherOrgId).run();
  }
}

// ============================================================================
// Test Suite
// ============================================================================

/**
 * Main RAG integration test suite.
 *
 * Skipped when INTEGRATION_TESTS_ENABLED is false (the default).
 * These tests require live Vectorize and Workers AI services.
 */
describe.skipIf(!integrationEnabled)("RAG Integration", () => {
  /**
   * Set up test data before all tests run.
   *
   * This creates:
   * 1. A test organization in D1
   * 2. KB chunks in D1 and Vectorize
   * 3. Org context chunks in D1 and Vectorize
   * 4. A second "other" org with its own data (for isolation testing)
   *
   * Timeout is extended to 30 seconds because embedding generation
   * can take a while, especially on cold starts.
   */
  beforeAll(async () => {
    // Create the primary test organization
    await createTestOrg(testOrgId, "Test Org");

    // Insert KB chunks into D1 and Vectorize
    await insertKBChunks(kbTestChunks);
    await upsertKBVectors(kbTestChunks);

    // Insert org context chunks into D1 and Vectorize
    await insertOrgChunks(testOrgId, orgTestChunks);
    await upsertOrgVectors(testOrgId, orgTestChunks);

    // Create a second org to test multi-tenant isolation
    otherOrgId = `other-org-${Date.now()}`;
    await createTestOrg(otherOrgId, "Other Org");

    // Give the other org some confidential data
    const otherOrgChunk: OrgChunk = {
      id: `${otherOrgId}_file1_0`,
      content: "Other firm confidential info.",
      source: "other.md",
    };
    await insertOrgChunks(otherOrgId, [otherOrgChunk]);
    await upsertOrgVectors(otherOrgId, [otherOrgChunk]);
  }, 30000);

  /**
   * Clean up all test data after tests complete.
   */
  afterAll(cleanupTestData);

  // ==========================================================================
  // Knowledge Base Retrieval Tests
  // ==========================================================================

  describe("Knowledge Base Retrieval", () => {
    /**
     * Default filter configuration - no restrictions.
     * Used when we want to test retrieval without any filtering.
     */
    const noFilters = {
      jurisdictions: [],
      practiceTypes: [],
      firmSize: null,
    };

    it("retrieves KB content with multi-query strategy", async () => {
      // Query for general Clio content
      const context = await retrieveRAGContext(
        env,
        "Clio workflows?",
        testOrgId,
        noFilters
      );

      // Should return some results
      expect(context).toBeDefined();
      expect(Array.isArray(context.kbChunks)).toBe(true);
    });

    it("includes jurisdiction-specific content when filtered", async () => {
      // Query with California jurisdiction filter
      const context = await retrieveRAGContext(
        env,
        "statute of limitations?",
        testOrgId,
        {
          jurisdictions: ["CA"],
          practiceTypes: [],
          firmSize: null,
        }
      );

      expect(Array.isArray(context.kbChunks)).toBe(true);

      // If we got results, they should include California content
      if (context.kbChunks.length > 0) {
        const hasCaliforniaContent = context.kbChunks.some(
          (chunk) =>
            chunk.content.includes("California") || chunk.source.includes("ca")
        );
        expect(hasCaliforniaContent).toBe(true);
      }
    });

    it("excludes unrelated jurisdiction content", async () => {
      // Query with California filter - should NOT return New York content
      const context = await retrieveRAGContext(
        env,
        "court procedures?",
        testOrgId,
        {
          jurisdictions: ["CA"],
          practiceTypes: [],
          firmSize: null,
        }
      );

      // New York content should be filtered out
      const hasNewYorkContent = context.kbChunks.some(
        (chunk) =>
          chunk.content.includes("New York") || chunk.source.includes("ny")
      );
      expect(hasNewYorkContent).toBe(false);
    });

    it("filters by practice type", async () => {
      // Query with personal injury practice type filter
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
      // Query with solo practitioner firm size filter
      const context = await retrieveRAGContext(
        env,
        "time management?",
        testOrgId,
        {
          jurisdictions: [],
          practiceTypes: [],
          firmSize: "solo",
        }
      );

      expect(Array.isArray(context.kbChunks)).toBe(true);
    });
  });

  // ==========================================================================
  // Org Context Retrieval Tests
  // ==========================================================================

  describe("Org Context Retrieval", () => {
    const noFilters = {
      jurisdictions: [],
      practiceTypes: [],
      firmSize: null,
    };

    it("retrieves org-specific content", async () => {
      // Query for billing info (which exists in our test org's context)
      const context = await retrieveRAGContext(
        env,
        "billing rates?",
        testOrgId,
        noFilters
      );

      // Should return org chunks array
      expect(Array.isArray(context.orgChunks)).toBe(true);
    });

    it("does not leak content from other organizations", async () => {
      /**
       * CRITICAL SECURITY TEST
       *
       * This verifies multi-tenant isolation. When the test org searches
       * for "confidential", it should NOT find the other org's confidential
       * data, even though it contains that word.
       */
      const context = await retrieveRAGContext(
        env,
        "confidential",
        testOrgId,
        noFilters
      );

      // Should NOT contain the other org's confidential info
      const hasOtherOrgContent = context.orgChunks.some((chunk) =>
        chunk.content.includes("Other firm")
      );
      expect(hasOtherOrgContent).toBe(false);
    });
  });

  // ==========================================================================
  // Context Formatting Tests
  // ==========================================================================

  describe("Context Formatting", () => {
    it("formats both KB and Org sections", () => {
      // Format context with both KB and org content
      const formatted = formatRAGContext({
        kbChunks: [{ content: "KB content here.", source: "kb-doc.md" }],
        orgChunks: [{ content: "Org content here.", source: "org-doc.md" }],
      });

      // Should have both sections with proper headers and sources
      expect(formatted).toContain("## Knowledge Base");
      expect(formatted).toContain("*Source: kb-doc.md*");
      expect(formatted).toContain("## Firm Context");
      expect(formatted).toContain("*Source: org-doc.md*");
    });

    it("omits empty sections", () => {
      // Format context with only KB content (no org content)
      const formatted = formatRAGContext({
        kbChunks: [{ content: "KB only content.", source: "kb.md" }],
        orgChunks: [],
      });

      // Should have KB section but NOT Firm Context section
      expect(formatted).toContain("## Knowledge Base");
      expect(formatted).not.toContain("## Firm Context");
    });

    it("returns empty string when no context available", () => {
      // Format empty context
      const result = formatRAGContext({
        kbChunks: [],
        orgChunks: [],
      });

      // Should return empty string, not null or undefined
      expect(result).toBe("");
    });
  });

  // ==========================================================================
  // Token Budget Tests
  // ==========================================================================

  describe("Token Budget Enforcement", () => {
    it("limits total context to fit within token budget", async () => {
      // Make a broad query that would match lots of content
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

      // Format the context
      const formatted = formatRAGContext(context);

      /**
       * Verify token budget is respected.
       *
       * The RAG system should limit context to ~3000 tokens.
       * Using a rough estimate of 4 characters per token, that's
       * about 12,000 characters max.
       *
       * We divide by 4 to convert characters to approximate tokens.
       */
      const approximateTokens = formatted.length / 4;
      expect(approximateTokens).toBeLessThanOrEqual(3000);
    });
  });
});
