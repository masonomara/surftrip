
## Fix Now (Phase 6 Scope)

These items are explicitly in Phase 6 checklist or create significant technical debt if deferred.

### C5. Missing Workspace Binding Validation

**Problem:** Group chats could route messages cross-org.

**Why Now:** Phase 6 checklist line 163: "Workspace binding validation (D1 lookup)"

| Location | Issue |
| --- | --- |
| `src/index.ts:1142-1236` | No `workspace_bindings` check |

**Action:** Add D1 lookup before routing.

---

### ~~C9. Race Condition in Confirmation Flow~~ ✓ FIXED

**Problem:** Concurrent messages could clear pending confirmation.

**Solution:** Implemented atomic `claimConfirmation(id)` using `DELETE ... RETURNING`. Three changes:
1. `claimPendingConfirmation()` at line 331 atomically claims on first read
2. `executeConfirmedOperation()` at line 836 checks claim before executing Clio
3. `handleConfirmationResponse()` reject/modify cases at lines 760-772 check claim

Only one concurrent request can successfully claim a confirmation.

---

### H1. Missing User Removal Endpoint

**Problem:** No endpoint to remove user data from DO.

**Why Now:** Phase 6 checklist line 168: "User leaves org: expire pending_confirmations, delete Clio token"

| Location | Issue |
| --- | --- |
| `src/index.ts:171-183` | No `/remove-user` endpoint |

**Action:** Add `POST /remove-user` endpoint.

---

### H2. Missing GDPR Purge Endpoint

**Problem:** No mechanism to delete user's messages.

**Why Now:** Phase 6 checklist line 170: "GDPR: DO purges user's conversations/messages"

| Location | Issue |
| --- | --- |
| `src/index.ts:171-183` | No `/purge-user-data` endpoint |

**Action:** Add `POST /purge-user-data` endpoint.

---

### H4. Alarm Setup Blocks DO Constructor

**Problem:** Non-critical alarm setup delays all requests.

**Why Now:** Phase 6 spec 06-durable-objects.md: "Keep it fast—storage ops only"

| Location | Issue |
| --- | --- |
| `src/index.ts:50-54` | `ensureAlarmSet()` in `blockConcurrencyWhile` |

**Action:** Move alarm setup to first fetch() or alarm() handler.

---

### H7. Audit Log Writes Not Confirmed

**Problem:** R2 failures silently drop audit logs.

**Why Now:** Phase 6 implements audit logging. Silent failures = compliance risk.

| Location | Issue |
| --- | --- |
| `src/index.ts:157-159` | No error handling on R2.put() |

**Action:** Wrap in try/catch. Store failed entries in DO SQLite for retry.

---

### H9. Missing org_members Population Logic

**Problem:** `lookupChannelUser` queries `org_members` but no code creates these records.

**Why Now:** Phase 4 checklist marked complete: "Invitation processing on signup." This is a regression.

| Location | Issue |
| --- | --- |
| `src/index.ts:1064-1076` | Queries table that's never populated |

**Action:** Verify Phase 4 invitation flow populates `org_members`. Fix if missing.

---

### M5. Alarm Error Handling Missing

**Problem:** If R2 down during alarm, it's never rescheduled.

**Why Now:** Basic reliability for Phase 6's alarm system.

| Location | Issue |
| --- | --- |
| `src/index.ts:957-983` | No try/catch in `alarm()` |

**Action:** Wrap in try/catch. Always reschedule even on error.

---

---

## Technical Debt (Opportunistic)

These can be addressed during refactoring or when touching related code.

### M1. Conversation History Unbounded Message Size

| Location | Issue |
| --- | --- |
| `src/index.ts:382-402` | 15 messages, no max chars |

<!-- TODO: Trim individual messages to max length. -->

---

### M3. Multiple Pending Confirmations Not Handled

| Location | Issue |
| --- | --- |
| `src/index.ts:337-347` | `LIMIT 1` returns only first |

<!-- TODO: Handle multiple confirmations or queue them. -->

---

### M4. Empty Vectorize Results Edge Case

| Location | Issue |
| --- | --- |
| `src/services/rag-retrieval.ts:192-220` | Large chunks exceed budget |

<!-- TODO: Handle case where first chunk exceeds budget. -->

---

### M6. Unicode/Special Characters in SQL

| Location | Issue |
| --- | --- |
| `src/index.ts:298-319` | ConversationId with null bytes/emoji |

<!-- TODO: Validate/sanitize conversationId. -->

---

### M8. Unrelated Message Keeps Confirmation Pending

| Location | Issue |
| --- | --- |
| `src/index.ts:761-767` | No feedback about pending confirmation |

<!-- TODO: Add helper text about pending confirmation. -->

---

### M9. DO Constructor Timeout Risk

| Location | Issue |
| --- | --- |
| `src/index.ts:50-54` | Large cache could timeout |

<!-- TODO: Add timeout handling. Lazy-load large data. -->

---

### M10. Conversation Archival During Active Chat

| Location | Issue |
| --- | --- |
| `src/index.ts:957-983` | 30-day archival could hit active chat |

<!-- TODO: Add recency check before archival. -->

---

### L1. All DO Unit Tests Skipped

| Location | Issue |
| --- | --- |
| `test/unit/tenant-do.spec.ts:28` | `describe.skip()` |

<!-- TODO: Set up wrangler dev testing or wait for Cloudflare vitest fix. -->

---

### L2. E2E Demo Tests Skipped

| Location | Issue |
| --- | --- |
| `test/e2e/demo-flow.spec.ts:151-168` | Demo tests skipped |
| `test/e2e/demo-flow.spec.ts:174-222` | Performance tests skipped |

<!-- TODO: Enable or remove skipped tests. -->

---

### L3. Type Safety Bypass

| Location | Issue |
| --- | --- |
| `src/index.ts:503-504` | `as Function` bypasses TypeScript |

<!-- TODO: Create proper interface for AI.run. -->

---

### L7. Better Auth Type Bloat

| Location | Issue |
| --- | --- |
| `worker-configuration.d.ts` | 10,875 lines |

**Accepted:** Already committed in Phase 4. Revisit if causing issues.

---

### L10. SQL Injection Pattern Fragile

| Location | Issue |
| --- | --- |
| `src/services/rag-retrieval.ts:122-127` | Dynamic placeholder construction |

<!-- TODO: Add safety comment. Consider ORM for complex queries. -->

