import { Env } from "../types/env";
import { KB_CONFIG } from "../config/kb";

// ============================================================================
// Types
// ============================================================================

interface OrgSettings {
  jurisdictions: string[];
  practiceTypes: string[];
  firmSize: string | null;
}

interface ChunkWithSource {
  content: string;
  source: string;
}

export interface RAGContext {
  kbChunks: ChunkWithSource[];
  orgChunks: ChunkWithSource[];
}

interface VectorMatch {
  id: string;
  score: number;
}

// Maximum number of filter values we'll send to Vectorize
const MAX_FILTER_VALUES = 5;

// ============================================================================
// Main Entry Points
// ============================================================================

/**
 * Retrieves relevant context from both the Knowledge Base and the
 * organization's uploaded documents.
 */
export async function retrieveRAGContext(
  env: Env,
  query: string,
  orgId: string,
  orgSettings: OrgSettings
): Promise<RAGContext> {
  try {
    // Generate embedding for the user's query
    const queryVector = await generateQueryEmbedding(env, query);

    // Fetch from both sources in parallel
    const [kbChunks, orgChunks] = await Promise.all([
      retrieveKBChunks(env, queryVector, orgSettings),
      retrieveOrgChunks(env, queryVector, orgId),
    ]);

    // Trim results to fit within token budget
    const context = { kbChunks, orgChunks };
    return applyTokenBudget(context);
  } catch (error) {
    console.error("[RAG] Retrieval error:", error);
    return { kbChunks: [], orgChunks: [] };
  }
}

/**
 * Formats the retrieved context into a string suitable for inclusion
 * in an LLM prompt.
 */
export function formatRAGContext(context: RAGContext): string {
  const sections: string[] = [];

  if (context.kbChunks.length > 0) {
    const formattedChunks = formatChunksAsXml(context.kbChunks);
    sections.push(`## Knowledge Base\n\n${formattedChunks}`);
  }

  if (context.orgChunks.length > 0) {
    const formattedChunks = formatChunksAsXml(context.orgChunks);
    sections.push(`## Firm Context\n\n${formattedChunks}`);
  }

  return sections.join("\n\n");
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generates a vector embedding for the given query text.
 */
async function generateQueryEmbedding(env: Env, query: string): Promise<number[]> {
  const result = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [query],
  }) as { data: number[][] };

  return result.data[0];
}

// ============================================================================
// Knowledge Base Retrieval
// ============================================================================

/**
 * Retrieves relevant chunks from the shared Knowledge Base.
 *
 * We run multiple queries with different filters (general, federal,
 * jurisdiction-specific, practice-type, firm-size) and merge the results
 * to get the best matches across all categories.
 */
async function retrieveKBChunks(
  env: Env,
  queryVector: number[],
  orgSettings: OrgSettings
): Promise<ChunkWithSource[]> {
  // Build the set of filters we want to query
  const filters = buildKBFilters(orgSettings);

  // Query Vectorize with each filter in parallel
  const allResults = await Promise.all(
    filters.map((filter) => queryVectorize(env, queryVector, filter))
  );

  // Merge results, keeping only the best score for each chunk ID
  const bestScoreById = new Map<string, number>();

  for (const results of allResults) {
    for (const match of results) {
      const existingScore = bestScoreById.get(match.id) ?? -1;
      if (match.score > existingScore) {
        bestScoreById.set(match.id, match.score);
      }
    }
  }

  // Sort by score and take the top K
  const sortedEntries = [...bestScoreById.entries()].sort(
    (a, b) => b[1] - a[1]
  );
  const topChunkIds = sortedEntries
    .slice(0, KB_CONFIG.KB_TOP_K)
    .map(([id]) => id);

  if (topChunkIds.length === 0) {
    return [];
  }

  return fetchKBChunksFromDB(env, topChunkIds);
}

/**
 * Builds the set of Vectorize filters based on the organization's settings.
 *
 * We always include general content and federal content, then add
 * jurisdiction/practice/firm-size specific filters if configured.
 */
