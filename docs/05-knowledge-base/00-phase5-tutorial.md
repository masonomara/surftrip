# Phase 5: Knowledge Base Tutorial

**LONGER DOC**

This tutorial walks through building Docket's Knowledge Base (KB) system. By the end, you'll understand how RAG works in Docket and have a working buildtime script that populates your KB.

## What You're Building

The Knowledge Base provides context for AI responses. When a user asks "What's the statute of limitations for personal injury cases?", the system:

1. Converts the question to a 768-dimensional vector using Workers AI
2. Queries Vectorize to find similar content from your KB markdown files
3. Fetches the matching text chunks from D1
4. Injects that context into the LLM's system prompt

This is Retrieval-Augmented Generation (RAG) — grounding AI responses in your curated content.

### The Two Knowledge Sources

| Source | Content | Storage | Access |
|--------|---------|---------|--------|
| **Shared KB** | Clio workflows, deadline calculations, billing guidance | D1 + Vectorize (no filter) | All users, all orgs |
| **Org Context** | Firm-specific docs, procedures, templates | D1 + Vectorize (filtered by `org_id`) | Per-org isolated |

Phase 5 focuses on **Shared KB**. Org Context uploads happen in Phase 9 (Website MVP).

## Prerequisites

Completed phases:
- Phase 2: Cloudflare bindings configured (`DB`, `VECTORIZE`, `AI`)
- Phase 3: D1 tables exist (`kb_chunks`, `kb_formulas`, `kb_benchmarks`)

Verify your bindings in `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [{ "binding": "DB", ... }],
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "docket-vectors" }],
  "ai": { "binding": "AI" }
}
```

---

## Part 1: Understanding the KB Schema

The Phase 3 migration created three tables. Here's what each stores:

### `kb_chunks` — Text for RAG retrieval

```sql
CREATE TABLE kb_chunks (
  id text PRIMARY KEY,        -- Format: {source}_{chunk_index}
  content text NOT NULL,      -- The ~500 char text chunk
  source text NOT NULL,       -- Original filename (e.g., "deadlines.md")
  section text,               -- H2 heading this chunk belongs to
  chunk_index integer NOT NULL,
  created_at integer NOT NULL
);
```

**Why chunks?** LLMs have token limits. Rather than stuffing entire documents into the prompt, we break content into ~500 character pieces. When the user asks a question, we retrieve only the most relevant chunks.

### `kb_formulas` — Actionable calculations

```sql
CREATE TABLE kb_formulas (
  id text PRIMARY KEY,
  name text NOT NULL,         -- "Statute of Limitations"
  formula text NOT NULL,      -- "Incident Date + Jurisdiction Limit"
  description text,           -- Usage notes
  source text NOT NULL,
  created_at integer NOT NULL
);
```

Formulas get priority in the prompt because they're directly actionable. Pattern to extract: `**Name**: formula`

### `kb_benchmarks` — Reference metrics

```sql
CREATE TABLE kb_benchmarks (
  id text PRIMARY KEY,
  name text NOT NULL,         -- "Client retention rate"
  value text NOT NULL,        -- "85%"
  unit text,                  -- "percentage"
  context text,               -- "is excellent"
  source text NOT NULL,
  created_at integer NOT NULL
);
```

Benchmarks provide concrete numbers. Extracted from markdown tables.

---

## Part 2: The Deploy-Time Script Architecture

The KB rebuilds on **deploy**, not on app start. This is a CI/CD step that runs once during `wrangler deploy`, not every time the Worker handles a request.

