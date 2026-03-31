# Surftrip.com — Technology Research

This document covers findings from deep-reading the project spec and researching the stack via current documentation. It is the reference for all implementation decisions before a line of code is written.

---

## What Surftrip Is

A surf trip planning assistant built as a Spotnana take-home technical assessment. The user describes a destination and travel dates; the AI researches surf conditions, breaks, costs, and logistics, then stays in the conversation to answer follow-up questions.

The technical bar for the assessment is:

- Prompt input + submit button
- Fetch from OpenAI
- Display results dynamically
- Error handling and loading states
- **Bonus:** Chat history + clear button

The product bar — the differentiator — is:

- Streaming response with optimistic display
- **Process log:** a right-hand panel showing what the AI is doing step by step as it generates

The app is modeled after Docket (a prior project). The two things carried over from Docket are the `useChat` hook pattern and the process log UI. Everything else is rebuilt from scratch on a simpler stack.

---

## Stack

| Layer      | Choice                   | Reason                                                                                                                    |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Framework  | Next.js 15 (App Router)  | Listed in the assessment. Canonical answer for React + server + AI in 2025. Vercel-native.                                |
| Auth       | Supabase Auth            | Hosted, email/password + social, SSR-compatible via `@supabase/ssr`. Zero boilerplate.                                    |
| Database   | Supabase Postgres        | Conversation + message history. RLS for user isolation at the DB layer.                                                   |
| AI         | OpenAI via Vercel AI SDK | `streamText` handles streaming. `onFinish` saves messages. Data stream carries process log events. Keys stay server-side. |
| Deployment | Vercel                   | Zero-config Next.js deploy. Deploy button in README for evaluator.                                                        |
| Styling    | CSS Modules              | Carries over from Docket. No build config.                                                                                |

---

## Next.js 15 — App Router

### Route Handlers

API logic lives in `app/api/*/route.ts` files exporting named HTTP methods:

```ts
export async function POST(request: Request) {}
```

Route Handlers replaced `pages/api/` entirely. They use standard Web `Request`/`Response` APIs — no Express-style `req`/`res`. This matters because the Vercel AI SDK returns a standard `Response` object from `result.toUIMessageStreamResponse()`, which a Route Handler can return directly.

### Streaming

Next.js Route Handlers support streaming natively via the Web Streams API (`ReadableStream`). The Vercel AI SDK plugs into this directly — `streamText` produces a stream; `toUIMessageStreamResponse()` wraps it in a `Response` the Route Handler returns.

### Layouts

App Router layouts are persistent across route changes. The app shell — conversation sidebar on the left, main chat area in the center, process log panel on the right — is defined once in `app/(app)/layout.tsx` and stays mounted as the user navigates between conversations. This is important: the sidebar and process log do not remount on each page transition.

### Server Components

Server Components fetch data before rendering and pass it as props. The conversation list in the sidebar and the initial message history in a chat view are both good candidates for server-side fetches. Server Components cannot use React hooks or browser APIs — interactive pieces (input, streaming state) must be Client Components marked with `'use client'`.

### `cookies()` from `next/headers`

The server-side Supabase client reads the session from cookies. In Next.js 15, `cookies()` is async:

```ts
import { cookies } from "next/headers";
const cookieStore = await cookies();
```

This is a Next.js 15 change from v14 — `cookies()` returns a Promise and must be awaited.

---

## Vercel AI SDK

The AI SDK is the most important technical piece to understand well. It handles everything between the OpenAI API and the client.

### Core: `streamText`

```ts
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = streamText({
  model: openai("gpt-4o"),
  system: "...",
  messages: coreMessages,
  onFinish: async ({ response }) => {
    // Save completed messages to DB here
    await saveMessages(response.messages);
  },
});

return result.toUIMessageStreamResponse();
```

`streamText` is non-blocking — it starts the stream and returns immediately. The `onFinish` callback fires after the stream ends. This is where DB writes happen: the client is already reading the stream while the server simultaneously prepares to save.

