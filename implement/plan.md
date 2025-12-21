# Implementation Plan - Phase 6: Core Worker + Durable Object

## Source Analysis
- **Source Type**: Development plan checklist + specs
- **Core Features**: DO-based message processing, channel adapter routing, permission enforcement, audit logging
- **Dependencies**: Existing TenantDO, D1 schema, R2 paths, org-membership services
- **Complexity**: Medium-high (extends existing DO with new endpoints and validation logic)

## Target Integration
- **Integration Points**: TenantDO class, index.ts routing, org-membership services
- **Affected Files**: `src/index.ts`, `src/services/tenant-do.ts` (new), `test/tenant-do.spec.ts` (new)
- **Pattern Matching**: Follow existing service patterns, vitest testing conventions

## Current State Analysis

### Already Complete (from wrangler.jsonc)
- [x] DO bindings configured (`TENANT` → `TenantDO`)
- [x] DO SQLite migration pattern in constructor with `blockConcurrencyWhile()`
- [x] `PRAGMA user_version` for migration tracking
- [x] DO SQLite tables exist (conversations, messages, pending_confirmations, org_settings, clio_schema_cache)
- [x] Audit logging to R2 implemented

### Needs Implementation
- [ ] One DO per organization (DO ID = org identity enforcement)
- [ ] DO derives `orgId` from DO ID, rejects mismatched `ChannelMessage.orgId`
- [ ] `ChannelMessage` interface definition
- [ ] `POST /process-message` endpoint in DO
- [ ] Channel Adapter routing (unified format)
- [ ] ChannelMessage validation
- [ ] Workspace binding validation (D1 lookup)
- [ ] Conversation isolation per `conversationId`
- [ ] Permission enforcement in DO (role check before LLM, log unauthorized attempts)
- [ ] Error responses (friendly messages)
- [ ] User leaves org: expire `pending_confirmations`, delete Clio token from DO Storage
- [ ] Org deletion: delete DO instance (SQLite + Storage)
- [ ] GDPR: DO purges user's conversations/messages
- [ ] Unit tests
- [ ] Integration tests
- [ ] Demo endpoint

## Implementation Tasks

### 1. Define ChannelMessage Interface
- [ ] Create `src/types/channel.ts` with ChannelMessage interface
- [ ] Export from index for use by channel adapters

### 2. Extract TenantDO to Separate Service File
- [ ] Move TenantDO class to `src/services/tenant-do.ts`
- [ ] Keep exports in `src/index.ts` for Cloudflare binding
- [ ] Add ChannelMessage processing logic

### 3. Implement org Identity Enforcement
- [ ] DO derives `orgId` from `this.ctx.id.toString()`
- [ ] Validate incoming `ChannelMessage.orgId` matches DO identity
- [ ] Reject mismatched requests with 403

### 4. Implement POST /process-message Endpoint
- [ ] Parse and validate ChannelMessage
- [ ] Check workspace binding via D1 (passed through env)
- [ ] Enforce user permissions based on role
- [ ] Store/retrieve conversation history by conversationId
- [ ] Return structured response

### 5. Conversation Isolation
- [ ] Ensure messages are keyed by conversationId
- [ ] Load last 15 messages for context window
- [ ] Store new message with proper conversation reference

### 6. Permission Enforcement
- [ ] Check role_permissions matrix before operations
- [ ] Log unauthorized attempts to audit
- [ ] Return denial message for unauthorized actions

### 7. User Lifecycle Handlers
- [ ] `POST /user-leave` - expire pending_confirmations, clear Clio token
- [ ] `POST /gdpr-purge` - delete user's conversations/messages
- [ ] `DELETE /` - org deletion (delete DO instance)

### 8. Channel Adapter Routing in Worker
- [ ] Add `/do/:orgId/process-message` route
- [ ] Validate org exists in D1
- [ ] Get DO stub by org ID
- [ ] Forward request to DO

### 9. Error Response Handling
- [ ] Friendly error messages for common failures
- [ ] Clio-specific error mapping
- [ ] Connection trouble fallback message

### 10. Demo Endpoint
- [ ] Create `/demo/tenant-do` page
- [ ] Show DO routing, message processing, conversation isolation
- [ ] Interactive test interface

### 11. Tests
- [ ] Unit tests for ChannelMessage validation
- [ ] Unit tests for permission enforcement
- [ ] Unit tests for conversation isolation
- [ ] Integration tests for full message flow
- [ ] Tests for user lifecycle operations

## Validation Checklist
- [ ] All features implemented
- [ ] Tests written and passing
- [ ] No broken functionality
- [ ] Documentation updated (development-plan.md checkboxes)
- [ ] Integration points verified
- [ ] Demo endpoint accessible

## Risk Mitigation
- **Potential Issues**: D1 access from DO requires passing through worker; DO storage KV for tokens not yet implemented
- **Rollback Strategy**: Git commits at logical checkpoints
- **Deferred Items**: Actual LLM invocation (Phase 7), Clio operations (Phase 8)
