# Docket Knowledge Base

The Knowledge Base (KB) provides RAG context for AI responses. Two sections: KB (best legal practices, Clio workflows) and Org Context (firm-specific documents).

All users access both sections. Role restrictions apply only to editing Org Context on the Docket website.

## How Knowledge Base Works

The Durable Object makes two parallel Vectorize queries with the same embedding. Results inject into the system prompt alongside Clio Schema:

- `retrieveKBContext(query)` → Vectorize (no filter) for Shared KB chunks
- `retrieveOrgContext(query, orgId)` → Vectorize (filter `{ org_id }`) for firm-specific Org Context chunks

**Configuration:**

- Embedding model: `@cf/baai/bge-base-en-v1.5` (768 dimensions)
- Chunk size: ~500 characters
- Vectorize topK: 5 (no minimum score threshold - rely on token budget truncation)
- Token budget: 3,000 tokens for RAG context

## Knowledge Base Sections

**Shared KB** for Clio + practice management. This includes best practices and foundational knowledge like Clio workflows (matters, time entries, invoices, reports), deadline calculations (filing windows, discovery response times), practice management (intake checklists, conflict checks, matter stages), and billing guidance (retainers, trust accounting, LEDES).

**Org Context** for firm-specific uploads. This includes internal docs and administration information like internal templates, engagement letters, standard clauses, firm billing rates, documented firm workflows, and staff/team routing preferences.

**Future Considerations**: Jurisdiction-specific legal knowledge (case law summaries, legal research, jurisdiction-specific statutes). KB may eventually require segmentation by industry and jurisdiction.

## Org Context Upload Flow

**Upload:**

1. Admin uploads file on Docket website
2. Validate: MIME type + extension (PDF, DOCX, MD only), size limit (25MB), sanitize filename
3. Stores raw file in R2: `/orgs/{org_id}/docs/{file_id}` (file_id is UUID)
4. Parse to text (PDF: pdf-parse, DOCX: mammoth, MD: direct) - wrap in try/catch, log failures
5. Chunk text (~500 chars, chunk*id format: `{org_id}*{file*id}*{chunk_index}`)
6. Store chunks in D1 `org_context_chunks`
7. Generate embeddings (~100 chunks per batch)
8. Upsert to Vectorize with metadata `{ org_id }`

**Delete/Update:**

1. Delete chunks from D1 where `chunk_id LIKE '{org_id}_{file_id}_%'`
2. Delete embeddings from Vectorize by chunk_id list
3. Delete raw file from R2
4. For updates: delete then re-upload (no in-place update)

## RAG Retrieval Structure

Prioritize by information type: formulas > benchmarks > narrative. Formulas are actionable calculations. Benchmarks are concrete metrics. Narrative is general guidance.

## How Knowledge Base is Distributed

Vectorize: Embeddings only

- Shared KB embeddings (no metadata filtering)
- Org Context embeddings (filtered by `{ org_id }`)

D1: Chunked text and structured data

- `kb_chunks`, `kb_formulas`, `kb_benchmarks` (shared)
- `org_context_chunks` (per-org, filtered by org_id)

R2: Raw uploaded files at `/orgs/{org_id}/docs/{file_id}`

## RAG Orchestration Flow

1. Generate query embedding (one embedding, used for both)

2. Query Vectorize (two parallel calls)

3. Fetch from D1 (two parallel fetches):
   - KB: Chunk text from `kb_chunks`, related formulas/benchmarks from same source files
   - Org Context: Chunk text from `org_context_chunks` using matched IDs
4. Apply token budget:
   - Reserve ~3,000 tokens total for RAG context
   - Truncate by priority: formulas > benchmarks > KB narrative > Org Context narrative
   - Log dropped chunks for debugging
5. Format for system prompt (two separate sections):

```text
## Knowledge Base Context

### Formulas
**Statute of Limitations**
Formula: Incident Date + Jurisdiction Limit (e.g., 2 years for PI)
Source: deadlines-guide.md

### Benchmarks
- Client retention rate: 85% is excellent (legal-metrics.md)

### Best Practices
[KB chunk text here]
*Source: case-management.md*

## Org Context (This Firm's Practices)

[Org context chunk text here]
*Source: firm-procedures.pdf*
```

6. Inject into system prompt alongside Clio Schema.

## Knowledge Base Creation at Build-Time

Full rebuild on each deploy ensures KB stays in sync with source markdown. No incremental updates. KB built at deploy. Function would:

1. Clear old data: Delete all rows from `kb_chunks`, `kb_formulas`, `kb_benchmarks`; delete all non-org embeddings from Vectorize
2. Read markdown files from `/kb` directory
3. Chunk at ~500 characters, respecting section boundaries
4. Extract formulas (pattern: `**Name**: formula`)
5. Extract benchmarks from markdown tables
6. Generate embeddings via Workers AI
7. Insert to D1 tables and Vectorize

## Error Handling

RAG failures return empty context (graceful degradation) so AI can continue without KB context rather than failing the entire request.

```typescript
catch (error) {
  console.error("[RAG] Retrieval error:", error);
  return { formulas: [], benchmarks: [], narrativeGuidance: [] };
}
```