```
┌─────────────────────────────────────────────────────┐
│                   CI/CD Pipeline                     │
├─────────────────────────────────────────────────────┤
│  1. git push                                        │
│  2. npm run build                                   │
│  3. npm run build:kb  ← KB rebuild happens here    │
│  4. wrangler deploy                                 │
└─────────────────────────────────────────────────────┘

/kb
├── clio-workflows.md
├── deadline-calculations.md
├── billing-guidance.md
└── practice-management.md
         ↓
   [build:kb script]
         ↓
┌─────────────────────────────┐
│ 1. Clear old data           │
│ 2. Read markdown files      │
│ 3. Parse sections           │
│ 4. Extract formulas         │
│ 5. Extract benchmarks       │
│ 6. Chunk text (~500 chars)  │
│ 7. Generate embeddings      │
│ 8. Insert to D1             │
│ 9. Upsert to Vectorize      │
└─────────────────────────────┘
```

### Why Full Rebuild at Deploy?

- Runs once per deploy, not per request
- ~1000 chunks = 10 embedding batches = ~30 seconds (acceptable for CI/CD)
- Simpler than tracking file changes
- Deploy = single source of truth

**When to reconsider**: If KB grows past 5000 chunks (~3 min rebuild), implement incremental updates by hashing file contents and only processing changed files.

---

## Part 3: Creating the KB Source Files

Create the `/kb` directory at your project root:

```bash
mkdir -p kb
```

Create a sample KB file:

```markdown
<!-- kb/deadline-calculations.md -->
# Deadline Calculations

## Statute of Limitations

**Statute of Limitations**: Incident Date + Jurisdiction Limit (e.g., 2 years for PI in most states)

Personal injury cases in California have a 2-year statute of limitations from the date of injury. Medical malpractice has a 3-year limit from date of injury or 1 year from discovery, whichever comes first.

## Discovery Response Times

| Deadline Type | Days | Context |
|--------------|------|---------|
| Interrogatories | 30 | From date of service |
| Requests for Production | 30 | From date of service |
| Requests for Admission | 30 | Deemed admitted if no response |

For requests served by mail, add 5 calendar days. For electronic service, add 2 court days.

## Filing Windows

**Motion Filing Window**: Hearing Date - Notice Period (typically 16 court days for noticed motions)

Always check local rules. Federal courts require 28 days notice for summary judgment motions.
```

The script will:
- Extract `**Statute of Limitations**: ...` as a formula
- Extract the table rows as benchmarks
- Chunk the remaining text into ~500 char pieces

---

## Part 4: Building the Chunking Logic

Chunking is the core of RAG quality. Bad chunks = bad retrieval = bad answers.

### Chunking Principles

1. **Respect section boundaries** — Don't split mid-paragraph if avoidable
2. **Target ~500 characters** — Balances specificity with context
3. **Preserve meaning** — Each chunk should be understandable standalone
4. **Track source** — Every chunk knows its origin file and section

Create `scripts/build-kb.ts`:

