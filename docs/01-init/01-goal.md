# Surftrip.com

## Context

This is a take-home technical interview for Spotnana. The full assessment spec is in `docs/01-init/00-technical-assessment.md`. The job description is in `docs/01-init/00-job-description.md`.

The app is a **surf trip planning assistant**. The user describes a destination and travel dates, and the AI researches surf conditions, breaks, costs, and logistics — then stays in the conversation to answer follow-up questions. It is modeled after a prior project called Docket, specifically its streaming chat interface and process log.

---

## What Docket Was

**Reference implementation: [github.com/masonomara/docket](https://github.com/masonomara/docket)**

When planning or implementing any feature in Surftrip, check Docket first. It is the canonical reference for how streaming chat, the process log, conversation history, auth, and the overall app shell were built. Paste the relevant file(s) from Docket alongside any plan request — Claude works dramatically better with a concrete reference implementation than designing from scratch.

Docket was a legal AI assistant built on a Cloudflare-native monorepo:

- **API:** Cloudflare Worker + Better Auth + Cloudflare D1 (SQLite via Drizzle) + Cloudflare Durable Objects (one `TenantDO` per org, with its own SQLite storage) + Cloudflare R2 + Cloudflare Vectorize + Cloudflare AI binding
- **Web:** React Router v7 deployed to Cloudflare Pages, with a Cloudflare service binding for zero-latency worker-to-worker calls

Docket was multi-tenant (one org = one Durable Object instance), connected to the Clio legal API, had RAG retrieval over a knowledge base, org-level context documents, team and member management, pending confirmations for write operations, and an audit log written to R2.

The two things worth keeping from Docket are:

1. **The `useChat` hook** — optimistic message display, SSE parsing, streaming state, process event collection, error recovery
2. **The process log** — a right-hand panel that shows what the AI is actually doing step by step as it generates a response. This is a meaningful differentiator.

Everything else — Clio, RAG, multi-tenancy, Durable Objects, R2, Vectorize, org management, team management, user settings, Cloudflare AI — gets cut.

---

## Architecture Decision: Supabase + Vercel (not Cloudflare)

### What was considered

**Option A: Keep Cloudflare (D1 + Better Auth, monorepo)**

The existing auth infrastructure (Better Auth, Drizzle, D1 schema) would carry over. The Worker SSE streaming already works. Stripping the project would mean:

- Replacing the Cloudflare AI binding with direct OpenAI calls
- Removing all Clio, RAG, org, and membership logic
- Simplifying or removing the TenantDO (conversation history could move to D1 directly)
- Keeping React Router v7 and Cloudflare Pages

This is less rebuild work on paper, but comes with real costs:

- Wrangler setup is not beginner-friendly for a public repo. An evaluator cloning the repo needs a Cloudflare account, Wrangler installed, a D1 database created, migrations applied, and secrets bound before running anything locally.
- Cloudflare Durable Objects require a paid Cloudflare plan.
- The assessment explicitly lists "React, Angular, Vue or NextJS" — React Router on CF Pages is a legitimate choice but a non-standard one that reads as avoiding the list.
- Evaluators shouldn't need to understand `wrangler.jsonc`, D1 binding names, or DO migration tags to run a take-home.

**Option B: Supabase + Vercel (chosen)**

Full stack rebuild targeting the simplest possible evaluator experience and the cleanest possible code.

### Why Supabase + Vercel

**1. The assessment lists NextJS explicitly.**
Next.js (App Router) is the canonical answer for "React + server + AI" in 2025. It pairs with Vercel natively. Using it is the expected professional choice for this role.

**2. The evaluator experience is the deciding constraint.**
This is a public GitHub repo with a README. The evaluator needs to clone and run it. The setup story on Supabase + Vercel is:

```
1. Clone repo
2. Create a free Supabase project → copy URL + anon key
3. Get an OpenAI API key
4. cp .env.example .env.local → fill in 3 values
5. npm install && npm run dev
```

That is it. No Wrangler, no Cloudflare account, no D1 migration commands, no DO class registration.

**3. Vercel AI SDK is purpose-built for this use case.**
The `streamText` function with the data stream protocol handles OpenAI streaming and lets API routes emit custom data events alongside the AI text in the same response. The process log maps directly onto this: the route streams `type: "process"` data events before and during the AI generation, and the client reads them in the same SSE stream as the content chunks.

**4. Supabase Auth is dramatically simpler.**
Better Auth in Docket required: PBKDF2 password hashing implementation, Drizzle adapter configuration, email verification middleware, social provider config, cross-subdomain cookie configuration, a before/after hook for email normalization and auth failure logging. Supabase Auth handles all of this with a hosted service and a 5-line client setup. For a take-home, the auth should be invisible — it is not what is being evaluated.

**5. Supabase Postgres with RLS is the right fit.**
Conversation and message history is relational data. A `conversations` table and a `messages` table with a foreign key and a `user_id` column secured by Row Level Security is the cleanest possible model. Supabase handles the RLS policies at the database layer so the API routes don't need to manually guard user data.

**6. One-click Vercel deploy.**
The README can include a deploy button and a live demo URL. The evaluator can see the running app without any local setup.

---

## Stack

| Layer      | Technology                           | Why                                                                                            |
| ---------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Framework  | Next.js 15 (App Router)              | Listed in assessment, Vercel-native, App Router handles server components + API routes cleanly |
| Auth       | Supabase Auth                        | Hosted auth, email/password + social, SSR-compatible with `@supabase/ssr`                      |
| Database   | Supabase Postgres                    | Conversation + message history, RLS for user isolation                                         |
| AI         | OpenAI API via Vercel AI SDK         | `streamText` + data stream for process log events, keys stay server-side                       |
| Deployment | Vercel                               | Zero-config Next.js deploy, environment variables in dashboard                                 |
| Styling    | CSS Modules (carry over from Docket) | Already written, readable, no build config needed                                              |

---

## Application Structure

```
surftrip/
├── app/
│   ├── (auth)/                  # Login, signup, password reset
│   ├── (app)/
│   │   ├── layout.tsx           # App shell: conversation sidebar + main area + process log
│   │   ├── page.tsx             # New conversation redirect
│   │   └── chat/
│   │       └── [id]/
│   │           └── page.tsx     # Conversation view: messages + input
│   └── api/
│       └── chat/
│           └── route.ts         # POST handler: validates input, calls OpenAI, streams response + process events
├── components/
│   ├── ChatMessages.tsx
│   ├── ChatInput.tsx
│   ├── ProcessLog.tsx
│   └── ConversationSidebar.tsx
├── lib/
│   ├── use-chat.ts              # Streaming hook: SSE parsing, optimistic display, process event state
│   ├── supabase/
│   │   ├── client.ts            # Browser-side Supabase client
│   │   └── server.ts            # Server-side Supabase client (for API routes + server components)
│   └── types.ts
└── supabase/
    └── migrations/
        └── 0001_init.sql        # conversations + messages tables + RLS policies
```

---

## Data Model

```sql
-- conversations: one row per chat session
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,                         -- auto-generated from first message
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- messages: one row per turn
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

-- RLS: users can only see their own data
alter table conversations enable row level security;
alter table messages enable row level security;

create policy "users own their conversations"
  on conversations for all
  using (auth.uid() = user_id);

create policy "users own their messages"
  on messages for all
  using (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );
```

---

## API Route: POST /api/chat

The single most important server-side file. It:

1. Validates the session (rejects unauthenticated requests — API key never touches the client)
2. Validates input (empty check, max 10,000 character limit)
3. Loads conversation history from Supabase
4. Emits process log events to the data stream as it works
5. Calls `streamText` with the surftrip system prompt and full conversation history
6. Saves the completed assistant message to Supabase after the stream ends
7. Returns the stream — the client reads it with the Vercel AI SDK `useChat` hook or the custom `useChat` from Docket

The process log events are emitted as custom data objects in the Vercel AI SDK data stream, readable on the client via `data` from `useChat`. This replaces the custom SSE `event: process` mechanism from Docket with the SDK's built-in protocol.

**Docket reference for the chat handler:** [`apps/api/src/handlers/chat.ts`](https://github.com/masonomara/docket/blob/main/apps/api/src/handlers/chat.ts)
**Docket reference for the Durable Object (message storage + streaming):** [`apps/api/src/do/tenant.ts`](https://github.com/masonomara/docket/blob/main/apps/api/src/do/tenant.ts)

---

## What Carries Over From Docket

All Docket source is at [github.com/masonomara/docket](https://github.com/masonomara/docket). When implementing any of the items below, open the linked file and use it as the reference implementation.

| Docket component | Docket file | Surftrip equivalent |
| --- | --- | --- |
| `useChat` hook (SSE parsing, optimistic display, streaming state) | [`apps/web/app/lib/use-chat.ts`](https://github.com/masonomara/docket/blob/main/apps/web/app/lib/use-chat.ts) | Adapted to Vercel AI SDK data stream |
| `ProcessLog` component + `ProcessLogEvent` rendering | [`apps/web/app/routes/_app.chat.$conversationId.tsx`](https://github.com/masonomara/docket/blob/main/apps/web/app/routes/_app.chat.%24conversationId.tsx) | Kept with surftrip-relevant event types |
| `ChatInput` (auto-resize textarea, Enter to send, disabled while streaming) | [`apps/web/app/routes/_app.chat.$conversationId.tsx`](https://github.com/masonomara/docket/blob/main/apps/web/app/routes/_app.chat.%24conversationId.tsx) | Kept verbatim |
| `ChatMessages` (optimistic user message, streaming cursor `▊`, error state) | [`apps/web/app/routes/_app.chat.$conversationId.tsx`](https://github.com/masonomara/docket/blob/main/apps/web/app/routes/_app.chat.%24conversationId.tsx) | Kept verbatim |
| Conversation sidebar (list of past conversations, active state) | [`apps/web/app/routes/_app.chat.tsx`](https://github.com/masonomara/docket/blob/main/apps/web/app/routes/_app.chat.tsx) | Kept, backed by Supabase query |
| App shell layout (sidebar + main + process log panel) | [`apps/web/app/components/AppLayout.tsx`](https://github.com/masonomara/docket/blob/main/apps/web/app/components/AppLayout.tsx) | Adapted for Next.js layout |
| Chat CSS Modules + design tokens | [`apps/web/app/styles/chat.module.css`](https://github.com/masonomara/docket/blob/main/apps/web/app/styles/chat.module.css), [`global.css`](https://github.com/masonomara/docket/blob/main/apps/web/app/styles/global.css) | Carried over directly |
| Input validation pattern (empty, max length, isLoading guard) | [`apps/web/app/lib/use-chat.ts`](https://github.com/masonomara/docket/blob/main/apps/web/app/lib/use-chat.ts) | Kept |
| `fetchWithRetry` exponential backoff | [`apps/web/app/lib/api.ts`](https://github.com/masonomara/docket/blob/main/apps/web/app/lib/api.ts) | Kept for non-streaming requests |

---

## What Gets Cut

- Cloudflare Workers, Wrangler, D1, Durable Objects, R2, Vectorize, AI binding
- Better Auth (replaced by Supabase Auth)
- Drizzle ORM and D1 schema
- All Clio API integration (OAuth, schema, tools, API calls)
- RAG retrieval (Vectorize embeddings, knowledge base, org context documents)
- Multi-tenant architecture (org, org_members, org_settings)
- Pending confirmations and write operation flow
- Team and member management
- Cloudflare service binding (worker-to-worker calls)
- Audit logging to R2

---

## Assessment Requirements Checklist

| Requirement                      | Implementation                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Prompt input + submit button     | `ChatInput` component with auto-resize textarea and ArrowUp button               |
| Fetch from OpenAI                | `POST /api/chat` route using `streamText` from Vercel AI SDK                     |
| Display results dynamically      | Optimistic user message + streaming assistant message with `▊` cursor            |
| Error handling                   | try/catch in `useChat`, error state displayed above input, input re-enabled      |
| Loading states                   | `isStreaming` state disables input + button; streaming cursor visible in message |
| Save and show chat history (+10) | Supabase Postgres `conversations` + `messages` tables, sidebar lists past chats  |
| Clear button (+10)               | Deletes conversation from Supabase + clears client state                         |
| Public GitHub repo               | Required                                                                         |
| README with setup instructions   | `.env.example`, 5-step setup, Vercel deploy button                               |

---

## Phase Two (Once Scaffolding is complete)

- Replace the static process log with live tool calls: web search, swell forecast APIs (NOAA, Surfline), flight/hotel pricing APIs
- OpenAI function calling / tool use for structured data retrieval
