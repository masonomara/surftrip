# Code Review Findings: Technical Debt

**Date:** 2025-12-21
**Scope:** Items that will NOT be resolved by continuing through the development plan

Items resolved by future phases have been removed. What remains compounds into technical debt if not addressed.

---

## Security (Fix Before Phase 6)

### 1. GDPR Hash Function Cryptographically Weak

**Location:** `/src/services/gdpr.ts` lines 24-34

Uses 32-bit JavaScript hash (8 hex chars). Collisions likely, potentially reversible. Violates GDPR "appropriate technical measures."

**Fix:**

```typescript
export async function hashUserId(userId: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId)
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, 16);
}
```

---

### 2. Test/Demo Endpoints Exposed in Production

**Location:** `/src/index.ts` lines 287-442

Routes `/test/*` and `/demo/*` exist in main worker. Attack surface increased.

**Fix:** Guard with environment check:

```typescript
if (env.ENVIRONMENT !== "production") {
  // demo routes
}
```

---

### 3. File Upload Path Traversal Protection Incomplete

**Location:** `/src/services/org-context.ts` lines 76-83

Blocks `..`, `/`, `\` but not Unicode normalization attacks, URL encoding, Windows reserved names, null bytes.

**Fix:**

```typescript
function sanitizeFilename(filename: string): string {
  const normalized = filename.normalize("NFC");
  const cleaned = normalized.replace(/[\x00-\x1f\x7f]/g, "");
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reserved.test(cleaned.split(".")[0])) {
    throw new Error("Reserved filename");
  }
  // existing checks...
}
```

---

### 4. Request Body Validation Missing

**Location:** `/src/index.ts` lines 182, 235, 296

Request bodies cast without validation. Malformed JSON causes undefined behavior.

**Fix:** Add Zod validation:

```typescript
import { z } from "zod";

const BotActivitySchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  from: z.object({ id: z.string() }).optional(),
});

const activity = BotActivitySchema.parse(await request.json());
```

---

## Developer Experience (Fix Before Phase 6)

### 5. Migration Sequence Gap

**Location:** `/src/db/migrations/`

Migrations jump from 0003 to 0005. Spec line 73 lists `0004_add_updated_at_triggers.sql`.

**Fix:** Either:

1. Create `0004_add_updated_at_triggers.sql`, OR
2. Renumber `0005` to `0004`

---

### 6. Drizzle Schema Incomplete

**Location:** `/src/db/schema.ts`

Only defines Better Auth tables. App tables (`org`, `org_members`, `kb_chunks`) exist in migrations but not in Drizzle schema. Services use raw SQL.

**Decision required:**

- **Option A:** Complete schema, use Drizzle ORM throughout
- **Option B:** Remove Drizzle, use raw D1 consistently (simpler)

---

### 7. Create Shared Types Module

**Location:** `/src/types/` (only has `raw-imports.d.ts`)

Types scattered across files. Missing domain types.

**Fix:** Create `/src/types/index.ts`:

```typescript
export interface Organization { ... }
export interface OrgSettings { ... }
export type OrgRole = "owner" | "admin" | "member";

export class ValidationError extends Error { ... }
export class NotFoundError extends Error { ... }
```

---

### 8. No Vitest Tests Visible

**Location:** `/test/`

Development plan says each phase has "Unit tests passing" but no test files visible. Demo endpoints are integration tests in disguise.

**Fix:** Create test structure:

```
/test/
  /unit/
    encryption.test.ts
    chunking.test.ts
    gdpr.test.ts
  /integration/
    rag-retrieval.test.ts
    org-context.test.ts
```

---

## Nice to Have

### 9. KB Filtering Uses Multiple Queries

**Location:** `/src/services/rag-retrieval.ts` lines 68-106

Makes 3-5 separate Vectorize queries instead of one with `$or`. Increases latency.

**Fix:** Single query with `$or` clause per spec 07-knowledge-base.md lines 149-167.

---

### 10. Create Development Seed Script

**Location:** `/scripts/seed.ts` (create)

No way to quickly set up test data.

---

### 11. Add Structured Logging

**Location:** Throughout codebase

Uses `console.error` with no structure.

**Fix:** Create `/src/lib/logger.ts` with structured JSON output.

---

### 12. Restructure /src

**Current:** 576-line `index.ts` mixing worker, DO, routes, demos.

**Proposed:**

```
/src/
  worker.ts
  /durable-objects/tenant.ts
  /routes/auth.ts, clio.ts, api.ts
  /services/
  /lib/
  /types/
  /config/index.ts
  /demo/
```
