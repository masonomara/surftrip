# Docket

An AI case management assistant for law firms and legal clinics using Clio. Users chat via Microsoft Teams, Slack, or MCP clients. The bot accesses a shared Knowledge Base, organization-specific context, and executes Clio operations.

**Status:** Phase 8 Complete — Clio integration functional

## How It Works

```text
User → Chat Channel → Worker → Durable Object → AI + Clio → Response
```

The bot draws from three context sources:

- **Knowledge Base** — Shared case management best practices
- **Org Context** — Firm-specific procedures and documents
- **Clio Schema** — Cached API structure with custom fields

## Architecture

```mermaid
flowchart TB
    subgraph Channels["Client Channels"]
        Teams["Microsoft Teams"]
        Slack["Slack"]
        MCP["MCP Clients"]
    end

    subgraph CF["Cloudflare Worker"]
        subgraph Adapters["Channel Adapters"]
            TeamsAdapter["Teams Adapter"]
            SlackAdapter["Slack Adapter"]
            MCPAdapter["MCP Adapter"]
        end
        Router["Router + Auth"]
    end

    subgraph DO["Durable Object · per-org"]
        Core["Core Logic<br/>(RAG, LLM, Tools)"]
        subgraph DOStore["DO Storage"]
            SQLite["SQLite<br/>conversations, messages,<br/>settings, schema cache"]
            KV["KV Storage<br/>encrypted Clio tokens"]
        end
    end

    subgraph Shared["Shared Services"]
        D1["D1 Database<br/>auth, orgs, KB chunks"]
        Vectorize["Vectorize<br/>KB + Org Context embeddings"]
        R2["R2 Storage<br/>docs, audit logs, archives"]
    end

    subgraph External["External"]
        AI["Workers AI<br/>Llama 3.1 · BGE"]
        Clio["Clio API"]
    end

    Teams --> TeamsAdapter
    Slack --> SlackAdapter
    MCP --> MCPAdapter

    TeamsAdapter --> Router
    SlackAdapter --> Router
    MCPAdapter --> Router

    Router -->|"user → org lookup"| D1
    Router -->|"ChannelMessage"| Core

    Core --> SQLite
    Core --> KV
    Core -->|"vector search"| Vectorize
    Core -->|"embed + generate"| AI
    Core -->|"OAuth calls"| Clio
    Core -->|"audit, docs"| R2
```

## Storage

- **D1** (shared) — Auth, org registry, KB chunks, subscriptions
- **Vectorize** (shared, filtered by org_id) — KB + Org Context embeddings
- **DO SQLite** (per-org) — Conversations, messages, settings, Clio schema
- **DO KV** (per-org) — Encrypted Clio OAuth tokens
- **R2** (per-org, path-isolated) — Org Context docs, audit logs, archives

## User Roles

- **Owner** — Full Clio access (with confirmation), full org management + ownership transfer
- **Admin** — Full Clio access (with confirmation), settings, Org Context, invites
- **Member** — Read-only Clio queries, no org management

## Documentation

Specs live in `/docs/00-specs`. Phase work artifacts in `/docs/01-10`.

- [00-overview](./docs/00-specs/00-overview.md) — Product overview
- [01-user-flows](./docs/00-specs/01-user-flows.md) — User journeys
- [02-technical-foundation](./docs/00-specs/02-technical-foundation.md) — Multi-tenant architecture
- [03-storage-schemas](./docs/00-specs/03-storage-schemas.md) — Database schemas
- [04-auth](./docs/00-specs/04-auth.md) — Authentication
- [05-channel-adapter](./docs/00-specs/05-channel-adapter.md) — Teams/Slack/MCP adapters
- [06-durable-objects](./docs/00-specs/06-durable-objects.md) — Per-org state management
- [07-knowledge-base](./docs/00-specs/07-knowledge-base.md) — RAG implementation
- [08-workers-ai](./docs/00-specs/08-workers-ai.md) — LLM integration
- [09-clio-integration](./docs/00-specs/09-clio-integration.md) — Clio API

## Tech Stack

Cloudflare Workers, Durable Objects (SQLite + KV), D1, Vectorize, R2, Workers AI (Llama 3.1 8B), React Router 7, TypeScript, Zod, Drizzle ORM, Better Auth.

## Contributing

`/docs/00-specs` is the source of truth. Omit needless code.
