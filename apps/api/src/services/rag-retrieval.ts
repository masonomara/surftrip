/**
 * RAG (Retrieval-Augmented Generation) Service
 *
 * Retrieves relevant context from two sources:
 * 1. Knowledge Base (KB) - shared best practices, legal procedures, Clio guides
 * 2. Org Context - firm-specific documents uploaded by the organization
 *
 * The retrieved context is included in the LLM's system prompt to ground
 * responses in relevant, accurate information.
 */

import { Env } from "../types/env";
import { KB_CONFIG } from "../config/kb";

// =============================================================================
// Types
// =============================================================================

/** Organization settings that affect which KB content is relevant */
interface OrgSettings {
  jurisdictions: string[];
  practiceTypes: string[];
  firmSize: string | null;
}

/** A chunk of content with its source attribution */
interface ChunkWithSource {
  content: string;
  source: string;
}

/** The combined RAG context from both sources */
interface RAGContext {
  kbChunks: ChunkWithSource[];
  orgChunks: ChunkWithSource[];
}

/** A vector search match with score */
interface VectorMatch {
  id: string;
  score: number;
}

// Vectorize has a limit on how many values can be in a $in filter
const MAX_FILTER_VALUES = 5;

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Retrieves relevant context from both the Knowledge Base and org-specific documents.
 *
 * Process:
 * 1. Generate embedding for the user's query
 * 2. Query KB and org chunks in parallel using the embedding
 * 3. Apply token budget to ensure context fits in the prompt
 */
export async function retrieveRAGContext(
  env: Env,
  query: string,
  orgId: string,
  orgSettings: OrgSettings
): Promise<RAGContext> {
  try {
    // Step 1: Generate embedding for the user's query
    const queryVector = await generateQueryEmbedding(env, query);

    // Step 2: Retrieve chunks from both sources in parallel
    const [kbChunks, orgChunks] = await Promise.all([
      retrieveKBChunks(env, queryVector, orgSettings),
      retrieveOrgChunks(env, queryVector, orgId),
    ]);

    // Step 3: Apply token budget to avoid exceeding context limits
    return applyTokenBudget({ kbChunks, orgChunks });
  } catch (error) {
    console.error("[RAG] Retrieval error:", error);
    // Return empty context on error - LLM will still work, just without context
    return { kbChunks: [], orgChunks: [] };
  }
}

/**
 * Formats RAG context into a human-readable string for the system prompt.
 */
export function formatRAGContext(context: RAGContext): string {
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

// =============================================================================
// Embedding Generation
// =============================================================================

/**
 * Generates a vector embedding for a query using Workers AI.
 */
async function generateQueryEmbedding(
  env: Env,
  query: string
): Promise<number[]> {
  const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [query],
  })) as { data: number[][] };

  return result.data[0];
}

// =============================================================================
// Knowledge Base Retrieval
// =============================================================================

/**
 * Retrieves relevant chunks from the shared Knowledge Base.
 *
 * Uses multiple filter queries to find content matching the org's context:
 * - Always includes general best practices
 * - Always includes federal rules (applies to all US firms)
 * - Optionally filters by jurisdiction, practice type, and firm size
 */
async function retrieveKBChunks(
  env: Env,
  queryVector: number[],
  orgSettings: OrgSettings
): Promise<ChunkWithSource[]> {
  // Build the list of filters to query
  const filters = buildKBFilters(orgSettings);

  // Query Vectorize with each filter in parallel
  const allResults = await Promise.all(
    filters.map((filter) => queryVectorize(env, queryVector, filter))
  );

  // Merge results, keeping the highest score for each chunk
  const bestScores = mergeVectorResults(allResults);

  // Get the top N chunks by score
  const topChunkIds = getTopChunkIds(bestScores, 5);

  if (topChunkIds.length === 0) {
    return [];
  }

  // Fetch the actual content from D1
  return fetchKBChunksFromDB(env, topChunkIds);
}

/**
 * Builds the set of Vectorize filters based on org settings.
 *
 * We run multiple parallel queries with different filters to ensure
 * we get relevant content from multiple dimensions (general, jurisdiction-specific, etc).
 */