`toUIMessageStreamResponse()` returns a standard `Response` with the Vercel AI SDK data stream protocol. The client reads this with `useChat` from `@ai-sdk/react`.

### Message Persistence Pattern

The SDK provides `convertToModelMessages` to convert `UIMessage[]` (client-side format, which includes parts) to `CoreMessage[]` (what the model API expects):

```ts
import { convertToModelMessages, streamText, UIMessage } from "ai";

export async function POST(req: Request) {
  const { messages, chatId }: { messages: UIMessage[]; chatId: string } =
    await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages: await convertToModelMessages(messages),
    onFinish: ({ messages: responseMessages }) => {
      saveChat({ chatId, messages: responseMessages });
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ messages }) => {
      saveChat({ chatId, messages });
    },
  });
}
```

The pattern: send the full message history from the client on each request, convert it for the model, stream the response, save on finish. Supabase is the storage layer.

### Custom Data Parts — The Process Log

This is the mechanism that makes the process log work. The AI SDK data stream can carry custom typed data alongside the AI text, all in the same response.

**Server: emitting process events**

Using `createDataStreamResponse` with a writer:

```ts
import { createDataStreamResponse, streamText } from "ai";

export async function POST(req: Request) {
  return createDataStreamResponse({
    execute: async (writer) => {
      // Emit a process step before the AI call
      writer.write({
        type: "data-process",
        data: { step: "Researching surf conditions at destination..." },
        transient: true, // Won't be added to message history
      });

      const result = streamText({
        model: openai("gpt-4o"),
        messages,
      });

      result.mergeIntoDataStream(writer);
    },
  });
}
```

The `transient: true` flag means the event is delivered to the client but not stored in the message history. Perfect for process log steps — they're real-time feedback, not part of the conversation record.

**Client: receiving process events**

```ts
import { useChat } from "@ai-sdk/react";

const [processSteps, setProcessSteps] = useState<string[]>([]);

const { messages, input, handleInputChange, handleSubmit } = useChat({
  api: "/api/chat",
  onData: (dataPart) => {
    if (dataPart.type === "data-process") {
      setProcessSteps((prev) => [...prev, dataPart.data.step]);
    }
  },
});
```

The `onData` callback fires for every data part as it arrives. Transient parts only appear here — they are never in `message.parts`. This separation is clean: the process log state lives in component state and resets per turn; the message history is authoritative in Supabase.

### `useChat` from `@ai-sdk/react`

The SDK's `useChat` hook manages the full client-side state:

```ts
const {
  messages, // UIMessage[] — full conversation history
  input, // string — current input value
  handleInputChange,
  handleSubmit, // fires the POST to /api/chat
  isLoading, // true while streaming
  error, // Error | undefined
  stop, // abort the stream
} = useChat({
  api: "/api/chat",
  onData: (dataPart) => {
    /* process log events */
  },
  onError: (err) => {
    /* show error UI */
  },
});
```

`isLoading` is true from submit until the stream ends. This drives the disabled state on the input and button.

Optimistic display: the user's message appears in `messages` immediately when submitted — before the server responds. This is built into `useChat` — no manual optimistic update needed.

The streaming cursor (`▊`) is rendered by checking `isLoading` on the last message.

### Type Safety for Custom Data Parts

To get typed `dataPart` in `onData`, define custom message types:

```ts
// lib/types.ts
import { UIMessage } from "ai";

export type ProcessDataPart = {
  type: "data-process";
  data: { step: string };
};

export type SurftripMessage = UIMessage & {
  parts: (UIMessage["parts"][number] | ProcessDataPart)[];
};
```

---

## Supabase

### Auth — SSR with Next.js

Supabase Auth in a Next.js App Router app requires two clients:

**Browser client** (for client components, auth UI):

