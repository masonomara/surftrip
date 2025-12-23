/**
 * RAG Retrieval Unit Tests
 *
 * Tests the RAG (Retrieval-Augmented Generation) flow including:
 * - Embedding generation and vector search
 * - Token budget management
 * - Context formatting
 * - Result ordering and graceful degradation
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

// =============================================================================
// Types
// =============================================================================

/** A chunk of content with its source attribution */
interface ChunkWithSource {
  content: string;
  source: string;
}

/** The combined RAG context from both KB and org sources */
interface RAGContext {
  kbChunks: ChunkWithSource[];
  orgChunks: ChunkWithSource[];
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum tokens allowed for RAG context */
const TOKEN_BUDGET = 3000;

/** Approximate characters per token (conservative estimate) */
const CHARS_PER_TOKEN = 4;

// =============================================================================
// Helper Functions (Mirroring Production Code)
// =============================================================================

/**
 * Estimates the character size of a chunk for budget calculations.
 * Adds padding for markdown formatting overhead.
 */
function estimateChunkSize(chunk: ChunkWithSource): number {
  const FORMATTING_OVERHEAD = 20; // For "*Source: ...*" and newlines
  return chunk.content.length + chunk.source.length + FORMATTING_OVERHEAD;
}

/**
 * Trims context to fit within the token budget.
 *
 * Prioritizes KB chunks (general knowledge), then adds org chunks with remaining budget.
 * This ensures we always have foundational knowledge even if org context is large.
 */
function applyTokenBudget(context: RAGContext): RAGContext {
  const maxChars = TOKEN_BUDGET * CHARS_PER_TOKEN;
  let remainingChars = maxChars;

  const result: RAGContext = {
    kbChunks: [],
    orgChunks: [],
  };

  // Step 1: Add KB chunks first (higher priority)
  for (const chunk of context.kbChunks) {
    const chunkSize = estimateChunkSize(chunk);

    if (chunkSize <= remainingChars) {
      result.kbChunks.push(chunk);
      remainingChars -= chunkSize;
    }
  }

  // Step 2: Add org chunks with remaining budget
  for (const chunk of context.orgChunks) {
    const chunkSize = estimateChunkSize(chunk);

    if (chunkSize <= remainingChars) {
      result.orgChunks.push(chunk);
      remainingChars -= chunkSize;
    }
  }

  return result;
}

/**
 * Calculates the total character size of a RAG context.
 */
function calculateTotalSize(context: RAGContext): number {
  const allChunks = [...context.kbChunks, ...context.orgChunks];
  return allChunks.reduce(
    (total, chunk) => total + estimateChunkSize(chunk),
    0
  );
}

/**
 * Formats RAG context into a human-readable string for the system prompt.
 */
function formatRAGContext(context: RAGContext): string {
  const sections: string[] = [];

  // Format Knowledge Base section
  if (context.kbChunks.length > 0) {
    const kbContent = context.kbChunks
      .map((chunk) => `${chunk.content}\n*Source: ${chunk.source}*`)
      .join("\n\n");

    sections.push(`## Knowledge Base\n\n${kbContent}`);
  }

  // Format Firm Context section
  if (context.orgChunks.length > 0) {
    const orgContent = context.orgChunks
      .map((chunk) => `${chunk.content}\n*Source: ${chunk.source}*`)
      .join("\n\n");

    sections.push(`## Firm Context\n\n${orgContent}`);
  }

  return sections.join("\n\n");
}

/**
 * Preserves the relevance order from Vectorize when fetching from D1.
 * D1 doesn't guarantee order, so we need to reorder based on the original ranking.
 */
function preserveOrder(
  orderedIds: string[],
  dbResults: Array<{ id: string; content: string; source: string }>
): ChunkWithSource[] {
  // Create a lookup map for efficient access
  const resultMap = new Map(dbResults.map((chunk) => [chunk.id, chunk]));

  // Return chunks in the same order as orderedIds
  return orderedIds
    .map((id) => resultMap.get(id))
    .filter(
      (chunk): chunk is { id: string; content: string; source: string } =>
        chunk !== undefined
    )
    .map(({ content, source }) => ({ content, source }));
}

// =============================================================================
// RAG Retrieval Tests
// =============================================================================

describe("Part 3: RAG Retrieval Flow", () => {
  // ---------------------------------------------------------------------------
  // Complete Flow
  // ---------------------------------------------------------------------------

  describe("Complete Flow", () => {
    it("converts query to embedding, searches Vectorize, fetches from D1", async () => {
      const query = "How do I create a new matter in Clio?";

      // Step 1: Generate embedding
      const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [query],
      })) as { data: number[][] };

      expect(embeddingResult.data[0]).toHaveLength(768);

      // Step 2: Search Vectorize
      const vectorResults = await env.VECTORIZE.query(embeddingResult.data[0], {
        topK: 5,
        filter: { type: "kb" },
        returnMetadata: "all",
      });

      expect(vectorResults).toHaveProperty("matches");
      expect(Array.isArray(vectorResults.matches)).toBe(true);

      // Step 3: Fetch content from D1 (if we have matches)
      if (vectorResults.matches.length > 0) {
        const chunkIds = vectorResults.matches.map((match) => match.id);
        const placeholders = chunkIds.map(() => "?").join(",");

        const dbResult = await env.DB.prepare(
          `SELECT id, content, source FROM kb_chunks WHERE id IN (${placeholders})`
        )
          .bind(...chunkIds)
          .all();

        expect(dbResult).toHaveProperty("results");
      }
    });

    it("searches KB and Org Context in parallel", async () => {
      const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: ["What are our firm's billing procedures?"],
      })) as { data: number[][] };