function buildKBFilters(
  settings: OrgSettings
): VectorizeVectorMetadataFilter[] {
  const filters: VectorizeVectorMetadataFilter[] = [
    // Always include general and federal content
    { type: "kb", category: "general" },
    { type: "kb", jurisdiction: "federal" },
  ];

  // Add jurisdiction-specific filter if the org has jurisdictions set
  if (settings.jurisdictions.length > 0) {
    const jurisdictions = settings.jurisdictions.slice(0, MAX_FILTER_VALUES);
    filters.push({
      type: "kb",
      jurisdiction: { $in: jurisdictions },
    });
  }

  // Add practice-type filter if the org has practice types set
  if (settings.practiceTypes.length > 0) {
    const practiceTypes = settings.practiceTypes.slice(0, MAX_FILTER_VALUES);
    filters.push({
      type: "kb",
      practice_type: { $in: practiceTypes },
    });
  }

  // Add firm-size filter if the org has firm size set
  if (settings.firmSize) {
    filters.push({
      type: "kb",
      firm_size: settings.firmSize,
    });
  }

  return filters;
}

/**
 * Queries the Vectorize index with the given filter.
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
 * Fetches the actual chunk content from D1, preserving the order of chunkIds.
 */
async function fetchKBChunksFromDB(
  env: Env,
  chunkIds: string[]
): Promise<ChunkWithSource[]> {
  // Build the query with placeholders
  const placeholders = chunkIds.map(() => "?").join(", ");
  const query = `
    SELECT id, content, source
    FROM kb_chunks
    WHERE id IN (${placeholders})
  `;

  const result = await env.DB.prepare(query)
    .bind(...chunkIds)
    .all<{ id: string; content: string; source: string }>();

  // Create a lookup map for fast access
  const chunksById = new Map(
    result.results.map((chunk) => [chunk.id, chunk])
  );

  // Return chunks in the same order as chunkIds (preserves score ordering)
  const orderedChunks: ChunkWithSource[] = [];

  for (const id of chunkIds) {
    const chunk = chunksById.get(id);
    if (chunk) {
      orderedChunks.push({
        content: chunk.content,
        source: chunk.source,
      });
    }
  }

  return orderedChunks;
}

// ============================================================================
// Organization Context Retrieval
// ============================================================================

/**
 * Retrieves relevant chunks from the organization's uploaded documents.
 */
async function retrieveOrgChunks(
  env: Env,
  queryVector: number[],
  orgId: string
): Promise<ChunkWithSource[]> {
  // Query Vectorize for this org's content only
  const results = await env.VECTORIZE.query(queryVector, {
    topK: KB_CONFIG.ORG_TOP_K,
    returnMetadata: "all",
    filter: {
      type: "org",
      org_id: orgId,
    },
  });

  if (results.matches.length === 0) {
    return [];
  }

  // Fetch the chunk content from D1
  const chunkIds = results.matches.map((match) => match.id);
  const placeholders = chunkIds.map(() => "?").join(", ");

  const query = `
    SELECT content, source
    FROM org_context_chunks
    WHERE id IN (${placeholders}) AND org_id = ?
  `;

  const result = await env.DB.prepare(query)
    .bind(...chunkIds, orgId)
    .all<{ content: string; source: string }>();

  return result.results;
}

// ============================================================================
// Token Budget Management
// ============================================================================

/**
 * Trims the context to fit within the configured token budget.
 *
 * We process KB chunks first, then org chunks, adding each chunk
 * only if it fits within the remaining budget.
 */
function applyTokenBudget(context: RAGContext): RAGContext {
  const budgetInChars = KB_CONFIG.TOKEN_BUDGET * KB_CONFIG.CHARS_PER_TOKEN;
  let remainingBudget = budgetInChars;

  const result: RAGContext = {
    kbChunks: [],
    orgChunks: [],
  };

  // Add KB chunks first (they're typically higher priority)
  for (const chunk of context.kbChunks) {
    const chunkSize = estimateChunkSize(chunk);

    if (chunkSize <= remainingBudget) {
      result.kbChunks.push(chunk);
      remainingBudget -= chunkSize;
    }
  }

  // Then add org chunks with remaining budget
  for (const chunk of context.orgChunks) {
    const chunkSize = estimateChunkSize(chunk);

    if (chunkSize <= remainingBudget) {
      result.orgChunks.push(chunk);
      remainingBudget -= chunkSize;
    }
  }

  return result;
}

/**
 * Estimates the size of a chunk when formatted (includes XML wrapper overhead).
 */
function estimateChunkSize(chunk: ChunkWithSource): number {
  const xmlWrapperOverhead = 20; // <document source="...">...</document>
  return chunk.content.length + chunk.source.length + xmlWrapperOverhead;
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Formats an array of chunks as XML documents.
 */
function formatChunksAsXml(chunks: ChunkWithSource[]): string {
  return chunks
    .map((chunk) => {
      return `<document source="${chunk.source}">\n${chunk.content}\n</document>`;
    })
    .join("\n\n");
}
