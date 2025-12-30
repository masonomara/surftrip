# Docket

An AI assistant for law firms that use Clio. Users chat through the web interface, Microsoft Teams, Slack, or MCP clients. The bot can answer questions about cases, look up firm procedures, and execute operations in Clio.

## How It Works

```text
User → Chat Channel → Worker → Durable Object → AI + Clio → Response
```

Each organization gets its own Durable Object that manages conversations, settings, and Clio credentials. The Worker routes incoming messages to the right org's DO.

## Storage

| Store     | Scope             | Contents                                             |
| --------- | ----------------- | ---------------------------------------------------- |
| D1        | Shared            | Auth, org registry, Knowledge Base chunks            |
| Vectorize | Shared (filtered) | Embeddings for KB and org documents                  |
| DO SQLite | Per-org           | Conversations, messages, settings, Clio schema cache |
| DO KV     | Per-org           | Encrypted Clio OAuth tokens                          |
| R2        | Per-org paths     | Uploaded documents, audit logs                       |

## Getting Started

```bash
git clone <repo-url>
cd docket
npm install
```

Copy the example env files:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/web/.dev.vars.example apps/web/.dev.vars
```

Create a `.env` file for the web app (Vite uses `.env`, Wrangler uses `.dev.vars`):

```bash
echo "VITE_API_URL=http://localhost:8787" > apps/web/.env
```

Edit `apps/api/.dev.vars` with your Clio credentials and secrets.

Run the API and web app in separate terminals:

```bash
npm run dev:api   # http://localhost:8787
npm run dev:web   # http://localhost:5173
```

## Running Tests

```bash
npm test                    # Unit tests (all packages)
npm run test:e2e            # End-to-end tests
npm run test:all            # Both

# Web app specific
cd apps/web
npm test                    # Unit tests
npm run test:integration    # Integration tests (requires API running)
npm run test:e2e            # Playwright E2E tests
npm run test:e2e:ui         # Playwright with interactive UI
```

Integration tests require the API server running on `localhost:8787`.

### E2E Testing with Authentication

E2E tests use Playwright. Tests requiring authentication use **storage state** — a saved browser session that skips login:

```bash
cd apps/web

# 1. Generate auth state (login manually, state saved to .auth/)
npx playwright test --project=setup

# 2. Run authenticated tests
npm run test:e2e
```

The setup project logs in once and saves cookies/localStorage to `.auth/user.json`. Subsequent tests load this state to skip login.

**Test structure:**

- `test/e2e/auth-and-org.spec.ts` — Signup, org creation, member invitation flows
- `playwright.config.ts` — Test configuration with setup project

## Deployment

```bash
# Deploy API (api.docketadmin.com)
cd apps/api && wrangler deploy

# Deploy Web (docketadmin.com)
cd apps/web && npm run build && wrangler deploy --env production
```

## Database Migrations

```bash
cd apps/api

# Local development
npx wrangler d1 migrations apply docket-db --local

# Production
npx wrangler d1 migrations apply docket-db --remote
```

## User Roles

- **Owner** — Full Clio access, can manage the organization and transfer ownership
- **Admin** — Full Clio access, can manage settings and invite users
- **Member** — Read-only Clio access, no org management

## Documentation

Detailed specs are in `/docs/00-specs/`:

- `00-overview` — Product overview
- `01-user-flows` — User journeys
- `02-technical-foundation` — Architecture
- `03-storage-schemas` — Database schemas
- `04-auth` — Authentication
- `05-channel-adapter` — Teams/Slack/MCP adapters
- `06-durable-objects` — Per-org state
- `07-knowledge-base` — RAG implementation
- `08-workers-ai` — LLM integration
- `09-clio-integration` — Clio API
- `10-development-plan` — Development phases
- `12-web-chat-interface` — Web chat interface

## Tech Stack

Cloudflare Workers, Durable Objects, D1, Vectorize, R2, Workers AI (Llama 3.1), React Router 7, TypeScript, Zod, Drizzle ORM, Better Auth.
