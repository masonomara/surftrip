# Docket Comprehensive Code Review

**Date:** December 28, 2025
**Scope:** Full codebase review (apps/api, apps/web, packages/shared)
**Reviewers:** Four perspectives—Security, Simplicity, Compliance, Practicality

---

## Executive Summary

This review consolidates findings from four distinct perspectives analyzing the Docket codebase against the specifications in `/docs/00-specs/`. The codebase demonstrates strong architectural discipline and security practices overall. However, significant gaps exist in compliance tooling, and several patterns need unification.

---

### 1. No GDPR Data Export Mechanism

**Perspective:** Lawyerly Supervisor
**Category:** GDPR Article 20 - Data Portability
**Files:** `apps/api/src/services/gdpr.ts`, `apps/api/src/handlers/account.ts`

The GDPR service only implements deletion (`deleteUserData`) but provides no data export mechanism. Users cannot exercise their right to receive personal data in a structured format.

**What's Missing:**

- No `exportUserData()` function
- No API endpoint for data export
- No mechanism to compile user's messages, documents, and Clio interactions

**Recommendation:** Implement `GET /api/account/export` endpoint returning user profile, messages, uploaded documents, and audit log entries.

---

### 2. No Audit Log Retention Policy

**Perspective:** Lawyerly Supervisor
**Category:** Legal Profession Compliance / E-Discovery
**Files:** `apps/api/src/do/tenant.ts:1526-1554`, `apps/api/src/storage/r2-paths.ts`

Audit logs are written to R2 but there is no defined retention period, mechanism to prevent premature deletion, or litigation hold capability.

**Legal Risk:** Legal ethics rules require retention periods for client files (typically 7+ years). If logs are deleted prematurely, the firm loses evidence for malpractice defense.

**Recommendation:**

- Configure R2 lifecycle rules to enforce minimum 7-year retention
- Implement litigation hold flag in org settings
- Document retention policy in terms of service

---

### 3. Teams Webhook Authentication Missing

**Perspective:** Christian Senior Engineer
**Severity:** High
**File:** `apps/api/src/handlers/teams.ts:47-71`

The Teams webhook endpoint (`/api/messages`) lacks Bot Framework authentication verification. Microsoft recommends validating the JWT token in the Authorization header.

```typescript
// Lines 47-71 - No authentication check before processing
export async function handleTeamsMessage(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  // Missing: JWT validation from Microsoft Bot Framework
```

**Recommendation:** Implement JWT validation using Microsoft's Bot Connector service authentication.

---

### 4. Email Enumeration Vulnerability

**Severity:** Medium
**File:** `apps/api/src/handlers/auth.ts:38-52`

The `/api/check-email` endpoint explicitly reveals whether an email exists and has a password, enabling attackers to enumerate valid accounts.

**Recommendation:** Rate limit this endpoint aggressively (5 requests/IP/minute).

---

### 5. Missing Rate Limiting on Authentication Endpoints

**Severity:** Medium
**Files:** `apps/api/src/index.ts`, `apps/api/src/handlers/auth.ts`

No explicit rate limiting on `/api/check-email`, invitation endpoints, or Better Auth endpoints.

**Recommendation:** Implement Cloudflare rate limiting rules or custom solution with D1/KV tracking.

---

### 6. Invitation Token Information Disclosure

**Severity:** Medium
**File:** `apps/api/src/services/invitations.ts:545-565`

The `GET /api/invitations/:id` endpoint reveals org name, inviter name, and email without authentication.

**Recommendation:** Consider adding a short verification code or masking the email address.

---

### 7. Missing CSRF Protection

**Severity:** Medium
**Files:** Multiple API handlers

API relies on cookies for session authentication but doesn't implement explicit CSRF protection.

**Recommendation:** Ensure session cookies use `SameSite=Lax` or `SameSite=Strict`.

---

### 8. Error Messages May Leak Implementation Details

**Severity:** Low
**File:** `apps/api/src/index.ts:238-244`

Error messages in the `/api/auth/*` catch block include full stack traces.

**Recommendation:** Log full error details server-side, return generic messages to clients.

---

### 9. LLM Prompt Injection Risk

**Severity:** Medium
**File:** `apps/api/src/do/tenant.ts:229-239`

User messages are passed directly to the LLM. Malicious users could attempt prompt injection.

**Recommendation:** Monitor for suspicious patterns; consider input sanitization.

---

### 10. Dynamic SQL Query Construction

**Severity:** Low
**File:** `apps/api/src/handlers/org.ts:239-282`

While parameterized queries are used correctly, dynamic query construction patterns can introduce risks if modified carelessly.

**Recommendation:** Document pattern with security warnings for future maintainers.

---

### 11. Missing Audit Logging for Failed Authentication

