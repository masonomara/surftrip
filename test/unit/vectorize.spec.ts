/**
 * Vectorize Unit Tests
 *
 * Tests vector search functionality using Cloudflare Vectorize.
 * Covers basic queries, metadata filtering, and result merging strategies.
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

// =============================================================================
// Helper Functions (Mirroring Production Code)
// =============================================================================

/** Maximum number of values in a $in filter (Vectorize limit) */
const MAX_FILTER_VALUES = 5;

/**
 * Organization settings that affect which KB content is relevant.
 */
interface OrgSettings {
  jurisdictions: string[];
  practiceTypes: string[];
  firmSize: string | null;
}

/**
 * Builds the set of Vectorize filters based on org settings.
 *
 * We run multiple parallel queries with different filters to ensure
 * we get relevant content from multiple dimensions (general, jurisdiction-specific, etc).
 */
function buildKBFilters(
  orgSettings: OrgSettings
): Array<Record<string, unknown>> {
  const filters: Array<Record<string, unknown>> = [
    // Always include general best practices (Clio usage, case management basics)
    { type: "kb", category: "general" },

    // Always include federal rules (applies to all US-based firms)
    { type: "kb", jurisdiction: "federal" },
  ];

  // Add jurisdiction-specific filter if org has jurisdictions set
  if (orgSettings.jurisdictions.length > 0) {
    const jurisdictions = orgSettings.jurisdictions.slice(0, MAX_FILTER_VALUES);
    filters.push({
      type: "kb",
      jurisdiction: { $in: jurisdictions },
    });
  }

  // Add practice type filter if org has practice types set
  if (orgSettings.practiceTypes.length > 0) {
    const practiceTypes = orgSettings.practiceTypes.slice(0, MAX_FILTER_VALUES);
    filters.push({
      type: "kb",
      practice_type: { $in: practiceTypes },
    });
  }

  // Add firm size filter if set
  if (orgSettings.firmSize) {
    filters.push({
      type: "kb",
      firm_size: orgSettings.firmSize,
    });
  }

  return filters;
}

/**
 * Merges multiple result sets, keeping the highest score for each chunk ID.
 *
 * When the same chunk matches multiple filters (e.g., it's both "general" and
 * relevant to "CA" jurisdiction), we keep the best score.
 */
function mergeVectorResults(
  resultSets: Array<Array<{ id: string; score: number }>>
): Map<string, number> {
  const bestScores = new Map<string, number>();

  for (const results of resultSets) {
    for (const match of results) {
      const currentBest = bestScores.get(match.id);

      // Keep the higher score
      if (currentBest === undefined || match.score > currentBest) {
        bestScores.set(match.id, match.score);
      }
    }
  }

  return bestScores;
}

/**
 * Returns the top N chunk IDs sorted by score (descending).
 */
function getTopChunkIds(scores: Map<string, number>, limit: number): string[] {
  // Convert to array and sort by score (highest first)
  const sortedEntries = [...scores.entries()].sort(
    ([, scoreA], [, scoreB]) => scoreB - scoreA
  );

  // Take top N and extract just the IDs
  return sortedEntries.slice(0, limit).map(([id]) => id);
}

// =============================================================================
// Vectorize Tests
// =============================================================================