function buildKBFilters(
  orgSettings: OrgSettings
): VectorizeVectorMetadataFilter[] {
  const filters: VectorizeVectorMetadataFilter[] = [
    // Always include general best practices (Clio usage, case management basics)
    { type: "kb", category: "general" },

    // Always include federal rules (applies to all US-based firms)
    { type: "kb", jurisdiction: "federal" },
  ];

  // Add jurisdiction-specific filter if org has jurisdictions set
  if (orgSettings.jurisdictions.length > 0) {
    // Limit to avoid hitting Vectorize's filter value limit
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
 * Queries Vectorize for matching chunks.
 */
async function queryVectorize(
  env: Env,
  queryVector: number[],
  filter: VectorizeVectorMetadataFilter
): Promise<VectorMatch[]> {
  const results = await env.VECTORIZE.query(queryVector, {
    topK: KB_CONFIG.KB_TOP_K,
    returnMetadata: "all",
    filter,
  });

  return results.matches.map((match) => ({
    id: match.id,
    score: match.score,
  }));
}

/**
 * Merges multiple result sets, keeping the highest score for each chunk ID.
 *
 * When the same chunk matches multiple filters (e.g., it's both "general" and
 * relevant to "CA" jurisdiction), we keep the best score.
 */
function mergeVectorResults(resultSets: VectorMatch[][]): Map<string, number> {
  const bestScores = new Map<string, number>();

  for (const results of resultSets) {
    for (const match of results) {
      const currentBest = bestScores.get(match.id);

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
  // Convert to array and sort by score descending
  const sortedEntries = [...scores.entries()].sort(
    (a, b) => b[1] - a[1] // b - a = descending
  );

  // Take the top N and return just the IDs
  return sortedEntries.slice(0, limit).map(([id]) => id);
}

/**
 * Fetches KB chunk content from D1, preserving the order from topIds.
 */
async function fetchKBChunksFromDB(
  env: Env,
  chunkIds: string[]
): Promise<ChunkWithSource[]> {
  // Build parameterized query with placeholders
  const placeholders = chunkIds.map(() => "?").join(",");
  const query = `SELECT id, content, source FROM kb_chunks WHERE id IN (${placeholders})`;

  const result = await env.DB.prepare(query)
    .bind(...chunkIds)
    .all<{ id: string; content: string; source: string }>();

  // Create a lookup map for efficient ordering
  const chunkById = new Map<string, { content: string; source: string }>();
  for (const chunk of result.results) {
    chunkById.set(chunk.id, chunk);
  }

  // Return chunks in the same order as chunkIds (by relevance score)
  const orderedChunks: ChunkWithSource[] = [];

  for (const id of chunkIds) {
    const chunk = chunkById.get(id);
    if (chunk) {
      orderedChunks.push({
        content: chunk.content,
        source: chunk.source,
      });
    }
  }

  return orderedChunks;
}

// =============================================================================
// Org Context Retrieval
// =============================================================================

/**
 * Retrieves org-specific context chunks.
 *
 * These are documents uploaded by the firm (policies, procedures, billing rates, etc).
 * The org_id filter ensures we only return content for this specific organization.
 */
async function retrieveOrgChunks(
  env: Env,
  queryVector: number[],
  orgId: string
): Promise<ChunkWithSource[]> {
  // Query Vectorize for org-specific content
  const results = await env.VECTORIZE.query(queryVector, {
    topK: 5,
    returnMetadata: "all",
    filter: {
      type: "org",
      org_id: orgId,
    },
  });

  if (results.matches.length === 0) {
    return [];
  }

  // Fetch content from D1
  const chunkIds = results.matches.map((match) => match.id);
  const placeholders = chunkIds.map(() => "?").join(",");
  const query = `SELECT content, source FROM org_context_chunks WHERE id IN (${placeholders})`;

  const result = await env.DB.prepare(query)
    .bind(...chunkIds)
    .all<{ content: string; source: string }>();

  return result.results;
}

// =============================================================================
// Token Budget Management
// =============================================================================

/**
 * Trims context to fit within the token budget.
 *
 * Prioritizes KB chunks (general knowledge), then adds org chunks with remaining budget.
 * This ensures we always have foundational knowledge even if org context is large.
 */
function applyTokenBudget(context: RAGContext): RAGContext {
  // Calculate max characters from token budget
  const maxChars = KB_CONFIG.TOKEN_BUDGET * KB_CONFIG.CHARS_PER_TOKEN;
  let remainingChars = maxChars;

  const result: RAGContext = {
    kbChunks: [],
    orgChunks: [],
  };

  // Add KB chunks first (higher priority - general knowledge)
  for (const chunk of context.kbChunks) {
    const chunkSize = estimateChunkSize(chunk);

    if (chunkSize <= remainingChars) {
      result.kbChunks.push(chunk);
      remainingChars -= chunkSize;
    }
  }

  // Add org chunks with remaining budget
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
 * Estimates the character size of a chunk for budget calculations.
 * Adds padding for markdown formatting overhead.
 */
function estimateChunkSize(chunk: ChunkWithSource): number {
  const FORMATTING_OVERHEAD = 20; // For "*Source: ...*" and newlines
  return chunk.content.length + chunk.source.length + FORMATTING_OVERHEAD;
}
