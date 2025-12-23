# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Docket** is an AI case management bot for law firms and legal clinics using Clio. Users chat via Teams, Slack, or MCP clients. The bot accesses:

- **Knowledge Base** — shared case management best practices
- **Org Context** — firm-specific documents and procedures
- **Clio Schema** — cached Clio object definitions
- **Clio API** — executes queries and operations

**STATUS:** Phases 2-8 implemented: Cloudflare storage, auth, Knowledge Base, Durable Objects, Workers AI + RAG, and Clio integration. Starting Phase 9 (Website MVP)s

## Architecture

**Monorepo structure:**

- `apps/api` — Cloudflare Worker + Durable Object (TenantDO), handles messages, OAuth, LLM calls
- `apps/web` — React Router 7 on Cloudflare Pages, auth UI, settings
- `packages/shared` — Shared types and Zod schemas

**Data flow:** Chat Channel → Worker → TenantDO (per-org) → Workers AI + Clio API → Response

**Storage:**

- D1 (shared) — Auth, org registry, KB chunks
- Vectorize (shared, filtered by org_id) — KB + Org Context embeddings
- DO SQLite (per-org) — Conversations, messages, settings, Clio schema cache
- DO KV (per-org) — Encrypted Clio OAuth tokens
- R2 (per-org paths) — Audit logs, archived conversations

**Key files:**

- `apps/api/src/index.ts` — Worker entry + TenantDO class
- `apps/api/src/services/` — Clio OAuth/API, RAG retrieval, KB loading
- `apps/api/migrations/` — D1 schema migrations

## Documentation

- `/docs/00-specs/` — Source of truth (architecture, schemas, integrations)
- `/docs/01-10/` — Phase work artifacts
- `/src/` — Old MVP reference (patterns only, not source of truth)

## Conventions

**Abbreviations:** DO (Durable Object), KB (Knowledge Base)

**Terminology:** Use Title Case for named components (Knowledge Base, Org Context, Clio Schema, Durable Object, Workers AI). Use lowercase for generic terms (system prompt, embeddings). Prefer "organization" over "tenant".

**Doc prefixes:** `GEN` (AI-generated, ignore), `00` (ordering). Docs aim for <600 words.

## Known Issues

1. vitest-pool-workers SQLITE_AUTH - Cannot test DO SQLite in vitest
2. SSO Provider Tests (2) - Skipped, needs external OAuth

**Workarounds:**

- DO tests: Use `/demo/clio` endpoint for manual validation
- RAG integration: Set `INTEGRATION_TESTS_ENABLED=true` for live tests

## Coding Principles

Omit needless code. A file should have no unnecessary functions. Lower numbered docs are sources of truth over higher numbered ones.

Vigorous writing is concise. A line should contain no unnecessary characters, a file no unnecessary functions, for the same reason that a drawing should have no unnecessary lines and a machine no unnecessary parts. Happy talk must die. Instructions must die. Omit needless code.
Check consistency often between documents. Remove unnecessary interdependencies and relationships. Lower numbered documents serve as sources of truths over higher numbers documents.
