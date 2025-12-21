# Phase 7: Workers AI + RAG Implementation

## Source Analysis
- **Source Type**: Development plan checklist (docs/00-specs/10-development-plan.md)
- **Core Features**: LLM inference, RAG integration, CUD confirmation flow, clioQuery tool
- **Dependencies**: Workers AI (already bound), existing RAG retrieval service
- **Complexity**: Medium-high - integrates multiple existing components

## Current State Assessment

**Already Implemented (from prior phases):**
- Workers AI binding configured in wrangler.jsonc (`AI`)
- Embedding generation working (`@cf/baai/bge-base-en-v1.5`)
- RAG retrieval service (`src/services/rag-retrieval.ts`)
- TenantDO with SQLite tables for conversations, messages, pending_confirmations
- ChannelMessage type and validation
- Permission checking framework
- Graceful degradation on RAG failure

**Needs Implementation:**
- LLM inference with `@cf/meta/llama-3.1-8b-instruct`
- System prompt construction (KB + Org Context + Clio Schema + history)
- Context window management (~10K tokens)
- `clioQuery` tool definition and handling
- CUD confirmation flow (pending storage, prompt generation)
- Confirmation classification (approve/reject/modify/unrelated)
- Error code handling (3040, 3043 retry; 3036 fail; 5007 log)
- Demo endpoint for Phase 7

## Implementation Tasks

### Core LLM Service
- [x] Create `src/services/llm.ts` with Workers AI inference
- [x] Define clioQuery tool schema (object_type, operation, params)
- [x] Implement system prompt builder
- [x] Implement message formatting for LLM context

### CUD Confirmation Flow
- [x] Add confirmation creation to TenantDO (already has `_createPendingConfirmation`)
- [x] Implement confirmation lookup and classification
- [x] Handle approve/reject/modify/unrelated responses
- [x] Implement confirmation expiry check

### DO Integration
- [x] Update TenantDO.processMessage to use LLM service
- [x] Add RAG context retrieval in message processing
- [x] Add Clio schema loading for prompt
- [x] Implement error code retry logic

### Demo & Testing
- [x] Create Phase 7 demo page
- [x] Add demo route to index.ts
- [x] Unit tests for LLM service
- [x] Integration tests for full flow

## Validation Checklist
- [x] Workers AI binding configured
- [x] LLM inference working
- [x] Embedding generation working
- [x] RAG retrieval integrated
- [x] System prompt construction complete
- [x] Context window management implemented
- [x] clioQuery tool defined
- [x] CUD confirmation flow working
- [x] Confirmation classification working
- [x] Error code handling implemented
- [x] Graceful degradation verified
- [x] Unit tests passing
- [x] Integration tests passing
- [x] Demo endpoint deployed

## Files to Create/Modify

**New Files:**
- `src/services/llm.ts` - LLM inference service
- `src/demo/llm.ts` - Phase 7 demo page
- `test/llm.spec.ts` - LLM service tests

**Modified Files:**
- `src/services/tenant-do.ts` - Integrate LLM processing
- `src/demo/index.ts` - Export Phase 7 demo builder
- `src/index.ts` - Add demo route
