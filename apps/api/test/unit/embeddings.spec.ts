/**
 * Embeddings Unit Tests
 *
 * Tests the vector embedding generation using Workers AI BGE-Base model.
 * Embeddings convert text into 768-dimensional vectors for semantic search.
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Calculates the cosine similarity between two vectors.
 * Returns a value between -1 (opposite) and 1 (identical).
 */
function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  if (vectorA.length !== vectorB.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    normA += vectorA[i] * vectorA[i];
    normB += vectorB[i] * vectorB[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return dotProduct / magnitude;
}

// =============================================================================
// Embedding Tests
// =============================================================================

describe("Part 1: Embeddings", () => {
  // ---------------------------------------------------------------------------
  // Conceptual Understanding
  // ---------------------------------------------------------------------------

  describe("Conceptual Understanding", () => {
    it("embeddings are 768-dimensional vectors", async () => {
      const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: ["How do I create a new matter in Clio?"],
      })) as { data: number[][] };

      // Should return a result
      expect(result.data).toBeDefined();

      // BGE-Base produces 768-dimensional vectors
      expect(result.data[0]).toHaveLength(768);

      // Each dimension should be a number
      expect(typeof result.data[0][0]).toBe("number");
    });

    it("similar text produces similar embeddings", async () => {
      // Generate embeddings for three different texts
      const [embedding1, embedding2, embedding3] = (await Promise.all([
        env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: ["How do I create a new matter?"],
        }),
        env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: ["What's the process for opening a new case?"],
        }),
        env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: ["What's the weather like today?"],
        }),
      ])) as { data: number[][] }[];

      // Calculate similarities
      const similarityBetweenRelated = cosineSimilarity(
        embedding1.data[0],
        embedding2.data[0]
      );
      const similarityBetweenUnrelated = cosineSimilarity(
        embedding1.data[0],
        embedding3.data[0]
      );

      // Related texts (both about matters/cases) should be more similar
      // than unrelated texts (legal vs weather)
      expect(similarityBetweenRelated).toBeGreaterThan(
        similarityBetweenUnrelated
      );
    });

    it("can batch multiple texts in one call", async () => {
      const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [
          "Create a new matter",
          "Update client contact",
          "Generate invoice",
        ],
      })) as { data: number[][] };

      // Should return 3 embeddings (one per input text)
      expect(result.data).toHaveLength(3);

      // Each embedding should be 768 dimensions
      expect(result.data[0]).toHaveLength(768);
      expect(result.data[1]).toHaveLength(768);
      expect(result.data[2]).toHaveLength(768);
    });
  });

  // ---------------------------------------------------------------------------
  // Query Embedding Generation
  // ---------------------------------------------------------------------------

  describe("generateQueryEmbedding function", () => {
    it("extracts the first vector from batch response", async () => {
      const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: ["Show me all open matters"],
      })) as { data: number[][] };

      // Should extract the first (and only) embedding
      expect(result.data[0]).toHaveLength(768);
      expect(Array.isArray(result.data[0])).toBe(true);
    });

    it("handles empty query gracefully", async () => {
      // Even an empty string should produce an embedding
      const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [""],
      })) as { data: number[][] };

      expect(result.data[0]).toHaveLength(768);
    });

    it("handles long text input", async () => {
      // Create a very long input (200 repetitions)
      const longText = "This is a test. ".repeat(200);

      const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [longText],
      })) as { data: number[][] };

      // Should still produce a valid embedding (model truncates if needed)
      expect(result.data[0]).toHaveLength(768);
    });
  });

  // ---------------------------------------------------------------------------
  // Why BGE-Base?
  // ---------------------------------------------------------------------------

  describe("Why BGE-Base?", () => {
    it("uses cosine metric (vectors are normalized)", async () => {
      const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: ["Legal case management"],
      })) as { data: number[][] };

      // Calculate the L2 norm of the vector
      const sumOfSquares = result.data[0].reduce(
        (sum, val) => sum + val * val,
        0
      );
      const norm = Math.sqrt(sumOfSquares);

      // BGE-Base produces normalized vectors (norm ≈ 1.0)
      // This means we can use dot product instead of full cosine similarity
      expect(norm).toBeCloseTo(1.0, 1);
    });
  });
});