```typescript
// scripts/build-kb.ts
import { readdir, readFile } from "fs/promises";
import { join } from "path";

interface KBChunk {
  id: string;
  content: string;
  source: string;
  section: string | null;
  chunkIndex: number;
}

interface KBFormula {
  id: string;
  name: string;
  formula: string;
  description: string | null;
  source: string;
}

interface KBBenchmark {
  id: string;
  name: string;
  value: string;
  unit: string | null;
  context: string | null;
  source: string;
}

const CHUNK_SIZE = 500;
const KB_DIR = "./kb";

/**
 * Chunks text while respecting paragraph boundaries.
 * Splits on double newlines first, then sentence boundaries if needed.
 */
function chunkText(text: string, source: string, section: string | null): KBChunk[] {
  const chunks: KBChunk[] = [];
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = "";
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // If adding this paragraph exceeds limit, save current and start new
    if (currentChunk.length + trimmed.length > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push({
        id: `${source}_${chunkIndex}`,
        content: currentChunk.trim(),
        source,
        section,
        chunkIndex,
      });
      chunkIndex++;
      currentChunk = "";
    }

    // If single paragraph exceeds limit, split on sentences
    if (trimmed.length > CHUNK_SIZE) {
      const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > CHUNK_SIZE && currentChunk.length > 0) {
          chunks.push({
            id: `${source}_${chunkIndex}`,
            content: currentChunk.trim(),
            source,
            section,
            chunkIndex,
          });
          chunkIndex++;
          currentChunk = "";
        }
        currentChunk += sentence + " ";
      }
    } else {
      currentChunk += trimmed + "\n\n";
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push({
      id: `${source}_${chunkIndex}`,
      content: currentChunk.trim(),
      source,
      section,
      chunkIndex,
    });
  }

  return chunks;
}

/**
 * Extracts formulas matching pattern: **Name**: formula text
 */
function extractFormulas(content: string, source: string): KBFormula[] {
  const formulas: KBFormula[] = [];
  const pattern = /\*\*([^*]+)\*\*:\s*([^\n]+)/g;
  let match;
  let index = 0;

  while ((match = pattern.exec(content)) !== null) {
    formulas.push({
      id: `${source}_formula_${index}`,
      name: match[1].trim(),
      formula: match[2].trim(),
      description: null,
      source,
    });
    index++;
  }

  return formulas;
}

/**
 * Extracts benchmarks from markdown tables.
 * Expected format: | Name | Value | Context |
 */
function extractBenchmarks(content: string, source: string): KBBenchmark[] {
  const benchmarks: KBBenchmark[] = [];

  // Match markdown tables
  const tablePattern = /\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/g;
  let tableMatch;
  let index = 0;

  while ((tableMatch = tablePattern.exec(content)) !== null) {
    const headers = tableMatch[1].split("|").map(h => h.trim().toLowerCase());
    const rows = tableMatch[2].trim().split("\n");

    for (const row of rows) {
      const cells = row.split("|").filter(c => c.trim()).map(c => c.trim());
      if (cells.length >= 2) {
        benchmarks.push({
          id: `${source}_benchmark_${index}`,
          name: cells[0],
          value: cells[1],
          unit: headers.includes("unit") ? cells[headers.indexOf("unit")] : null,
          context: cells[2] || null,
          source,
        });
        index++;
      }
    }
  }

  return benchmarks;
}

/**
 * Parses a markdown file into sections based on H2 headings.
 */
function parseSections(content: string): Map<string | null, string> {
  const sections = new Map<string | null, string>();
  const lines = content.split("\n");

  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // Save previous section
      if (currentContent.length > 0) {
        sections.set(currentSection, currentContent.join("\n"));
      }
      currentSection = line.replace("## ", "").trim();
      currentContent = [];
    } else if (!line.startsWith("# ")) {
      // Skip H1, include everything else
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentContent.length > 0) {
    sections.set(currentSection, currentContent.join("\n"));
  }

  return sections;
}

export async function parseKBFiles(): Promise<{
  chunks: KBChunk[];
  formulas: KBFormula[];
  benchmarks: KBBenchmark[];
}> {
  const files = await readdir(KB_DIR);
  const mdFiles = files.filter(f => f.endsWith(".md"));

  const allChunks: KBChunk[] = [];
  const allFormulas: KBFormula[] = [];
  const allBenchmarks: KBBenchmark[] = [];

  for (const file of mdFiles) {
    const content = await readFile(join(KB_DIR, file), "utf-8");
    const source = file;

    // Extract structured data first
    allFormulas.push(...extractFormulas(content, source));
    allBenchmarks.push(...extractBenchmarks(content, source));

    // Parse sections and chunk
    const sections = parseSections(content);
    for (const [section, text] of sections) {
      allChunks.push(...chunkText(text, source, section));
    }
  }

  console.log(`Parsed ${mdFiles.length} files:`);
  console.log(`  - ${allChunks.length} chunks`);
  console.log(`  - ${allFormulas.length} formulas`);
  console.log(`  - ${allBenchmarks.length} benchmarks`);

  return {
    chunks: allChunks,
    formulas: allFormulas,
    benchmarks: allBenchmarks,
  };
}
```

### Understanding the Code

**`chunkText`**: The heart of chunking. It:
1. Splits on double newlines (paragraphs)
2. Accumulates until hitting ~500 chars
3. Falls back to sentence-splitting for long paragraphs
4. Generates IDs like `deadline-calculations.md_0`