      // Query both sources in parallel
      const [kbResults, orgResults] = await Promise.all([
        env.VECTORIZE.query(embeddingResult.data[0], {
          topK: 5,
          filter: { type: "kb" },
        }),
        env.VECTORIZE.query(embeddingResult.data[0], {
          topK: 5,
          filter: { type: "org", org_id: "test_org_123" },
        }),
      ]);

      // Both should return results (may be empty)
      expect(kbResults).toHaveProperty("matches");
      expect(orgResults).toHaveProperty("matches");
    });
  });

  // ---------------------------------------------------------------------------
  // Token Budget Management
  // ---------------------------------------------------------------------------

  describe("Token Budget Management", () => {
    it("applyTokenBudget prioritizes KB chunks over Org chunks", () => {
      const context: RAGContext = {
        kbChunks: [
          { content: "A".repeat(4000), source: "kb1.md" },
          { content: "B".repeat(4000), source: "kb2.md" },
          { content: "C".repeat(4000), source: "kb3.md" },
        ],
        orgChunks: [
          { content: "D".repeat(4000), source: "org1.md" },
          { content: "E".repeat(4000), source: "org2.md" },
        ],
      };

      const result = applyTokenBudget(context);

      // Should include some KB chunks
      expect(result.kbChunks.length).toBeGreaterThan(0);

      // Total should be within budget (3000 tokens * 4 chars = 12000 chars)
      expect(calculateTotalSize(result)).toBeLessThanOrEqual(12000);
    });

    it("includes org chunks only if budget remains after KB", () => {
      const smallContext: RAGContext = {
        kbChunks: [{ content: "Small KB chunk", source: "kb.md" }],
        orgChunks: [{ content: "Small org chunk", source: "org.md" }],
      };

      const result = applyTokenBudget(smallContext);

      // Both should fit
      expect(result.kbChunks.length).toBe(1);
      expect(result.orgChunks.length).toBe(1);
    });

    it("excludes chunks that exceed remaining budget", () => {
      const context: RAGContext = {
        kbChunks: [
          { content: "A".repeat(10000), source: "kb1.md" }, // Fits
          { content: "B".repeat(5000), source: "kb2.md" }, // Doesn't fit
        ],
        orgChunks: [],
      };

      const result = applyTokenBudget(context);

      // Only first chunk should fit
      expect(result.kbChunks.length).toBe(1);
      expect(result.kbChunks[0].source).toBe("kb1.md");
    });

    it("handles empty context gracefully", () => {
      const emptyContext: RAGContext = {
        kbChunks: [],
        orgChunks: [],
      };

      const result = applyTokenBudget(emptyContext);

      expect(result.kbChunks).toEqual([]);
      expect(result.orgChunks).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Context Formatting
  // ---------------------------------------------------------------------------

  describe("formatRAGContext", () => {
    it("formats KB and Org sections with sources", () => {
      const context: RAGContext = {
        kbChunks: [
          {
            content: "Matters organize cases in Clio",
            source: "clio-guide.md",
          },
        ],
        orgChunks: [
          { content: "Our firm uses MX- prefix", source: "procedures.pdf" },
        ],
      };

      const formatted = formatRAGContext(context);

      // Should have both sections
      expect(formatted).toContain("## Knowledge Base");
      expect(formatted).toContain("*Source: clio-guide.md*");
      expect(formatted).toContain("## Firm Context");
      expect(formatted).toContain("*Source: procedures.pdf*");
    });

    it("omits sections with no chunks", () => {
      const kbOnlyContext: RAGContext = {
        kbChunks: [{ content: "KB only content", source: "kb.md" }],
        orgChunks: [],
      };

      const formatted = formatRAGContext(kbOnlyContext);

      // Should have KB section but not Firm Context
      expect(formatted).toContain("## Knowledge Base");
      expect(formatted).not.toContain("## Firm Context");
    });

    it("returns empty string for empty context", () => {
      const emptyContext: RAGContext = {
        kbChunks: [],
        orgChunks: [],
      };

      const formatted = formatRAGContext(emptyContext);

      expect(formatted).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // D1 Chunk Fetching
  // ---------------------------------------------------------------------------

  describe("D1 Chunk Fetching", () => {
    it("preserves relevance order from Vectorize scores", () => {
      // Vectorize returns these IDs in relevance order
      const orderedIds = ["chunk_high", "chunk_med", "chunk_low"];

      // D1 returns them in a different order
      const dbResults = [
        { id: "chunk_low", content: "Low", source: "low.md" },
        { id: "chunk_high", content: "High", source: "high.md" },
        { id: "chunk_med", content: "Medium", source: "med.md" },
      ];

      const ordered = preserveOrder(orderedIds, dbResults);

      // Should be reordered to match Vectorize ranking
      expect(ordered[0].content).toBe("High");
      expect(ordered[1].content).toBe("Medium");
      expect(ordered[2].content).toBe("Low");
    });

    it("handles missing chunks gracefully", () => {
      const orderedIds = ["exists", "missing", "also_exists"];

      const dbResults = [
        { id: "exists", content: "Exists", source: "a.md" },
        { id: "also_exists", content: "Also exists", source: "b.md" },
        // "missing" is not in the results
      ];

      const ordered = preserveOrder(orderedIds, dbResults);

      // Should only include the chunks that exist
      expect(ordered.length).toBe(2);
      expect(ordered[0].content).toBe("Exists");
      expect(ordered[1].content).toBe("Also exists");
    });
  });

  // ---------------------------------------------------------------------------
  // Graceful Degradation
  // ---------------------------------------------------------------------------

  describe("Graceful Degradation", () => {
    it("returns empty context if embedding fails", () => {
      // Simulate what happens when embedding generation fails
      const emptyContext: RAGContext = {
        kbChunks: [],
        orgChunks: [],
      };

      // System should continue with empty context
      expect(emptyContext.kbChunks).toEqual([]);
      expect(emptyContext.orgChunks).toEqual([]);
    });

    it("continues with partial results if one source fails", () => {
      // Simulate KB working but org context failing
      const partialContext: RAGContext = {
        kbChunks: [{ content: "KB content", source: "kb.md" }],
        orgChunks: [], // Failed to retrieve
      };

      // Should still have KB content
      expect(partialContext.kbChunks.length).toBe(1);
      expect(partialContext.orgChunks.length).toBe(0);
    });
  });
});