**Severity:** Low
**Files:** Multiple handlers

Failed authentication attempts are not audited, limiting forensic capability.

**Recommendation:** Add audit logging for failed logins and authorization failures.

---

### 12. Positive Security Practices Observed

1. **Strong Encryption:** AES-256-GCM with PBKDF2 key derivation (100,000 iterations)
2. **Constant-Time Comparisons:** Used for password verification and HMAC validation
3. **PKCE for OAuth:** Clio OAuth implements PKCE with S256 code challenge
4. **HMAC-Signed State Parameters:** OAuth state prevents CSRF
5. **PII Sanitization:** Audit logs automatically redact sensitive fields
6. **File Validation:** Magic bytes, dangerous extensions, path traversal prevention
7. **Parameterized Queries:** All D1 queries use parameterized statements

---

### 13. No Consent Tracking

**Risk Level:** High
**Category:** GDPR Article 7
**Files:** `apps/api/src/handlers/auth.ts`, `apps/api/src/db/schema.ts`

No record of when users consented to data processing or what terms version they accepted.

**Database Gap:** The `user` table lacks:

- `terms_accepted_at: timestamp`
- `terms_version: string`
- `privacy_policy_version: string`

**Recommendation:** Add consent tracking fields and log consent at signup.

---

### 14. Missing Attorney-Client Privilege Safeguards

**Risk Level:** High
**Category:** Legal Profession Ethics
**File:** `apps/api/src/do/tenant.ts`

No mechanism to mark conversations as privileged, generate privilege logs, or prevent inadvertent disclosure.

**Recommendation:**

- Add `is_privileged: boolean` flag to conversations
- Implement privilege log export
- Add warning when exporting data

---

### 15. Silent OAuth Token Deletion

**Risk Level:** High
**Category:** Service Reliability
**File:** `apps/api/src/do/tenant.ts:1096-1100`

When Clio token refresh fails, tokens are silently deleted without user notification or audit trail.

**Recommendation:**

- Log token invalidation to audit
- Store disconnection reason for user visibility
- Consider email notification

---

### 16. Non-Atomic GDPR Deletion

**Risk Level:** High
**Category:** GDPR Article 17
**File:** `apps/api/src/services/gdpr.ts:277-420`

`deleteUserData` performs multiple operations that can partially fail. D1 deletion is not transactional with Vectorize deletion.

**Recommendation:**

- Implement soft delete before hard deletion
- Create cleanup job for failed deletions
- Return detailed error report to user

---

### 17. Cross-Organization Data Leak Risk

**Risk Level:** High
**Category:** Multi-Tenancy / Data Isolation

Vectorize indexes are shared across organizations with `org_id` filtering. If filter is omitted, cross-org data leakage possible.

**Recommendation:**

- Audit all Vectorize query paths
- Add integration test verifying cross-org queries return empty
- Consider namespace isolation

---

### 18. Expired Confirmations Not Logged

**Risk Level:** Medium
**File:** `apps/api/src/do/tenant.ts:1462, 1781-1784`

Pending confirmations expire after 5 minutes and are silently deleted. No audit trail of expired confirmations.

**Recommendation:** Log expired confirmations with `result: "expired"` before deletion.

---

### 19. Incomplete PII Sanitization

**Risk Level:** Medium
**File:** `apps/api/src/lib/sanitize.ts`

Legal-specific fields missing from PII list: `matter_id`, `case_number`, `client_name`, `social_security`.

**Recommendation:** Expand PII_FIELDS to include legal-specific identifiers.

---

### 20. No Breach Notification Procedure

**Risk Level:** Medium
**Category:** Regulatory Compliance

No documented breach response procedure. GDPR requires 72-hour notification; some states require 24 hours.

**Recommendation:** Document breach response procedure with timelines.

---

### 21. Unauthorized Practice of Law Risk

**Risk Level:** Medium
**File:** `apps/api/src/do/tenant.ts:284`

System prompt says "NEVER give legal advice" but this is a soft control. LLM could hallucinate advice.

**Recommendation:**

- Add post-processing filter for legal advice patterns
- Include disclaimer in every response

---

### 22. Duplicate `requireAdmin` Patterns

**Category:** Complexity
**Files:** `apps/api/src/handlers/members.ts:31-44`, `apps/api/src/handlers/documents.ts:27-55`

Two different `requireAdmin` helpers exist with different return signatures.

**Recommendation:** Unify into single shared helper in `lib/session.ts`.

---

### 23. TenantDO is 1850 Lines

**Category:** Complexity
**File:** `apps/api/src/do/tenant.ts`

Single file handles message processing, Clio tokens, schema caching, audit logging, conversations, confirmations, user cleanup, and migrations.

**Recommendation:** Extract into focused modules:

