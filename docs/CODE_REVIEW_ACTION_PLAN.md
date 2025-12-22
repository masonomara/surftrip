## Implementation Checklist

### Before Claiming Phase 7 Complete

**Section A (Bugs from previous phases):**

- [x] A.1 GDPR Vectorize deletion
- [x] A.2 File upload validation
- [x] A.3 Atomic ownership transfer
- [x] A.4 Email normalization
- [x] A.5 Alarm error recovery
- [x] A.6 Archival verification
- [x] A.7 File type alignment

**Section B (Phase 7 items):**

- [ ] B.1 LLM parsing hardening
- [ ] B.2 Confirmation race condition
- [ ] B.3 KB_TOP_K alignment
- [ ] B.4 MAX_FILTER_VALUES fix
- [ ] B.5 Development plan update
- [x] B.6 Integration tests

---

## Section A: Bugs from Previous Phases 🔴

These items were marked complete in earlier phases but have issues. **Fix before Phase 8.**

### A.1 GDPR Vectorize Deletion Incomplete

| Field | Value                                |
| ----- | ------------------------------------ |
| File  | `src/services/gdpr.ts:228-355`       |
| Phase | 4 (marked ✅)                        |
| Risk  | €20M fine, GDPR Article 17 violation |

**Issue:** User's org context embeddings not deleted from Vectorize.

**Fix:**

```typescript
// In deleteUserData():
// 1. Query org_context_chunks WHERE uploaded_by = userId
// 2. Get all chunk IDs
// 3. Call env.VECTORIZE.deleteByIds(chunkIds)
// 4. Delete from org_context_chunks table
```

**Acceptance Criteria:**

- [ ] Query `org_context_chunks.uploaded_by` for user's chunks
- [ ] Delete chunk IDs from Vectorize
- [ ] Include count in deletion result

---

### A.2 File Upload Validation Gaps

| Field | Value                                |
| ----- | ------------------------------------ |
| File  | `src/services/org-context.ts:42-101` |
| Phase | 5 (marked ✅)                        |

**Missing:**

- Max filename length (255 char limit)
- MIME verification via magic bytes
- Double extension rejection

**Acceptance Criteria:**

- [ ] Filename length limited to 255 characters
- [ ] MIME type verified by file content
- [ ] Double extensions rejected

---

### A.3 Ownership Transfer Not Atomic

| Field | Value                                    |
| ----- | ---------------------------------------- |
| File  | `src/services/org-membership.ts:199-214` |
| Phase | 4 (marked ✅)                            |

**Issue:** D1 `batch()` doesn't rollback on failure.

**Acceptance Criteria:**

- [ ] Wrap in explicit transaction or verify success

---

### A.4 Email Normalization Inconsistent

| Field | Value                                   |
| ----- | --------------------------------------- |
| File  | `src/services/channel-linking.ts:72-82` |
| Phase | 4 (marked ✅)                           |

**Issue:** `findUserByEmail()` doesn't lowercase input.

**Acceptance Criteria:**

- [ ] Normalize email to lowercase before DB operations

---

### A.5 Alarm Error Recovery

| Field | Value                    |
| ----- | ------------------------ |
| File  | `src/index.ts:1132-1133` |
| Phase | 6 (marked ✅)            |

**Issue:** Schedules next alarm at end of function. If alarm fails, next alarm not set.

**Acceptance Criteria:**

- [ ] `setAlarm()` called before archival work

---

### A.6 Archival Verification Missing

| Field | Value                    |
| ----- | ------------------------ |
| File  | `src/index.ts:1136-1178` |
| Phase | 6 (marked ✅)            |

**Issue:** Conversation marked archived even if R2 write fails.

**Acceptance Criteria:**

- [ ] Verify R2 write succeeded before marking archived

---

### A.7 File Type Scope Creep

| Field | Value                               |
| ----- | ----------------------------------- |
| File  | `src/services/org-context.ts:17-40` |
| Phase | 5 (marked ✅)                       |

**Current:** 12 file types. **Spec:** PDF, DOCX, MD only.

**Acceptance Criteria:**

- [ ] Reduce to spec or update spec

---

## Section B: Phase 7 Completion 🟡

These items must be done before claiming Phase 7 complete.

### B.1 LLM Response Parsing Fragile

| Field   | Value                             |
| ------- | --------------------------------- |
| File    | `src/index.ts:270-346`, `535-571` |
| Phase 7 | "Error code handling"             |

**Issues:**

- No validation that `result.response` exists
- Tool call JSON parsing can fail
- Confirmation classification uses fragile regex

**Acceptance Criteria:**

- [ ] Validate Workers AI response structure
- [ ] Try-catch around JSON.parse with fallback
- [ ] Classification handles malformed responses

---

### B.2 Confirmation Flow Race Condition

| Field   | Value                   |
| ------- | ----------------------- |
| File    | `src/index.ts:794-835`  |
| Phase 7 | "CUD confirmation flow" |

**Issue:** `DELETE...RETURNING` without transaction isolation.

**Acceptance Criteria:**

- [x] Wrap in explicit transaction or advisory lock

---

### B.3 Fix KB_TOP_K Inconsistency

| Field | Value                                           |
| ----- | ----------------------------------------------- |
| Files | `src/config/kb.ts:21` vs `07-knowledge-base.md` |

**Code:** `KB_TOP_K: 3` — **Spec:** `topK: 5`

**Acceptance Criteria:**

- [ ] Align code and spec

---

### B.4 Fix MAX_FILTER_VALUES

| Field | Value                              |
| ----- | ---------------------------------- |
| File  | `src/services/rag-retrieval.ts:45` |

**Code:** `50` — **Spec:** `5`

**Acceptance Criteria:**

- [ ] Change to 5

---

### B.5 Update Development Plan

| Field | Value                                  |
| ----- | -------------------------------------- |
| File  | `docs/00-specs/10-development-plan.md` |

**Acceptance Criteria:**

- [ ] Mark actual completion percentage
- [ ] Note skipped tests with reason

---

### B.6 Add Phase 7 Integration Tests ✅

**File:** `test/integration/phase7-llm-rag.spec.ts`

**Required tests:**

- [x] Message → RAG context → response
- [x] LLM error handling
- [x] Confirmation flow

---