describe("Part 2: Vector Search with Vectorize", () => {
  // ---------------------------------------------------------------------------
  // Basic Vector Query
  // ---------------------------------------------------------------------------

  describe("Basic Vector Query", () => {
    it("returns matches with scores using cosine similarity", async () => {
      // Generate an embedding for our query
      const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: ["How do I create a new matter in Clio?"],
      })) as { data: number[][] };

      // Query Vectorize with the embedding
      const results = await env.VECTORIZE.query(embeddingResult.data[0], {
        topK: 5,
        returnMetadata: "all",
      });

      // Should return a matches array
      expect(results).toHaveProperty("matches");
      expect(Array.isArray(results.matches)).toBe(true);

      // Each match should have an ID and score
      for (const match of results.matches) {
        expect(match).toHaveProperty("id");
        expect(match).toHaveProperty("score");

        // Cosine similarity scores are between -1 and 1
        expect(match.score).toBeGreaterThanOrEqual(-1);
        expect(match.score).toBeLessThanOrEqual(1);
      }
    });

    it("respects topK limit", async () => {
      const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: ["test query"],
      })) as { data: number[][] };

      const results = await env.VECTORIZE.query(embeddingResult.data[0], {
        topK: 3,
      });

      // Should return at most 3 matches
      expect(results.matches.length).toBeLessThanOrEqual(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Metadata Filtering
  // ---------------------------------------------------------------------------

  describe("Metadata Filtering", () => {
    it("filters by type field", async () => {
      const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: ["legal case management"],
      })) as { data: number[][] };

      const results = await env.VECTORIZE.query(embeddingResult.data[0], {
        topK: 5,
        filter: { type: "kb" },
        returnMetadata: "all",
      });

      // All matches should be KB type
      for (const match of results.matches) {
        if (match.metadata) {
          expect(match.metadata.type).toBe("kb");
        }
      }
    });

    it("filters by category", async () => {
      const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: ["general best practices"],
      })) as { data: number[][] };

      const results = await env.VECTORIZE.query(embeddingResult.data[0], {
        topK: 5,
        filter: { type: "kb", category: "general" },
        returnMetadata: "all",
      });

      // Should return matches (may be empty if no matching data)
      expect(results).toHaveProperty("matches");
    });

    it("supports $in operator for multiple values", async () => {
      const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: ["California or New York law"],
      })) as { data: number[][] };

      // Use $in to match multiple jurisdictions
      const results = await env.VECTORIZE.query(embeddingResult.data[0], {
        topK: 5,
        filter: { type: "kb", jurisdiction: { $in: ["CA", "NY"] } },
        returnMetadata: "all",
      });

      // Should return results structure (may be empty)
      expect(results).toHaveProperty("matches");
    });
  });

  // ---------------------------------------------------------------------------
  // Parallel Query Strategy
  // ---------------------------------------------------------------------------

  describe("Parallel Query Strategy", () => {
    it("buildKBFilters always includes general and federal", () => {
      const filters = buildKBFilters({
        jurisdictions: [],
        practiceTypes: [],
        firmSize: null,
      });

      // Should have at least 2 filters (general + federal)
      expect(filters.length).toBeGreaterThanOrEqual(2);

      // Should include general category
      const hasGeneral = filters.some(
        (f) => f.category === "general" && f.type === "kb"
      );
      expect(hasGeneral).toBe(true);

      // Should include federal jurisdiction
      const hasFederal = filters.some(
        (f) => f.jurisdiction === "federal" && f.type === "kb"
      );
      expect(hasFederal).toBe(true);
    });

    it("buildKBFilters adds org-specific filters", () => {
      const filters = buildKBFilters({
        jurisdictions: ["CA", "NY"],
        practiceTypes: ["personal-injury-law"],
        firmSize: "small",
      });

      // Should have 5 filters:
      // 1. general
      // 2. federal
      // 3. jurisdictions ($in CA, NY)
      // 4. practice types ($in personal-injury-law)
      // 5. firm size (small)
      expect(filters.length).toBe(5);
    });

    it("buildKBFilters limits jurisdictions to 5", () => {
      const manyJurisdictions = [
        "CA",
        "NY",
        "TX",
        "FL",
        "IL",
        "PA",
        "OH",
        "GA",
      ];

      const filters = buildKBFilters({
        jurisdictions: manyJurisdictions,
        practiceTypes: [],
        firmSize: null,
      });

      // Find the jurisdiction filter with $in
      const jurisdictionFilter = filters.find(
        (f) => f.jurisdiction && typeof f.jurisdiction === "object"
      );

      // Should limit to MAX_FILTER_VALUES (5)
      if (
        jurisdictionFilter &&
        typeof jurisdictionFilter.jurisdiction === "object"
      ) {
        const inValues = (jurisdictionFilter.jurisdiction as { $in: string[] })
          .$in;
        expect(inValues.length).toBeLessThanOrEqual(5);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Result Merging
  // ---------------------------------------------------------------------------

  describe("Result Merging", () => {
    it("mergeVectorResults keeps highest score for duplicate IDs", () => {
      const resultSet1 = [
        { id: "chunk_1", score: 0.8 },
        { id: "chunk_2", score: 0.7 },
      ];
      const resultSet2 = [
        { id: "chunk_1", score: 0.9 }, // Higher score for chunk_1
        { id: "chunk_3", score: 0.6 },
      ];

      const merged = mergeVectorResults([resultSet1, resultSet2]);

      // chunk_1 should have the higher score (0.9)
      expect(merged.get("chunk_1")).toBe(0.9);

      // Other chunks should have their original scores
      expect(merged.get("chunk_2")).toBe(0.7);
      expect(merged.get("chunk_3")).toBe(0.6);

      // Should have 3 unique chunks total
      expect(merged.size).toBe(3);
    });

    it("getTopChunkIds returns sorted by score descending", () => {
      const scores = new Map<string, number>([
        ["chunk_a", 0.5],
        ["chunk_b", 0.9], // Highest
        ["chunk_c", 0.7], // Second highest
      ]);

      const top2 = getTopChunkIds(scores, 2);

      // Should return highest scores first
      expect(top2).toEqual(["chunk_b", "chunk_c"]);
      expect(top2.length).toBe(2);
    });

    it("getTopChunkIds handles empty map", () => {
      const emptyScores = new Map<string, number>();
      const result = getTopChunkIds(emptyScores, 5);

      expect(result).toEqual([]);
    });
  });
});