- `do/tenant/clio.ts` - Token and schema operations
- `do/tenant/chat.ts` - Message processing and LLM
- `do/tenant/storage.ts` - SQLite operations
- `do/tenant/index.ts` - Router that delegates

---

### 24. Shared Package Provides Little Value

**Category:** Dead Code
**Files:** `packages/shared/src/types.ts`, `packages/shared/src/index.ts`

Only exports `User`, `Org`, and `UserRole`. The API has more comprehensive types.

**Recommendation:** Either populate with actual shared types or document its limited scope.

---

### 25. Unused Code

**Category:** Dead Code

- `Org.slug` field defined but never used in system
- `constantTimeEqual` in encryption.ts not used anywhere
- `R2Paths.archivedConversation` helper never imported

**Recommendation:** Remove unused code.

---

### 26. Session/Membership Lookup Repeated

**Category:** Flow Disruption
**Files:** All handlers in `apps/api/src/handlers/`

Every handler starts with same session/membership lookup pattern. This is middleware crying out for actual middleware.

**Recommendation:** Either adopt Hono router with middleware or create `withAuth` wrapper.

---

### 27. ChatGPT Channel Type Premature

**Category:** Scope Creep
**File:** `apps/api/src/types/index.ts:8`

`ChannelType` includes "chatgpt" but it's a Version 2 candidate.

**Recommendation:** Remove until Phase 14+ or document as reserved.

---

### 28. Magic Numbers

**Category:** Minor
**File:** `apps/api/src/do/tenant.ts`

Hardcoded values: `limit = 15`, `5 * 60 * 1000`, `30 * 24 * 60 * 60 * 1000`

**Recommendation:** Move to config file like `kb.ts` pattern.

---

### 29. Type Inconsistency

**Impact:** High
**Files:** `packages/shared/src/types.ts`, `apps/api/src/types/index.ts`

Shared package defines `UserRole = "owner" | "admin" | "member"` but API defines `OrgRole = "admin" | "member"`. Owner exists as boolean `isOwner`.

**Recommendation:** Unify role definitions and document the pattern.

---

### 30. Missing Error Boundaries in Web Routes

**Impact:** High
**Files:** `apps/web/app/routes/org.clio.tsx`, etc.

Routes fetch data but have limited error handling. When API calls fail, users see partial/incorrect UI.

**Recommendation:** Add explicit error states to loader data. Display error UI instead of "default" states.

---

### 31. No Integration Test Coverage for Web App

**Impact:** High
**File:** `apps/web/test/integration/auth.test.ts`

Auth test file is essentially a placeholder. No way to test routes without full app.

**Recommendation:** Add msw for API mocking. Create integration tests for critical flows.

---

### 32. Inconsistent Logging

**Impact:** Medium
**Files:** `apps/api/src/handlers/org.ts`, `apps/api/src/handlers/clio.ts`

Some handlers use structured logger, others use `console.error`.

**Recommendation:** Enforce structured logging everywhere.

---

### 33. Magic Strings for API Endpoints

**Impact:** Medium
**File:** `apps/web/app/lib/api.ts`

Endpoint URLs scattered throughout routes.

**Recommendation:** Create typed API client or `ENDPOINTS` constant object.

---

### 34. No Retry Logic in Web API Client

**Impact:** Medium
**File:** `apps/web/app/lib/api.ts`

No retry logic for network failures.

**Recommendation:** Add exponential backoff for 5xx errors (1-2 retries).

---

### 35. Repetitive Loader Auth Pattern

**Impact:** Medium
**File:** `apps/web/app/lib/loader-auth.ts`

Every protected route manually calls `requireAuth` and handles redirects.

**Recommendation:** Create `protectedLoader` higher-order function.

---

### 36. No Request ID Propagation

**Impact:** Medium
**Files:** `apps/api/src/lib/logger.ts`, `apps/web/`

API generates `requestId` but web app doesn't pass or receive it.

**Recommendation:** Generate requestId in web loader, pass in headers, return in response headers.

---

### 37. CSS Modules Without Design Tokens

**Impact:** Medium
**Files:** `apps/web/app/styles/*.css`

Colors, spacing, typography hardcoded in each file.

**Recommendation:** Create `tokens.css` with CSS variables.

---

### 38. Test Data Helpers Missing

**Impact:** Low
**Files:** `apps/api/test/`

Tests create data inline. No shared factory functions.

**Recommendation:** Create `test/factories.ts` with helper functions.

---

### 39. Environment Variable Documentation Gap

**Impact:** Low
**Files:** `apps/api/src/types/env.ts`, `apps/web/workers/app.ts`

No visible `.env.example` files documenting expected values.

**Recommendation:** Create `.env.example` files with placeholder values and comments.