**`extractFormulas`**: Regex matches `**Name**: formula` patterns. These become high-priority RAG context.

**`extractBenchmarks`**: Parses markdown tables into structured data. The table must have at least 2 columns.

**`parseSections`**: Maps H2 headings to their content. This lets chunks know their context.

---

## Part 5: Generating Embeddings

Embeddings convert text to 768-dimensional vectors. Similar meanings → similar vectors.

```typescript
// scripts/build-kb.ts (continued)

interface EmbeddingResponse {
  shape: number[];
  data: number[][];
}

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const BATCH_SIZE = 100; // Workers AI limit per request

/**
 * Generates embeddings in batches.
 * Workers AI accepts up to 100 texts per request.
 */
async function generateEmbeddings(
  texts: string[],
  ai: Ai
): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    console.log(`  Generating embeddings ${i + 1}-${Math.min(i + BATCH_SIZE, texts.length)}...`);

    const response: EmbeddingResponse = await ai.run(EMBEDDING_MODEL, {
      text: batch,
    });

    allEmbeddings.push(...response.data);
  }

  return allEmbeddings;
}
```

### The Embedding Model

`@cf/baai/bge-base-en-v1.5` produces 768-dimensional vectors. This matches our Vectorize index configuration from Phase 2:

```bash
wrangler vectorize create docket-vectors --dimensions=768 --metric=cosine
```

**Cosine similarity**: Measures angle between vectors. 1.0 = identical direction, 0 = perpendicular.

---

## Part 6: Upserting to D1 and Vectorize

Now we combine everything into the full build script:

```typescript
// scripts/build-kb.ts (full version)

import type { D1Database, Vectorize, Ai } from "@cloudflare/workers-types";

interface Env {
  DB: D1Database;
  VECTORIZE: Vectorize;
  AI: Ai;
}

export async function buildKnowledgeBase(env: Env): Promise<{
  chunks: number;
  formulas: number;
  benchmarks: number;
  vectors: number;
}> {
  console.log("Building Knowledge Base...\n");

  // Step 1: Parse KB files
  const { chunks, formulas, benchmarks } = await parseKBFiles();

  // Step 2: Clear existing data
  console.log("\nClearing existing KB data...");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM kb_chunks"),
    env.DB.prepare("DELETE FROM kb_formulas"),
    env.DB.prepare("DELETE FROM kb_benchmarks"),
  ]);

  // Step 3: Generate embeddings for chunks
  console.log("\nGenerating embeddings...");
  const chunkTexts = chunks.map(c => c.content);
  const embeddings = await generateEmbeddings(chunkTexts, env.AI);

  // Step 4: Insert chunks to D1
  console.log("\nInserting chunks to D1...");
  const chunkStmt = env.DB.prepare(
    "INSERT INTO kb_chunks (id, content, source, section, chunk_index) VALUES (?, ?, ?, ?, ?)"
  );
  await env.DB.batch(
    chunks.map(c => chunkStmt.bind(c.id, c.content, c.source, c.section, c.chunkIndex))
  );

  // Step 5: Insert formulas to D1
  if (formulas.length > 0) {
    console.log("Inserting formulas to D1...");
    const formulaStmt = env.DB.prepare(
      "INSERT INTO kb_formulas (id, name, formula, description, source) VALUES (?, ?, ?, ?, ?)"
    );
    await env.DB.batch(
      formulas.map(f => formulaStmt.bind(f.id, f.name, f.formula, f.description, f.source))
    );
  }

  // Step 6: Insert benchmarks to D1
  if (benchmarks.length > 0) {
    console.log("Inserting benchmarks to D1...");
    const benchmarkStmt = env.DB.prepare(
      "INSERT INTO kb_benchmarks (id, name, value, unit, context, source) VALUES (?, ?, ?, ?, ?, ?)"
    );
    await env.DB.batch(
      benchmarks.map(b => benchmarkStmt.bind(b.id, b.name, b.value, b.unit, b.context, b.source))
    );
  }

  // Step 7: Upsert vectors to Vectorize
  console.log("\nUpserting vectors to Vectorize...");
  const vectors = chunks.map((chunk, i) => ({
    id: chunk.id,
    values: embeddings[i],
    metadata: { source: chunk.source, section: chunk.section },
  }));

  // Vectorize accepts up to 1000 vectors per upsert
  for (let i = 0; i < vectors.length; i += 1000) {
    const batch = vectors.slice(i, i + 1000);
    await env.VECTORIZE.upsert(batch);
  }

  console.log("\nKnowledge Base build complete!");
  console.log(`  - ${chunks.length} chunks`);
  console.log(`  - ${formulas.length} formulas`);
  console.log(`  - ${benchmarks.length} benchmarks`);
  console.log(`  - ${vectors.length} vectors`);

  return {
    chunks: chunks.length,
    formulas: formulas.length,
    benchmarks: benchmarks.length,
    vectors: vectors.length,
  };
}
```