```ts
// lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

**Server client** (for route handlers and server components):

```ts
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore if middleware refreshes sessions
          }
        },
      },
    },
  );
}
```

The try/catch in `setAll` is intentional: Server Components are read-only after rendering, so cookie writes will throw. The middleware (below) is responsible for actually writing refreshed session cookies.

### Middleware — Session Refresh

Every request must pass through Next.js middleware to refresh the Supabase session token. Without this, users get randomly logged out.

```ts
// middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: Do not add code between createServerClient and getClaims()
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // IMPORTANT: always return supabaseResponse (not a new NextResponse)
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

Critical notes:

- Do not create any new `NextResponse` objects without copying over the cookies from `supabaseResponse`. The middleware synchronizes browser and server cookie state.
- Use `supabase.auth.getClaims()`, not `getUser()`, in middleware. `getUser()` hits the Supabase Auth server on every request — `getClaims()` reads the JWT locally.

### Email/Password Auth

Sign up:

```ts
const { data, error } = await supabase.auth.signUp({
  email,
  password,
});
```

Sign in:

```ts
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});
```

Sign out:

```ts
await supabase.auth.signOut();
```

For the API route handler, validate the session before touching OpenAI:

```ts
const supabase = await createClient();
const {
  data: { user },
} = await supabase.auth.getUser();
if (!user) return new Response("Unauthorized", { status: 401 });
```

Use `getUser()` (not `getClaims()`) in route handlers — route handlers are not middleware, and `getUser()` validates the token against Supabase Auth server for security-critical operations.

### Row Level Security

RLS ensures users can only read/write their own data. The policies use `auth.uid()` which resolves to the `sub` claim of the JWT Supabase injects into every Postgres request.

```sql
-- conversations
alter table conversations enable row level security;

create policy "users own their conversations"
  on conversations for all
  using (auth.uid() = user_id);

-- messages (access via parent conversation ownership)
alter table messages enable row level security;

create policy "users own their messages"
  on messages for all
  using (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );
```

With RLS enabled, the Supabase client running as the authenticated user automatically filters all queries to the user's own data. Route handlers never need to manually add `WHERE user_id = ?` — RLS handles it at the database layer.

---

## Data Model

```sql
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);
```

The title is auto-generated from the first user message (can be done in the `onFinish` callback of the first turn). `updated_at` on conversations is updated on each new message so the sidebar can sort by most recent activity.

---

## API Route: POST /api/chat

The most important file in the project. Full responsibility:

1. Parse the request body — `{ messages: UIMessage[], chatId: string }`
2. Validate the session with `supabase.auth.getUser()` — reject unauthenticated requests
3. Validate input — empty check, max 10,000 character limit (reject before touching OpenAI)
4. Load conversation history from Supabase (or use the messages from the client body — both are valid patterns; using the client body is simpler and matches SDK conventions)
5. Emit process log events via the data stream writer before/during the AI call
6. Call `streamText` with the surf trip system prompt and full conversation history
7. Save completed messages to Supabase in `onFinish`
8. Return the stream — `result.toUIMessageStreamResponse()` or `createDataStreamResponse` wrapper

```ts
import { openai } from "@ai-sdk/openai";
import {
  createDataStreamResponse,
  convertToModelMessages,
  streamText,
  UIMessage,
} from "ai";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { messages, chatId }: { messages: UIMessage[]; chatId: string } =
    await req.json();

  const lastMessage = messages.at(-1);
  if (!lastMessage?.content || lastMessage.content.trim().length === 0) {
    return new Response("Empty message", { status: 400 });
  }
  if (lastMessage.content.length > 10_000) {
    return new Response("Message too long", { status: 400 });
  }

  return createDataStreamResponse({
    execute: async (writer) => {
      writer.write({
        type: "data-process",
        data: { step: "Analyzing destination and dates..." },
        transient: true,
      });

      const result = streamText({
        model: openai("gpt-4o"),
        system: SURF_TRIP_SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages),
        onFinish: async ({ response }) => {
          await supabase.from("messages").insert([
            {
              conversation_id: chatId,
              role: "user",
              content: lastMessage.content,
            },
            {
              conversation_id: chatId,
              role: "assistant",
              content: response.messages.at(-1)?.content ?? "",
            },
          ]);
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", chatId);
        },
      });

      result.mergeIntoDataStream(writer);
    },
  });
}
```

