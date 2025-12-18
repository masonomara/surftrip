# Docket Development Plan

Each phase needs to have simple unit, integration (if applicable), and end-to-end testing, as well as a verbose component/example that demonstrates what was accomplished in each phase for shareholder demonstration.

## Phase 1: Validate Plan

Find 3-4 people to interview.

## Phase 2: Accounts & Project Init

**Overview:**

Got three accounts setup, Cloudlfare, CLio, and Teams. Cloudlfare was straightforward, Worker, DO, D1, R2, Vectorize, and AI all were configured, bound to the worker, accessibile from local and remote servers, and tests were created for them. Clio was also quite easy and auth endpoint is working. Cost ~$50 a month to keep a Clio account up and running. Teams was a bit mroe confusing. We initially planned on using developer accounts but that wasnt finaicnally feasible. We pivoted to using Agent Playground for intiial setup and validation and deferreda teams membership for end-to-end testing alter down the road.

**Checklist:**

- [ ] Cloudflare account created
- [ ] Wrangler CLI installed and authenticated
- [ ] D1 database created and bound
- [ ] R2 bucket created and bound
- [ ] Vectorize index created (768 dimensions, cosine metric)
- [ ] Workers AI binding configured
- [ ] Durable Object class declared
- [ ] All verification tests pass locally
- [ ] Clio developer application created
- [ ] Clio credentials stored in Wrangler secrets
- [ ] M365 Agents Playground installed
- [ ] Demo artifact deployed and shareable

**Files Created/Modified:**

## Phase 3: Storage Layer

Set up storage layer in Cloudflare:

- D1 database with migrations
- Vectorize index
- R2 bucket for Org Context docs, audit logs, archived conversations

## Phase 4: Auth Foundation

Setup Auth foundation:

- Better Auth setup with D1, factory function pattern for Workers runtime
- Channel identity linking (D1 `channel_user_links`)
- Invitation flow
- Key rotation mechanism
- GDPR deletion flow

## Phase 5: Knowledge Base

Create knowledge base:

- **BLOCKER:** Needs legal expert for actual knowledge base
- If can't get a legal expert, create fake knowledge base
- KB content: Clio workflows, deadline calculations, billing guidance, practice management.
- Buildtime script to:
  - Clear old kb_chunks, kb_formulas, kb_benchmarks
  - Read markdown from `/kb` directory
  - Chunk at ~500 chars
  - Generate embeddings via Workers AI
  - Insert to D1 + Vectorize

## Phase 6: Core Worker + Durable Object

Set up Cloudflare Worker and Durable Object:

- Set up bindings in `wrangler.jsonc`
- DO SQLite tables
- Channel Adapter routing (unified `ChannelMessage` format)
- ChannelMessage validation
- Workspace binding validation
- Permission enforcement in DO (not adapter)

## Phase 7: Workers AI + RAG

Set up Cloudflare Workers AI:

- Workers AI binding
- LLM inference
- Embedding model: `@cf/baai/bge-base-en-v1.5` (768 dimensions)
- RAG retrieval (parallel Vectorize queries for KB + Org Context)
- CUD confirmation expiry (5 min)

## Phase 8: Clio Integration

Set up Clio integration:

- Clio OAuth flow (PKCE, state signing)
- Token storage in DO Storage (AES-GCM encrypted)
- Schema caching in DO SQLite
- Schema refresh triggers
- `clioQuery` tool with structured params

## Phase 9: Website MVP

Create website MCP. Required before Teams (OAuth redirects, signup, Org Context upload):

- Auth UI (Better Auth)
- Org creation, member invitations
- Clio connect flow
- Org Context upload (R2 + chunking + Vectorize)
- Upload validation (MIME, 25MB, sanitize)
- Org Context delete/update flow

## Phase 10: Teams Adapter

Create Teams adapter and acquire real tenant for E2E testing:

- [ ] M365 Business Basic tenant ($6/mo)
- [ ] Custom app upload enabled in Teams admin
- [ ] Azure Bot resource created
- [ ] Teams credentials stored in Wrangler secrets

- Azure Bot registration (F0 free tier)
- Enable sideloading in Teams admin center
- Scaffold: `teams new typescript docket-teams --atk embed`
- Bot Framework integration
- Manifest with scopes (personal, groupChat, team)
- E2E testing in real Teams
- **Start finding business partners**

## Phase 11: Production Hardening

Prepare for first 10,000 users:

- Rate limiting (50 req/min per user IP via Cloudflare dashboard)
- Audit logging to R2 (hash-chained JSONL)
- Encryption verification (Clio tokens, at-rest)
- DO Alarms: archive >30d conversations, clean expired confirmations

## Phase 12: Compliance Review

Legal compliance before production:

- Legal counsel review (professional responsibility)
- Security audit (SOC 2)
- DPA with Cloudflare
- Disaster recovery procedures
- Data retention policy
- Breach notification procedure

## Phase 13: Teams App Store

List App in Teams App Store:

- AppSource listing with pricing
- Manifest `subscriptionOffer` in publisherId.offerId format
- Microsoft Teams Partner Center account

## Phase 14: MCP Channel

MCP server with stdio transport:

- API key auth via D1

---

## Version 2 Candidates

Features with technical breadth considered in Version 1:

- Industry Knowledge Bases — Criminal Defense, Immigration, etc. filtered by metafilter
- Location Knowledge Bases — Federal, State, etc. filtered by metafilter
- Slack Messaging
- ChatGPT Messaging