### D1 Batch Operations

`env.DB.batch()` executes multiple statements atomically. This is crucial for:
- Performance (single round-trip)
- Consistency (all or nothing)

The batch clears old data first, then inserts new. If anything fails, the entire transaction rolls back.

### Vectorize Upsert

`env.VECTORIZE.upsert()` inserts or updates vectors by ID. Key behaviors:
- **Upsert** (not insert): If ID exists, overwrites it
- **Metadata**: Stored alongside vectors for filtering
- **Limit**: 1000 vectors per request

---

## Part 7: Creating the Build Endpoint

Expose the build script as an HTTP endpoint for testing:

```typescript
// src/routes/kb.ts

import { Hono } from "hono";
import { buildKnowledgeBase } from "../../scripts/build-kb";

const kb = new Hono<{ Bindings: Env }>();

// POST /kb/build - Rebuild the knowledge base (admin only in production)
kb.post("/build", async (c) => {
  try {
    const result = await buildKnowledgeBase(c.env);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error("KB build failed:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// GET /kb/stats - Check KB status
kb.get("/stats", async (c) => {
  const [chunks, formulas, benchmarks] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM kb_chunks"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM kb_formulas"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM kb_benchmarks"),
  ]);

  return c.json({
    chunks: chunks.results[0].count,
    formulas: formulas.results[0].count,
    benchmarks: benchmarks.results[0].count,
  });
});

// GET /kb/search?q=... - Test RAG retrieval
kb.get("/search", async (c) => {
  const query = c.req.query("q");
  if (!query) {
    return c.json({ error: "Missing query parameter 'q'" }, 400);
  }

  // Generate embedding for query
  const response = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [query],
  });

  // Query Vectorize
  const matches = await c.env.VECTORIZE.query(response.data[0], {
    topK: 5,
    returnMetadata: "all",
  });

  // Fetch chunk content from D1
  if (matches.matches.length === 0) {
    return c.json({ query, results: [] });
  }

  const ids = matches.matches.map(m => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const chunks = await c.env.DB.prepare(
    `SELECT * FROM kb_chunks WHERE id IN (${placeholders})`
  ).bind(...ids).all();

  // Combine with scores
  const results = matches.matches.map(match => {
    const chunk = chunks.results.find(c => c.id === match.id);
    return {
      id: match.id,
      score: match.score,
      content: chunk?.content,
      source: chunk?.source,
      section: chunk?.section,
    };
  });

  return c.json({ query, results });
});

export { kb };
```

---

## Part 8: Testing Strategy

### Unit Tests

Test the parsing logic in isolation:

```typescript
// test/kb/chunking.spec.ts
import { describe, it, expect } from "vitest";
import { chunkText, extractFormulas, extractBenchmarks } from "../../scripts/build-kb";

describe("chunkText", () => {
  it("respects chunk size limit", () => {
    const longText = "A".repeat(600) + "\n\n" + "B".repeat(600);
    const chunks = chunkText(longText, "test.md", null);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(chunk => {
      expect(chunk.content.length).toBeLessThanOrEqual(550); // Allow some buffer
    });
  });

  it("preserves section context", () => {
    const text = "Some content about deadlines.";
    const chunks = chunkText(text, "test.md", "Deadlines");

    expect(chunks[0].section).toBe("Deadlines");
  });

  it("generates unique IDs", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    const chunks = chunkText(text, "test.md", null);

    const ids = chunks.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("extractFormulas", () => {
  it("extracts **Name**: formula pattern", () => {
    const content = "**Statute of Limitations**: Incident Date + Jurisdiction Limit";
    const formulas = extractFormulas(content, "test.md");

    expect(formulas).toHaveLength(1);
    expect(formulas[0].name).toBe("Statute of Limitations");
    expect(formulas[0].formula).toBe("Incident Date + Jurisdiction Limit");
  });

  it("handles multiple formulas", () => {
    const content = `
      **Formula A**: X + Y
      **Formula B**: A * B
    `;
    const formulas = extractFormulas(content, "test.md");

    expect(formulas).toHaveLength(2);
  });
});

describe("extractBenchmarks", () => {
  it("parses markdown tables", () => {
    const content = `
| Metric | Value | Context |
|--------|-------|---------|
| Response Time | 30 | days |
| Retention | 85% | excellent |
    `;
    const benchmarks = extractBenchmarks(content, "test.md");

    expect(benchmarks).toHaveLength(2);
    expect(benchmarks[0].name).toBe("Response Time");
    expect(benchmarks[0].value).toBe("30");
  });
});
```

### Integration Tests

Test D1 and Vectorize interactions:

```typescript
// test/kb/build.spec.ts
import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { buildKnowledgeBase } from "../../scripts/build-kb";

describe("buildKnowledgeBase", () => {
  // Requires --remote flag for Vectorize
  it("populates D1 tables", async () => {
    const result = await buildKnowledgeBase(env);

    expect(result.chunks).toBeGreaterThan(0);

    // Verify data in D1
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM kb_chunks"
    ).all();

    expect(results[0].count).toBe(result.chunks);
  });

  it("creates matching vectors in Vectorize", async () => {
    // Query with a known term from our test KB
    const embedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: ["statute of limitations"],
    });

    const matches = await env.VECTORIZE.query(embedding.data[0], {
      topK: 1,
    });

    expect(matches.matches.length).toBeGreaterThan(0);
    expect(matches.matches[0].score).toBeGreaterThan(0.5);
  });

  it("clears old data before rebuilding", async () => {
    // Build twice
    await buildKnowledgeBase(env);
    const result2 = await buildKnowledgeBase(env);

    // Count should match result, not be doubled
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM kb_chunks"
    ).all();

    expect(results[0].count).toBe(result2.chunks);
  });
});
```

Run integration tests:

```bash
npx wrangler dev --test --remote
# or
npx vitest run test/kb/build.spec.ts --config vitest.config.mts
```

### E2E Test

Test the full search flow:

```typescript
// test/kb/e2e.spec.ts
import { describe, it, expect } from "vitest";

describe("KB Search E2E", () => {
  const BASE_URL = "http://localhost:8787";

  it("returns relevant results for legal queries", async () => {
    const response = await fetch(
      `${BASE_URL}/kb/search?q=statute%20of%20limitations%20california`
    );
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].score).toBeGreaterThan(0.7);
    expect(data.results[0].content).toContain("limitation");
  });

  it("handles empty results gracefully", async () => {
    const response = await fetch(
      `${BASE_URL}/kb/search?q=completely%20unrelated%20topic%20xyz123`
    );
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.results).toBeDefined();
    // Low scores are still returned; app logic decides threshold
  });
});
```

---

## Part 9: Shareholder Demo Endpoint

Create a demo page that shows the KB working:

```typescript
// src/routes/demo.ts

const demo = new Hono<{ Bindings: Env }>();

demo.get("/kb", async (c) => {
  // Get stats
  const [chunks, formulas, benchmarks] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM kb_chunks"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM kb_formulas"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM kb_benchmarks"),
  ]);

  // Sample query
  const sampleQuery = "What is the statute of limitations for personal injury?";
  const embedding = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [sampleQuery],
  });

  const matches = await c.env.VECTORIZE.query(embedding.data[0], {
    topK: 3,
    returnMetadata: "all",
  });

  // Fetch content
  const ids = matches.matches.map(m => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const chunkResults = await c.env.DB.prepare(
    `SELECT * FROM kb_chunks WHERE id IN (${placeholders})`
  ).bind(...ids).all();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Docket KB Demo - Phase 5</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    .stat { display: inline-block; background: #f0f0f0; padding: 10px 20px; margin: 5px; border-radius: 8px; }
    .stat-value { font-size: 24px; font-weight: bold; }
    .result { background: #f9f9f9; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #0066cc; }
    .score { color: #0066cc; font-weight: bold; }
    .source { color: #666; font-size: 12px; }
    pre { background: #f0f0f0; padding: 10px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>Phase 5: Knowledge Base Demo</h1>

  <h2>KB Statistics</h2>
  <div class="stat">
    <div class="stat-value">${chunks.results[0].count}</div>
    <div>Chunks</div>
  </div>
  <div class="stat">
    <div class="stat-value">${formulas.results[0].count}</div>
    <div>Formulas</div>
  </div>
  <div class="stat">
    <div class="stat-value">${benchmarks.results[0].count}</div>
    <div>Benchmarks</div>
  </div>

  <h2>Sample RAG Query</h2>
  <p><strong>Query:</strong> "${sampleQuery}"</p>

  <h3>Top 3 Results:</h3>
  ${matches.matches.map((match, i) => {
    const chunk = chunkResults.results.find(c => c.id === match.id);
    return `
      <div class="result">
        <div class="score">Score: ${(match.score * 100).toFixed(1)}%</div>
        <p>${chunk?.content || "Content not found"}</p>
        <div class="source">Source: ${chunk?.source} | Section: ${chunk?.section || "N/A"}</div>
      </div>
    `;
  }).join("")}

  <h2>How It Works</h2>
  <ol>
    <li>Query text converted to 768-dim embedding via Workers AI</li>
    <li>Vectorize returns most similar chunk IDs (cosine similarity)</li>
    <li>D1 fetches chunk text by ID</li>
    <li>Context injected into LLM system prompt</li>
  </ol>

  <h2>Try It Yourself</h2>
  <pre>curl "${c.req.url.replace("/demo/kb", "/kb/search")}?q=your+query+here"</pre>
</body>
</html>
  `;

  return c.html(html);
});

export { demo };
```

Access at: `http://localhost:8787/demo/kb`

---

## Phase 5 Checklist

- [ ] `/kb` directory created with markdown content
- [ ] Build script parses, chunks, extracts formulas/benchmarks
- [ ] Embeddings generated via `@cf/baai/bge-base-en-v1.5`
- [ ] Chunks stored in D1 `kb_chunks`
- [ ] Formulas stored in D1 `kb_formulas`
- [ ] Benchmarks stored in D1 `kb_benchmarks`
- [ ] Vectors upserted to Vectorize
- [ ] `/kb/search` endpoint returns relevant results
- [ ] Unit tests passing (chunking, extraction)
- [ ] Integration tests passing (D1 + Vectorize)
- [ ] E2E tests passing (full search flow)
- [ ] Demo page shows KB stats and sample query

---

## Next Steps

With the KB populated, Phase 6 (Core Worker + DO) can:
1. Call `retrieveKBContext(query)` → Vectorize query
2. Inject results into LLM system prompt
3. Ground AI responses in your curated knowledge

The same patterns apply to Org Context in Phase 9, but filtered by `org_id`.
