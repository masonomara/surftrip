/**
 * RAG Retrieval Service
 *
 * Retrieves relevant context for LLM prompts by querying both:
 * - Knowledge Base (shared best practices, jurisdiction-specific rules)
 * - Org Context (firm-specific documents)
 *
 * The retrieval is filtered based on the org's settings (jurisdiction,
 * practice type, firm size) to return the most relevant content.
 */

import { Env } from "../index";
import { KB_CONFIG } from "../config/kb";

// ============================================================================
// Types
// ============================================================================

interface OrgSettings {
  jurisdiction: string | null;
  practiceType: string | null;
  firmSize: string | null;
}

interface ChunkWithSource {
  content: string;
  source: string;
}

interface RAGContext {
  kbChunks: ChunkWithSource[];
  orgChunks: ChunkWithSource[];
}

// ============================================================================
// KB Retrieval
// ============================================================================

/**
 * Queries Vectorize for KB chunks matching a specific filter.
 */
async function queryKBChunks(
  env: Env,
  queryVector: number[],
  filter: VectorizeVectorMetadataFilter
): Promise<Array<{ id: string; score: number }>> {
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
 * Retrieves KB chunks relevant to the query, filtered by org settings.
 *
 * Strategy:
 * 1. Always include general KB content and federal rules
 * 2. If org has a specific jurisdiction, include that too
 * 3. If org has practice type or firm size, include those
 * 4. Merge results, keeping highest scores, limit to top 5
 */
async function retrieveKBChunks(
  env: Env,
  queryVector: number[],
  orgSettings: OrgSettings
): Promise<ChunkWithSource[]> {
  // Build list of filters to query
  // Always query general and federal content
  const filters: VectorizeVectorMetadataFilter[] = [
    { type: "kb", category: "general" },
    { type: "kb", jurisdiction: "federal" },
  ];

  // Add org-specific filters if set
  if (orgSettings.jurisdiction) {
    filters.push({ type: "kb", jurisdiction: orgSettings.jurisdiction });
  }
  if (orgSettings.practiceType) {
    filters.push({ type: "kb", practice_type: orgSettings.practiceType });
  }
  if (orgSettings.firmSize) {
    filters.push({ type: "kb", firm_size: orgSettings.firmSize });
  }

  // Query all filters in parallel
  const allResults = await Promise.all(
    filters.map((filter) => queryKBChunks(env, queryVector, filter))
  );

  // Merge results, keeping the highest score for each chunk ID
  const scoresByChunkId = new Map<string, number>();

  for (const results of allResults) {
    for (const match of results) {
      const existingScore = scoresByChunkId.get(match.id);
      if (!existingScore || match.score > existingScore) {
        scoresByChunkId.set(match.id, match.score);
      }
    }
  }

  // Sort by score and take top 5
  const topChunkIds = [...scoresByChunkId.entries()]
    .sort((a, b) => b[1] - a[1]) // Sort by score descending
    .slice(0, 5)
    .map(([id]) => id);

  if (topChunkIds.length === 0) {
    return [];
  }

  // Fetch chunk content from D1
  const placeholders = topChunkIds.map(() => "?").join(",");
  const chunksResult = await env.DB.prepare(
    `SELECT id, content, source FROM kb_chunks WHERE id IN (${placeholders})`
  )
    .bind(...topChunkIds)
    .all<{ id: string; content: string; source: string }>();

  // Return in score order (not D1's order)
  const chunkById = new Map(
    chunksResult.results.map((chunk) => [chunk.id, chunk])
  );

  return topChunkIds
    .map((id) => chunkById.get(id))
    .filter(
      (chunk): chunk is { id: string; content: string; source: string } =>
        chunk !== undefined
    )
    .map(({ content, source }) => ({ content, source }));
}

// ============================================================================
// Org Context Retrieval
// ============================================================================

/**
 * Retrieves org-specific context chunks relevant to the query.
 *
 * These are documents the firm has uploaded (billing guides, intake
 * procedures, etc.) that are specific to their practice.
 */
async function retrieveOrgChunks(
  env: Env,
  queryVector: number[],
  orgId: string
): Promise<ChunkWithSource[]> {
  // Query Vectorize for org-specific content
  const vectorResults = await env.VECTORIZE.query(queryVector, {
    topK: 5,
    returnMetadata: "all",
    filter: { type: "org", org_id: orgId },
  });

  if (vectorResults.matches.length === 0) {
    return [];
  }

  // Fetch chunk content from D1
  const chunkIds = vectorResults.matches.map((match) => match.id);
  const placeholders = chunkIds.map(() => "?").join(",");

  const chunksResult = await env.DB.prepare(
    `SELECT content, source FROM org_context_chunks WHERE id IN (${placeholders})`
  )
    .bind(...chunkIds)
    .all<{ content: string; source: string }>();

  return chunksResult.results;
}

// ============================================================================
// Token Budget Management
// ============================================================================

/**
 * Trims context to fit within the token budget.
 *
 * KB chunks are prioritized over org chunks since they contain
 * validated best practices. We include as many as fit.
 */
function applyTokenBudget(context: RAGContext): RAGContext {
  const maxChars = KB_CONFIG.TOKEN_BUDGET * KB_CONFIG.CHARS_PER_TOKEN;
  let remainingChars = maxChars;

  const result: RAGContext = {
    kbChunks: [],
    orgChunks: [],
  };

  // Add KB chunks first (higher priority)
  for (const chunk of context.kbChunks) {
    const chunkSize = chunk.content.length + chunk.source.length + 20; // 20 for formatting
    if (chunkSize <= remainingChars) {
      result.kbChunks.push(chunk);
      remainingChars -= chunkSize;
    }
  }

  // Add org chunks with remaining budget
  for (const chunk of context.orgChunks) {
    const chunkSize = chunk.content.length + chunk.source.length + 20;
    if (chunkSize <= remainingChars) {
      result.orgChunks.push(chunk);
      remainingChars -= chunkSize;
    }
  }

  return result;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Retrieves all relevant context for a user query.
 *
 * This is the main function called before generating an LLM response.
 * It returns both KB and org context, trimmed to fit the token budget.
 */
export async function retrieveRAGContext(
  env: Env,
  query: string,
  orgId: string,
  orgSettings: OrgSettings
): Promise<RAGContext> {
  try {
    // Generate embedding for the query
    const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [query],
    })) as { data: number[][] };

    const queryVector = embeddingResult.data[0];

    // Retrieve both KB and org context in parallel
    const [kbChunks, orgChunks] = await Promise.all([
      retrieveKBChunks(env, queryVector, orgSettings),
      retrieveOrgChunks(env, queryVector, orgId),
    ]);

    // Apply token budget and return
    return applyTokenBudget({ kbChunks, orgChunks });
  } catch (error) {
    console.error("[RAG] Retrieval error:", error);
    // Return empty context on error rather than failing the request
    return { kbChunks: [], orgChunks: [] };
  }
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Formats RAG context into a string suitable for inclusion in a prompt.
 *
 * Separates KB and org content into labeled sections so the LLM
 * knows what type of information it's receiving.
 */
export function formatRAGContext(context: RAGContext): string {
  const sections: string[] = [];

  // Format KB chunks
  if (context.kbChunks.length > 0) {
    const kbContent = context.kbChunks
      .map((chunk) => `${chunk.content}\n*Source: ${chunk.source}*`)
      .join("\n\n");

    sections.push(`## Knowledge Base\n\n${kbContent}`);
  }

  // Format org chunks
  if (context.orgChunks.length > 0) {
    const orgContent = context.orgChunks
      .map((chunk) => `${chunk.content}\n*Source: ${chunk.source}*`)
      .join("\n\n");

    sections.push(`## Firm Context\n\n${orgContent}`);
  }

  return sections.join("\n\n");
}