---

## Input Validation and Loading State

From the project plan and assessment spec, these are non-negotiable:

- **Disable button while loading.** `isLoading` from `useChat` drives both the input `disabled` attribute and the button `disabled` attribute.
- **Empty check before send.** The `handleSubmit` from `useChat` already guards against empty input, but a client-side check in the submit handler is explicit and user-friendly.
- **Max length client check.** Show a character count or disable send when `input.length > 10_000`.
- **Error state above input.** When `error` from `useChat` is set, display the error message and ensure the input is re-enabled (which `useChat` does automatically — `isLoading` returns to false).
- **Re-enable on error.** `useChat` sets `isLoading = false` on error, so the input unblocks automatically.

---

## Process Log — Design

The process log is the differentiator. It lives in a right-hand panel (`ProcessLog.tsx`) and shows what the AI is doing in real time.

**State:** `processSteps: string[]` in the chat view component, populated via `onData` in `useChat`.

**Lifecycle:**

- Clears when a new message is submitted (reset in the submit handler before calling `handleSubmit`)
- Populated by `data-process` transient events from the server
- The final process step can read something like "Generating response..." while the text streams in
- After streaming ends, the steps persist in the panel until the next message is sent

**Process event types for surftrip:**

```ts
type ProcessStep =
  | "Analyzing destination and dates..."
  | "Researching surf breaks..."
  | "Checking swell forecasts..."
  | "Estimating travel costs..."
  | "Generating response...";
```

Initially these are static strings emitted in sequence before and during the `streamText` call. In Phase Two, they map to actual tool calls (NOAA swell API, Surfline, flight pricing).

---

## App Shell Layout

Three-column layout defined in `app/(app)/layout.tsx`:

```
┌─────────────────┬──────────────────────┬──────────────────┐
│ ConversationSide│    ChatMessages      │   ProcessLog     │
│ bar             │    + ChatInput       │                  │
│                 │                      │                  │
│ Past chats      │ Streaming messages   │ Step by step AI  │
│ + New Chat btn  │ Auto-resize input    │ activity         │
└─────────────────┴──────────────────────┴──────────────────┘
```

The sidebar and process log are layout-level — they persist across all chat routes. The center content (`app/(app)/chat/[id]/page.tsx`) re-renders on navigation.

---

## Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=       # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Supabase publishable anon key
OPENAI_API_KEY=                 # OpenAI API key — server-side only, never NEXT_PUBLIC_
```

`OPENAI_API_KEY` must never be prefixed with `NEXT_PUBLIC_`. It is only referenced in `app/api/chat/route.ts`. The browser never sees it.

---

## Packages

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/react": "^1.0.0",
    "@supabase/supabase-js": "^2.0.0",
    "@supabase/ssr": "^0.5.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0"
  }
}
```

---

## Evaluator Setup (README target)

```
1. Clone the repo
2. Create a free Supabase project → copy URL + anon key
3. Get an OpenAI API key
4. cp .env.example .env.local → fill in 3 values
5. Run the Supabase migration SQL in the Supabase SQL editor
6. npm install && npm run dev
```

Six steps. No Wrangler, no Cloudflare account, no D1 migration commands.

---

## Key Implementation Risks

| Risk                            | Mitigation                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cookies()` async in Next.js 15 | Always `await cookies()` in `lib/supabase/server.ts`                                                       |
| Middleware session sync         | Return `supabaseResponse` unmodified; never create a new `NextResponse` without copying cookies            |
| OpenAI key in browser           | Never use `NEXT_PUBLIC_` prefix on `OPENAI_API_KEY`                                                        |
| Race condition on save          | `onFinish` is async; use `await` inside; errors there are non-fatal to the stream but should log           |
| RLS not enabled                 | Always `alter table X enable row level security` — without this, RLS policies are defined but not enforced |
| `getUser()` vs `getClaims()`    | Middleware uses `getClaims()` (local JWT read); route handlers use `getUser()` (server validation)         |
