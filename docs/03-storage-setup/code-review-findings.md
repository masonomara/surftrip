## Developer Experience (Fix Before Phase 6)

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
