# Surftrip — Implementation Plan

Full plan for building the Spotnana take-home assessment. Each step is self-contained. Steps 2 and 3 produce SQL files you run in the Supabase SQL editor; all other steps produce source files.

---

## Two Storage Paths — Architecture Overview

The app supports two user states with a single UI.

| State                     | Storage           | Persistence                                                                               |
| ------------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| **Guest** (not signed in) | `localStorage`    | Survives page refresh and browser restart. Tied to that browser — incognito starts fresh. |
| **Authenticated**         | Supabase Postgres | Cross-device. Persists on the server. Protected by RLS.                                   |

**What changes per path:**

| Concern            | Guest                                                                      | Authenticated                                                  |
| ------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Conversation list  | Loaded from `localStorage` client-side in sidebar                          | Server-fetched from Supabase in the layout                     |
| Initial messages   | Loaded from `localStorage` via `setMessages()` on mount                    | Server-fetched in `page.tsx`, passed as `initialMessages` prop |
| Post-stream save   | `ChatView.onFinish` writes to `localStorage`                               | API route `onFinish` writes to Supabase                        |
| Auto-title         | Client-side, written to `localStorage`                                     | Server-side, written to Supabase                               |
| Clear conversation | `deleteConversation()` from `lib/local-storage.ts`                         | Supabase `DELETE` via browser client                           |
| New conversation   | `crypto.randomUUID()` + `createConversation()` from `lib/local-storage.ts` | Supabase `INSERT`                                              |
| Proxy              | No redirect — guests can access `/` and `/chat/*` freely                   | Redirects authenticated users away from `/login`/`/signup`     |
| API route          | No auth check — streams freely, no DB write                                | Validates session, writes to Supabase in `onFinish`            |
| Sidebar footer     | "Sign in to sync across devices" link                                      | "Sign out" button                                              |

---

## Steps at a Glance

| #   | Step                    | Output                                                                                     |
| --- | ----------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Project bootstrap       | `package.json`, `next.config.ts`, `tsconfig.json`                                          |
| 2   | Database schema         | `supabase/schema.sql` — run in Supabase SQL editor                                         |
| 3   | Sample data             | `supabase/seed.sql` — run in Supabase SQL editor                                           |
| 4   | Environment variables   | `.env.example`, `.env.local`                                                               |
| 5   | Supabase clients        | `lib/supabase/client.ts`, `lib/supabase/server.ts`                                         |
| 6   | TypeScript types        | `lib/types.ts`                                                                             |
| 7   | Proxy                   | `proxy.ts` — session refresh only; no blanket redirect for unauthenticated users           |
| 7.5 | localStorage utilities  | `lib/local-storage.ts`                                                                     |
| 8   | Auth pages              | `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`, `app/auth/callback/route.ts`    |
| 9   | App shell layout        | `app/(app)/layout.tsx` — no auth gate; passes `isAuthenticated` + conversations to sidebar |
| 10  | Conversation sidebar    | `components/ConversationSidebar.tsx` — two data sources, one UI                            |
| 11  | API route               | `app/api/chat/route.ts` — auth optional; Supabase write only when authenticated            |
| 12  | Chat page               | `app/(app)/chat/[id]/page.tsx` (Server shell) + `ChatView.tsx` (Client logic)              |
| 13  | ChatMessages            | `components/ChatMessages.tsx`                                                              |
| 14  | ChatInput               | `components/ChatInput.tsx`                                                                 |
| 15  | ProcessLog              | `components/ProcessLog.tsx`                                                                |
| 16  | Root + guest home       | `app/(app)/page.tsx` + `app/(app)/GuestHome.tsx`                                           |
| 17  | CSS Modules             | `app/globals.css`, `components/*.module.css`                                               |
| 18  | README + `.env.example` | `README.md`                                                                                |

---

## Step 1 — Project Bootstrap

```bash
npx create-next-app@latest surftrip \
  --typescript \
  --app \
  --no-tailwind \
  --eslint \
  --src-dir=false \
  --import-alias="@/*"

cd surftrip

npm install ai @ai-sdk/openai @ai-sdk/react \
  @supabase/supabase-js @supabase/ssr
```

**`next.config.ts`** — no changes needed from the scaffold default.

**`tsconfig.json`** — confirm `"paths": { "@/*": ["./*"] }` is present (create-next-app sets this).

Final directory skeleton before any code:

```
surftrip/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── signup/
│   ├── (app)/
│   │   ├── chat/
│   │   │   └── [id]/
│   │   │       ├── page.tsx      ← Server Component: auth check + initial message fetch
│   │   │       └── ChatView.tsx  ← Client Component: useChat, both storage paths
│   │   ├── GuestHome.tsx         ← Client Component: creates localStorage conversation on mount
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── api/
│   │   └── chat/
│   │       └── route.ts
│   └── auth/
│       └── callback/
│           └── route.ts
├── components/
├── lib/
│   ├── local-storage.ts          ← Guest storage: load/save/delete conversations
│   ├── process-log-context.tsx
│   └── supabase/
├── supabase/
│   ├── schema.sql
│   └── seed.sql
├── .env.example
├── proxy.ts
└── README.md
```

---

## Step 2 — Database Schema

**File: `supabase/schema.sql`**

Run this entire file in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).

```sql
-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Reusable trigger function that stamps updated_at on any row update.
-- security invoker: runs as the calling user, not the definer.
-- set search_path = '': prevents search path injection attacks.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- TABLES
-- ============================================================

-- conversations: one row per chat session.
create table public.conversations (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  title       text        not null default 'New conversation',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- messages: one row per turn (user or assistant).
create table public.messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.conversations(id) on delete cascade,
  role            text        not null,
  content         text        not null,
  created_at      timestamptz not null default now(),

  constraint messages_role_check check (role in ('user', 'assistant'))
);


-- ============================================================
-- INDEXES
-- ============================================================

-- Sidebar query: list conversations for a user, newest first.
create index conversations_user_id_updated_at_idx
  on public.conversations (user_id, updated_at desc);

-- Chat view query: load all messages for a conversation, in order.
create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at asc);


-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-stamp conversations.updated_at on every row update.
create trigger set_conversations_updated_at
  before update on public.conversations
  for each row
  execute function public.set_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- conversations: users own their own rows, full CRUD.
create policy "conversations_select"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "conversations_insert"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "conversations_update"
  on public.conversations for update
  using (auth.uid() = user_id);

create policy "conversations_delete"
  on public.conversations for delete
  using (auth.uid() = user_id);

-- messages: access is gated through conversation ownership.
-- A user can read/write/delete messages in conversations they own.
create policy "messages_select"
  on public.messages for select
  using (
    conversation_id in (
      select id from public.conversations where user_id = auth.uid()
    )
  );

create policy "messages_insert"
  on public.messages for insert
  with check (
    conversation_id in (
      select id from public.conversations where user_id = auth.uid()
    )
  );

create policy "messages_delete"
  on public.messages for delete
  using (
    conversation_id in (
      select id from public.conversations where user_id = auth.uid()
    )
  );
```

**Why these and not others:**

- `set_updated_at()` is a shared function so any future table can reuse the same trigger without rewriting the logic.
- Indexes are on the exact columns the two main queries hit: `(user_id, updated_at desc)` for the sidebar list, `(conversation_id, created_at asc)` for loading messages.
- RLS policies are split per operation (SELECT / INSERT / UPDATE / DELETE) rather than a single `for all` policy. This is more explicit and makes it easy to tighten permissions on a per-operation basis later.
- Messages have no UPDATE policy intentionally — messages are immutable once written.
- `on delete cascade` on both foreign keys means deleting a user deletes their conversations, and deleting a conversation deletes its messages. No orphan rows.

---

## Step 3 — Sample Data

**File: `supabase/seed.sql`**

**Before running:** Create a user account through the app's signup page (or via Supabase Dashboard → Authentication → Users → Add user). Copy the UUID from the Users table and replace both occurrences of `'YOUR-USER-UUID-HERE'` below.

```sql
-- ============================================================
-- SAMPLE DATA
-- Replace 'YOUR-USER-UUID-HERE' with a real user UUID from
-- Supabase Dashboard → Authentication → Users
-- ============================================================

do $$
declare
  v_user_id     uuid := 'YOUR-USER-UUID-HERE';
  v_conv_1_id   uuid := gen_random_uuid();
  v_conv_2_id   uuid := gen_random_uuid();
begin

  -- --------------------------------------------------------
  -- Conversation 1: Mentawai Islands planning session
  -- --------------------------------------------------------
  insert into public.conversations (id, user_id, title, created_at, updated_at)
  values (
    v_conv_1_id,
    v_user_id,
    'Mentawai Islands — October',
    now() - interval '2 days',
    now() - interval '2 days'
  );

  insert into public.messages (conversation_id, role, content, created_at) values
  (
    v_conv_1_id, 'user',
    'I want to plan a surf trip to the Mentawai Islands in Indonesia. We''re thinking mid-October for about 10 days. There are 3 of us, intermediate to advanced surfers. What should we know?',
    now() - interval '2 days' + interval '1 minute'
  ),
  (
    v_conv_1_id, 'assistant',
    'The Mentawais in mid-October is a great call — it sits right at the tail end of the dry season (May–October), so you''re catching the last reliable swell window before the weather turns. Here''s what to expect:

**Conditions**
Peak swell season runs June–September, but October still delivers solid 4–6ft+ sets, especially at the southern breaks. Offshore winds are typically light in the morning, turning onshore by afternoon. Water temperature sits around 27–28°C — boardshorts and a rash guard is all you need.

**The breaks**
The Mentawais have 50+ breaks, but for intermediate-to-advanced surfers, the headline spots are:
- **Macaronis** — long, predictable lefthander, one of the most consistent waves in the world. Intermediate-friendly with longer rides.
- **Rifles** — barreling right, more advanced. Works best at 4–6ft.
- **HT''s (Lance''s Right)** — world-class right-hander, powerful and hollow at size. Advanced.
- **Telescopes** — heavy left, not for the faint-hearted.

**Getting there**
Fly into Padang (PDG) via Jakarta (CGK) or Singapore (SIN). From Padang, you have two options:
1. Fast boat to Tua Pejat (~3–4 hrs) — cheaper, rougher
2. Charter a live-aboard boat — the preferred option. Prices range from $1,800–$3,500 USD per person for 10 days depending on the vessel.

**Live-aboard vs. land-based**
For 10 days and 3 surfers, a boat charter is strongly recommended. It lets you follow the swell, anchor at uncrowded breaks, and cover far more ground than staying in one resort. Splitting a charter between 3 people is very cost-effective.

**Budget estimate (per person, 10 days)**
- Flights (from US/Europe): $900–$1,400
- Boat charter share: $2,000–$3,000
- Visa on arrival (Indonesia): $35
- Board bag fees: $100–$200 (airlines vary)
- Total: ~$3,000–$5,000 per person

**What to book first**
Boat charters fill up months in advance for peak season. October slots may still be available but move fast. I''d recommend locking in the boat before anything else.

Want me to break down specific boat operators, the best strategy for booking flights, or more detail on any of the breaks?',
    now() - interval '2 days' + interval '2 minutes'
  ),
  (
    v_conv_1_id, 'user',
    'What''s the crowd situation like at Macaronis vs HT''s? And what''s the best month to go if we want less crowds?',
    now() - interval '2 days' + interval '10 minutes'
  ),
  (
    v_conv_1_id, 'assistant',
    '**Macaronis** is the most crowded wave in the Mentawais — it''s predictable, long, and photogenic, which means it draws boat traffic from every charter in range. On a solid swell day in peak season, expect 30–50 surfers out. The wave is long enough to spread people out, but the takeoff zone still gets competitive. Being on a boat is an advantage: you can time your session to hit it at dawn or midweek when other charters are elsewhere.

**HT''s (Lance''s Right)** draws a more experienced crowd but also gets heavy traffic — it''s one of the most photographed waves in the archipelago. Expect similar numbers on good days.

For less crowds, the gameplan is to chase the boats to the outer islands rather than surfing the headline breaks. Your skipper will know where the crowds are thin that day.

**Best month for low crowds**
The honest answer: there''s no magic month. The Mentawais are a charter surf destination, and wherever the swell is good, boats will be. That said:

- **May and October** are the shoulder months — swell is still there but slightly less consistent. Fewer boats make the trip, crowds are noticeably lighter.
- **November–April** is the wet season — swell gets inconsistent and rainy. Not recommended unless you''re chasing a specific forecast window.
- **June–September** is peak. Best swell, most boats.

**Mid-October is actually a good sweet spot.** You get the end of dry season conditions, lighter traffic than July/August, and a real chance of finding breaks with 5–10 people out instead of 40.

One more thing: if any of your group can get to the boat for a 5am pre-dawn position, you''ll have Macaronis to yourselves for the first hour of light. Easily worth the early alarm.',
    now() - interval '2 days' + interval '11 minutes'
  );

  -- --------------------------------------------------------
  -- Conversation 2: Bali beginner scouting
  -- --------------------------------------------------------
  insert into public.conversations (id, user_id, title, created_at, updated_at)
  values (
    v_conv_2_id,
    v_user_id,
    'Bali — learning to surf, March',
    now() - interval '5 hours',
    now() - interval '5 hours'
  );

  insert into public.messages (conversation_id, role, content, created_at) values
  (
    v_conv_2_id, 'user',
    'I''m a complete beginner and want to learn to surf in Bali in March. I''ll have about 2 weeks. Where should I go and what should I expect?',
    now() - interval '5 hours' + interval '1 minute'
  ),
  (
    v_conv_2_id, 'assistant',
    'Bali is one of the best places in the world to learn to surf — plenty of mellow beach breaks, tons of surf schools, and warm water year-round. March falls in the wet season (Nov–April) but that doesn''t mean bad conditions. Here''s the breakdown:

**Best spots for beginners in Bali**

**Kuta Beach** — the original surf school hub. Long sandy beach, consistent small shore break, hundreds of instructors. Crowded and touristy but genuinely good for learning. Waves are usually 1–3ft and forgiving. Cheap lessons (~$15–25 USD/hour).

**Legian** — a short walk north of Kuta, slightly less crowded, same quality of wave.

**Seminyak** — more upscale area, quieter beach, similar beginner-friendly conditions.

**Canggu (Echo Beach / Batu Bolong)** — slightly more advanced than Kuta. Better vibe, better coffee, more of a surf community feel. Batu Bolong has a gentle right that''s good once you can pop up consistently.

**What to expect in March**
- **Swell:** West and south swells, typically 2–5ft at exposed breaks. Beach breaks in Kuta/Canggu stay manageable at 1–3ft for beginners.
- **Wind:** Onshore winds more common in the wet season. Mornings are usually the best window — glassy conditions before 8–9am.
- **Rain:** Afternoon showers are common but usually short. Doesn''t affect surfing much.
- **Water temp:** 27–29°C. Rash guard at most.

**2-week progression plan**
- Days 1–4: Kuta or Legian, group lessons. Focus on paddling, popping up, riding whitewater.
- Days 5–8: Private lessons at Canggu once you''re popping up consistently. Start catching unbroken waves.
- Days 9–14: Free surf at Batu Bolong or Echo Beach morning sessions. Rent a board by the day (~$5–10).

**Budget estimate (2 weeks)**
- Flights: $700–$1,200 depending on origin
- Accommodation (Canggu guesthouse/surf hostel): $20–60/night = $280–840
- Surf lessons (10 hours total): ~$150–250
- Board rental (rest of trip): ~$70–100
- Food: $15–30/day
- Total: ~$1,500–$2,800

**One tip:** Book accommodation in Canggu and day-trip to Kuta for your first few lessons. Canggu has better food, a real local surf scene, and you''ll enjoy hanging around there between sessions.',
    now() - interval '5 hours' + interval '2 minutes'
  );

end $$;
```

---

## Step 4 — Environment Variables

**`.env.example`** (committed to the repo):

```bash
# Supabase — get from: Project Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# OpenAI — server-side only, never NEXT_PUBLIC_
OPENAI_API_KEY=sk-...
```

**`.env.local`** (gitignored, fill in real values):

Copy `.env.example` to `.env.local` and fill in the three values. The `OPENAI_API_KEY` must never have the `NEXT_PUBLIC_` prefix — it is only read in `app/api/chat/route.ts` and must never be bundled to the browser.

---

## Step 5 — Supabase Clients

Two clients: one for the browser, one for the server. They differ only in how they handle cookies.

**`lib/supabase/client.ts`** — browser client for Client Components and auth UI:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

**`lib/supabase/server.ts`** — server client for Route Handlers and Server Components:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore.
            // The middleware handles session refresh.
          }
        },
      },
    },
  );
}
```

The `try/catch` in `setAll` is intentional: Server Components are read-only after they start rendering, so `cookieStore.set` will throw. Suppressing it is correct because the proxy (Step 7) is responsible for writing the refreshed session cookie on every request.

---

## Step 6 — TypeScript Types

**`lib/types.ts`**

```ts
// ── Supabase (authenticated users) ──────────────────────────────────────────

export type Conversation = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

// ── localStorage (guest users) ───────────────────────────────────────────────

// Stored under the key 'surftrip_conversations' as a JSON array.
export type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type LocalConversation = {
  id: string;
  title: string;
  updatedAt: string;
  messages: LocalMessage[];
};

// ── AI SDK data stream ───────────────────────────────────────────────────────

// Process log event emitted from the API route via the AI SDK data stream.
// transient: true — delivered to the client but never stored in message history.
export type ProcessDataPart = {
  type: "data-process";
  data: {
    step: string;
  };
};
```

---

## Step 7 — Proxy

> **Next.js has renamed `middleware.ts` → `proxy.ts` and `export function middleware` → `export function proxy`.**
> The term "middleware" was deprecated because it caused confusion with Express.js middleware and encouraged overuse. The new name "proxy" better reflects what the file actually does: it sits at a network boundary in front of the app and runs at the Edge Runtime, closer to the client. See: [https://nextjs.org/docs/messages/middleware-to-proxy](https://nextjs.org/docs/messages/middleware-to-proxy)
>
> If you ever scaffold from an older template that still uses `middleware.ts`, run the official codemod to migrate:
>
> ```bash
> npx @next/codemod@canary middleware-to-proxy .
> ```

**`proxy.ts`** — lives at the project root (same level as `app/`).

Runs on every request. Its only job is refreshing the Supabase session cookie. **It does not redirect unauthenticated users** — guests are allowed to visit `/` and `/chat/*` freely. The only redirect is pushing already-authenticated users away from the auth pages so they don't see login/signup if they're already signed in.

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Do NOT put any code between createServerClient and getClaims().
  // A mistake here causes random session logouts.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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

  // getClaims() reads the JWT locally — no network call.
  // Use this in proxy. Use getUser() in route handlers.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const { pathname } = request.nextUrl;

  // Redirect authenticated users away from auth pages.
  // Guests are never redirected — they can use the whole app without signing in.
  if (
    user &&
    (pathname.startsWith("/login") || pathname.startsWith("/signup"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // IMPORTANT: return supabaseResponse as-is.
  // Never create a new NextResponse without copying its cookies.
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

---

## Step 7.5 — localStorage Utilities

**`lib/local-storage.ts`**

All guest persistence goes through these functions. Nothing else in the app touches `localStorage` directly.

```ts
import type { LocalConversation, LocalMessage } from "@/lib/types";

const KEY = "surftrip_conversations";

// ── Read ──────────────────────────────────────────────────────────────────────

export function loadConversations(): LocalConversation[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function loadConversation(id: string): LocalConversation | null {
  return loadConversations().find((c) => c.id === id) ?? null;
}

// ── Write ─────────────────────────────────────────────────────────────────────

function persist(conversations: LocalConversation[]): void {
  localStorage.setItem(KEY, JSON.stringify(conversations));
}

export function createConversation(
  id: string,
  title: string,
): LocalConversation {
  const conv: LocalConversation = {
    id,
    title,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  // Prepend so the newest conversation is first.
  persist([conv, ...loadConversations()]);
  return conv;
}

export function appendMessages(
  conversationId: string,
  messages: LocalMessage[],
): void {
  const all = loadConversations();
  const idx = all.findIndex((c) => c.id === conversationId);
  if (idx === -1) return;

  all[idx] = {
    ...all[idx],
    messages: [...all[idx].messages, ...messages],
    updatedAt: new Date().toISOString(),
  };

  // Re-sort so the most recently updated conversation surfaces first.
  all.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  persist(all);
}

export function updateTitle(conversationId: string, title: string): void {
  const all = loadConversations();
  const idx = all.findIndex((c) => c.id === conversationId);
  if (idx === -1) return;
  all[idx] = { ...all[idx], title };
  persist(all);
}

export function deleteConversation(id: string): void {
  persist(loadConversations().filter((c) => c.id !== id));
}
```

**Why a dedicated module and not inline calls:** every storage operation is in one file, so the shape of the stored data is never duplicated across the codebase. The `typeof window === "undefined"` guard in `loadConversations` means these functions are safe to import anywhere without exploding during SSR (they should only be _called_ client-side).

---

## Step 8 — Auth Pages

### Login

**`app/(auth)/login/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Surftrip</h1>
      <p className={styles.subtitle}>Sign in to plan your next wave</p>

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={styles.input}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className={styles.input}
        />

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" disabled={loading} className={styles.button}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className={styles.footer}>
        No account? <Link href="/signup">Sign up</Link>
      </p>
    </div>
  );
}
```

### Signup

**`app/(auth)/signup/page.tsx`** — identical structure to login, using `supabase.auth.signUp()` instead of `signInWithPassword`. After signup, show a "Check your email" message rather than redirecting immediately (Supabase sends a confirmation email by default).

```tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import styles from "./signup.module.css";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div className={styles.container}>
        <h2>Check your email</h2>
        <p>
          We sent a confirmation link to <strong>{email}</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Surftrip</h1>
      <p className={styles.subtitle}>Create an account</p>

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={styles.input}
        />
        <input
          type="password"
          placeholder="Password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className={styles.input}
        />

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" disabled={loading} className={styles.button}>
          {loading ? "Creating account..." : "Sign up"}
        </button>
      </form>

      <p className={styles.footer}>
        Have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
```

### Auth Callback

**`app/auth/callback/route.ts`** — handles the email confirmation redirect from Supabase:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
}
```

In the Supabase dashboard, add `http://localhost:3000/auth/callback` to the allowed redirect URLs (Authentication → URL Configuration).

---

## Step 9 — App Shell Layout

**`app/(app)/layout.tsx`**

Three-column layout: sidebar | main | process log. There is **no auth gate here** — guests land directly in the app. The layout checks auth solely to decide whether to server-fetch conversations for the sidebar. Guest conversations are loaded client-side from `localStorage` inside `ConversationSidebar`.

```tsx
import { createClient } from "@/lib/supabase/server";
import { ProcessLogProvider } from "@/lib/process-log-context";
import ConversationSidebar from "@/components/ConversationSidebar";
import ProcessLog from "@/components/ProcessLog";
import type { Conversation } from "@/lib/types";
import styles from "./layout.module.css";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only fetch from Supabase if the user is authenticated.
  // Guests get an empty array — the sidebar loads from localStorage client-side.
  let serverConversations: Pick<Conversation, "id" | "title" | "updated_at">[] =
    [];

  if (user) {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    serverConversations = data ?? [];
  }

  return (
    <div className={styles.shell}>
      <ConversationSidebar
        serverConversations={serverConversations}
        isAuthenticated={!!user}
      />
      <ProcessLogProvider>
        <main className={styles.main}>{children}</main>
        <ProcessLog />
      </ProcessLogProvider>
    </div>
  );
}
```

**`app/(app)/layout.module.css`**:

```css
.shell {
  display: grid;
  grid-template-columns: 260px 1fr 280px;
  height: 100vh;
  overflow: hidden;
}

.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

---

## Step 10 — Conversation Sidebar

**`components/ConversationSidebar.tsx`**

Receives `serverConversations` (empty for guests) and `isAuthenticated` from the layout. On mount, if the user is a guest, it loads from `localStorage` and replaces the empty list. A `storage` event listener keeps the list in sync when a new conversation is created from the chat page.

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadConversations, createConversation } from "@/lib/local-storage";
import type { Conversation } from "@/lib/types";
import styles from "./ConversationSidebar.module.css";

type ConversationSummary = Pick<Conversation, "id" | "title" | "updated_at">;

type Props = {
  serverConversations: ConversationSummary[];
  isAuthenticated: boolean;
};

export default function ConversationSidebar({
  serverConversations,
  isAuthenticated,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();

  // Authenticated users: seeded from server. Guests: seeded empty, then hydrated.
  const [conversations, setConversations] =
    useState<ConversationSummary[]>(serverConversations);

  // Guest: load from localStorage on mount and stay in sync.
  useEffect(() => {
    if (isAuthenticated) return;

    function sync() {
      const stored = loadConversations();
      setConversations(
        stored.map((c) => ({
          id: c.id,
          title: c.title,
          updated_at: c.updatedAt,
        })),
      );
    }

    sync();

    // Re-sync when another tab writes to localStorage.
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [isAuthenticated]);

  async function handleNewChat() {
    if (isAuthenticated) {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title: "New conversation" })
        .select("id")
        .single();

      if (data) {
        router.push(`/chat/${data.id}`);
        router.refresh();
      }
    } else {
      const id = crypto.randomUUID();
      createConversation(id, "New conversation");
      // Optimistically add to local state before navigation.
      setConversations((prev) => [
        { id, title: "New conversation", updated_at: new Date().toISOString() },
        ...prev,
      ]);
      router.push(`/chat/${id}`);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.logo}>Surftrip</span>
        <button onClick={handleNewChat} className={styles.newChat}>
          New chat
        </button>
      </div>

      <nav className={styles.nav}>
        {conversations.map((c) => (
          <Link
            key={c.id}
            href={`/chat/${c.id}`}
            className={`${styles.item} ${
              pathname === `/chat/${c.id}` ? styles.active : ""
            }`}
          >
            {c.title}
          </Link>
        ))}
      </nav>

      <div className={styles.footer}>
        {isAuthenticated ? (
          <button onClick={handleSignOut} className={styles.signOut}>
            Sign out
          </button>
        ) : (
          <Link href="/login" className={styles.signIn}>
            Sign in to sync across devices
          </Link>
        )}
      </div>
    </aside>
  );
}
```

---

## Step 11 — API Route: POST /api/chat

**`app/api/chat/route.ts`**

The most important server file. Auth is **optional** — guests can stream without a session. The OpenAI key is always server-side regardless of auth state. The only thing that changes based on auth is whether messages are saved to Supabase in `onFinish`. Guest persistence is handled entirely client-side in `ChatView`.

```ts
import { openai } from "@ai-sdk/openai";
import {
  createDataStreamResponse,
  convertToModelMessages,
  streamText,
} from "ai";
import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/server";

const SYSTEM_PROMPT = `You are Surftrip, an expert surf travel planning assistant.

You help surfers plan trips by researching destinations, surf breaks, swell conditions, travel logistics, and costs. You have deep knowledge of surf spots worldwide — wave quality, optimal seasons, crowd levels, ideal skill levels, and what to expect in the water.

When a user describes a destination and travel dates:
1. Assess the surf conditions and swell season for that window
2. Identify the best breaks for their skill level
3. Outline travel logistics (flights, transfers, accommodation options)
4. Give a realistic budget estimate

Be specific and practical. Surfers want actionable information, not vague travel writing. Stay in the conversation to answer follow-up questions.`;

const MAX_INPUT_LENGTH = 10_000;

export async function POST(req: Request) {
  // 1. Check auth — but do not reject guests.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 2. Parse and validate input.
  const { messages, chatId }: { messages: UIMessage[]; chatId: string } =
    await req.json();

  const lastMessage = messages.at(-1);

  if (
    !lastMessage?.content ||
    String(lastMessage.content).trim().length === 0
  ) {
    return new Response("Empty message", { status: 400 });
  }

  if (String(lastMessage.content).length > MAX_INPUT_LENGTH) {
    return new Response("Message too long", { status: 400 });
  }

  // 3. For authenticated users only: verify conversation ownership.
  //    RLS enforces this at the DB layer too, but an explicit check here
  //    returns a clean 403 rather than a silent empty result.
  if (user) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", chatId)
      .single();

    if (!conversation) {
      return new Response("Conversation not found", { status: 403 });
    }
  }

  // 4. Stream response with process log events.
  return createDataStreamResponse({
    execute: async (writer) => {
      // transient: true — delivered to the client but never stored in
      // message history. Appears only in the process log panel.
      writer.write({
        type: "data-process",
        data: { step: "Reading your message..." },
        transient: true,
      });

      writer.write({
        type: "data-process",
        data: { step: "Analyzing destination and dates..." },
        transient: true,
      });

      writer.write({
        type: "data-process",
        data: { step: "Researching surf breaks and conditions..." },
        transient: true,
      });

      const result = streamText({
        model: openai("gpt-4o"),
        system: SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages),
        onFinish: async ({ response }) => {
          // Guests: skip. Their persistence is handled by ChatView.onFinish.
          if (!user) return;

          // Authenticated: write both turns to Supabase.
          const userContent = String(lastMessage.content);
          const assistantMessage = response.messages.at(-1);
          const assistantContent = assistantMessage
            ? Array.isArray(assistantMessage.content)
              ? assistantMessage.content
                  .filter((p) => p.type === "text")
                  .map((p) => (p as { type: "text"; text: string }).text)
                  .join("")
              : String(assistantMessage.content)
            : "";

          await supabase.from("messages").insert([
            { conversation_id: chatId, role: "user", content: userContent },
            {
              conversation_id: chatId,
              role: "assistant",
              content: assistantContent,
            },
          ]);

          // Auto-title the conversation from the first user message.
          if (messages.length === 1) {
            const title = userContent.slice(0, 60).trim();
            await supabase
              .from("conversations")
              .update({
                title:
                  title.length < userContent.length ? `${title}...` : title,
              })
              .eq("id", chatId)
              .eq("title", "New conversation");
          }

          // Bump updated_at so the sidebar re-sorts by recency.
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", chatId);
        },
      });

      writer.write({
        type: "data-process",
        data: { step: "Generating response..." },
        transient: true,
      });

      result.mergeIntoDataStream(writer);
    },
  });
}
```

---

## Step 12 — Chat Page

The chat route is split into two files: a Server Component that handles auth and data fetching, and a Client Component that owns all interactive state.

**`lib/process-log-context.tsx`** — context for sharing process steps between `ChatView` and the layout's `ProcessLog` panel:

```tsx
"use client";

import { createContext, useContext, useState } from "react";

type ProcessLogContextType = {
  steps: string[];
  addStep: (step: string) => void;
  clearSteps: () => void;
};

const ProcessLogContext = createContext<ProcessLogContextType | null>(null);

export function ProcessLogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [steps, setSteps] = useState<string[]>([]);

  function addStep(step: string) {
    setSteps((prev) => [...prev, step]);
  }

  function clearSteps() {
    setSteps([]);
  }

  return (
    <ProcessLogContext.Provider value={{ steps, addStep, clearSteps }}>
      {children}
    </ProcessLogContext.Provider>
  );
}

export function useProcessLog() {
  const ctx = useContext(ProcessLogContext);
  if (!ctx)
    throw new Error("useProcessLog must be used within ProcessLogProvider");
  return ctx;
}
```

---

**`app/(app)/chat/[id]/page.tsx`** — Server Component shell:

Checks auth, fetches initial messages from Supabase for authenticated users, and hands everything down to `ChatView`. Guests get `initialMessages: []` — their messages are loaded from `localStorage` client-side.

```tsx
import { createClient } from "@/lib/supabase/server";
import ChatView from "./ChatView";
import type { UIMessage } from "ai";

type Props = { params: Promise<{ id: string }> };

export default async function ChatPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initialMessages: UIMessage[] = [];

  if (user) {
    const { data } = await supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    initialMessages = (data ?? []).map((msg) => ({
      id: msg.id,
      role: msg.role as "user" | "assistant",
      parts: [{ type: "text" as const, text: msg.content }],
      createdAt: new Date(msg.created_at),
    }));
  }

  return (
    <ChatView
      chatId={id}
      initialMessages={initialMessages}
      isAuthenticated={!!user}
    />
  );
}
```

---

**`app/(app)/chat/[id]/ChatView.tsx`** — Client Component:

Owns `useChat`, process log wiring, and the fork between localStorage (guest) and Supabase (authenticated) for persistence and clear.

```tsx
"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useProcessLog } from "@/lib/process-log-context";
import {
  loadConversation,
  appendMessages,
  updateTitle,
  deleteConversation,
} from "@/lib/local-storage";
import ChatMessages from "@/components/ChatMessages";
import ChatInput from "@/components/ChatInput";
import type { UIMessage } from "ai";
import styles from "./chat.module.css";

type Props = {
  chatId: string;
  initialMessages: UIMessage[];
  isAuthenticated: boolean;
};

export default function ChatView({
  chatId,
  initialMessages,
  isAuthenticated,
}: Props) {
  const router = useRouter();
  const { addStep, clearSteps } = useProcessLog();

  const { messages, sendMessage, setMessages, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { messages, chatId },
      }),
    }),
    initialMessages,
    onData: (dataPart) => {
      if (dataPart.type === "data-process") {
        addStep((dataPart.data as { step: string }).step);
      }
    },
    onFinish: ({ messages: finishedMessages }) => {
      if (!isAuthenticated) {
        // Guest: write the new turns to localStorage.
        const lastUser = finishedMessages.findLast((m) => m.role === "user");
        const lastAssistant = finishedMessages.findLast(
          (m) => m.role === "assistant",
        );

        function extractText(msg: UIMessage): string {
          return msg.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("");
        }

        const toSave = [];
        if (lastUser)
          toSave.push({
            id: lastUser.id,
            role: "user" as const,
            content: extractText(lastUser),
            createdAt: new Date().toISOString(),
          });
        if (lastAssistant)
          toSave.push({
            id: lastAssistant.id,
            role: "assistant" as const,
            content: extractText(lastAssistant),
            createdAt: new Date().toISOString(),
          });

        appendMessages(chatId, toSave);

        // Auto-title on the first turn.
        if (messages.length === 1 && lastUser) {
          const raw = extractText(lastUser);
          const title = raw.slice(0, 60) + (raw.length > 60 ? "..." : "");
          updateTitle(chatId, title);
        }
      } else {
        // Authenticated: Supabase write already handled by API route onFinish.
        // Refresh the layout so the sidebar reflects updated title + recency.
        router.refresh();
      }
    },
  });

  // Guest: hydrate messages from localStorage on mount.
  // (initialMessages is empty for guests — the server doesn't know their data.)
  useEffect(() => {
    if (isAuthenticated) return;
    const stored = loadConversation(chatId);
    if (stored && stored.messages.length > 0) {
      setMessages(
        stored.messages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: "text" as const, text: m.content }],
          createdAt: new Date(m.createdAt),
        })),
      );
    }
  }, [chatId, isAuthenticated, setMessages]);

  function handleSend(text: string) {
    clearSteps();
    sendMessage({ text });
  }

  async function handleClear() {
    if (!isAuthenticated) {
      deleteConversation(chatId);
    } else {
      const supabase = createClient();
      await supabase.from("conversations").delete().eq("id", chatId);
    }
    router.push("/");
    router.refresh();
  }

  const isActive = status === "submitted" || status === "streaming";

  return (
    <div className={styles.chat}>
      <ChatMessages
        messages={messages}
        isStreaming={status === "streaming"}
        error={error ?? null}
      />
      <ChatInput
        onSend={handleSend}
        onStop={stop}
        onClear={handleClear}
        isActive={isActive}
      />
    </div>
  );
}
```

---

## Step 13 — ChatMessages

**`components/ChatMessages.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { UIMessage } from "ai";
import styles from "./ChatMessages.module.css";

type Props = {
  messages: UIMessage[];
  isStreaming: boolean;
  error: Error | null;
};

export default function ChatMessages({ messages, isStreaming, error }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Where are you headed?</p>
        <p className={styles.hint}>
          Describe a destination and travel dates to get started.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.messages}>
      {messages.map((message) => (
        <div
          key={message.id}
          className={`${styles.message} ${styles[message.role]}`}
        >
          <div className={styles.bubble}>
            {message.parts.map((part, i) =>
              part.type === "text" ? (
                <span key={i} className={styles.text}>
                  {part.text}
                </span>
              ) : null,
            )}
            {/* Streaming cursor on the last assistant message */}
            {isStreaming &&
              message.role === "assistant" &&
              message === messages.at(-1) && (
                <span className={styles.cursor}>▊</span>
              )}
          </div>
        </div>
      ))}

      {error && (
        <div className={styles.error}>
          Something went wrong. Please try again.
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
```

---

## Step 14 — ChatInput

**`components/ChatInput.tsx`**

Auto-resizing textarea. Enter to send, Shift+Enter for newline. Disabled while the AI is active.

```tsx
"use client";

import { useRef, useEffect } from "react";
import styles from "./ChatInput.module.css";

const MAX_LENGTH = 10_000;

type Props = {
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  isActive: boolean;
};

export default function ChatInput({
  onSend,
  onStop,
  onClear,
  isActive,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef("");

  // Auto-resize the textarea as content grows
  function resize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    valueRef.current = e.target.value;
    resize();
  }

  function submit() {
    const text = valueRef.current.trim();
    if (!text || isActive || text.length > MAX_LENGTH) return;

    onSend(text);

    // Clear the textarea
    if (textareaRef.current) {
      textareaRef.current.value = "";
      valueRef.current = "";
      resize();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // Re-focus input after AI response completes
  useEffect(() => {
    if (!isActive) {
      textareaRef.current?.focus();
    }
  }, [isActive]);

  return (
    <div className={styles.container}>
      <div className={styles.inputRow}>
        <textarea
          ref={textareaRef}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a surf destination..."
          disabled={isActive}
          rows={1}
          maxLength={MAX_LENGTH}
          className={styles.textarea}
        />

        {isActive ? (
          <button onClick={onStop} className={styles.stopButton} type="button">
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={isActive}
            className={styles.sendButton}
            type="button"
          >
            Send
          </button>
        )}
      </div>

      <div className={styles.actions}>
        <button
          onClick={onClear}
          disabled={isActive}
          className={styles.clearButton}
          type="button"
        >
          Clear conversation
        </button>
      </div>
    </div>
  );
}
```

---

## Step 15 — ProcessLog

**`components/ProcessLog.tsx`**

Reads process steps from the context set by the chat page.

```tsx
"use client";

import { useProcessLog } from "@/lib/process-log-context";
import styles from "./ProcessLog.module.css";

export default function ProcessLog() {
  const { steps } = useProcessLog();

  return (
    <aside className={styles.panel}>
      <h2 className={styles.heading}>Process log</h2>

      {steps.length === 0 ? (
        <p className={styles.empty}>Steps will appear here as the AI works.</p>
      ) : (
        <ol className={styles.steps}>
          {steps.map((step, i) => (
            <li key={i} className={styles.step}>
              <span className={styles.index}>{i + 1}</span>
              <span className={styles.text}>{step}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
```

---

## Step 16 — Root Page + Guest Home

**`app/(app)/page.tsx`** — Server Component:

Authenticated users are redirected to their latest conversation (or a newly created one). Guests are handed to `GuestHome`, a Client Component that creates a `localStorage` conversation on mount and navigates into it.

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GuestHome from "./GuestHome";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Redirect to the most recent conversation, or create a new one.
    const { data: latest } = await supabase
      .from("conversations")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (latest) redirect(`/chat/${latest.id}`);

    const { data: created } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: "New conversation" })
      .select("id")
      .single();

    if (created) redirect(`/chat/${created.id}`);
  }

  // Guest: delegate to a client component that can access localStorage.
  return <GuestHome />;
}
```

**`app/(app)/GuestHome.tsx`** — Client Component:

Creates a `localStorage` conversation on mount and immediately navigates into it. The `router.replace` keeps the browser history clean — pressing Back from the chat won't loop back to this intermediate page.

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createConversation, loadConversations } from "@/lib/local-storage";

export default function GuestHome() {
  const router = useRouter();

  useEffect(() => {
    // If guest already has conversations, go to the most recent one.
    const existing = loadConversations();
    if (existing.length > 0) {
      router.replace(`/chat/${existing[0].id}`);
      return;
    }

    // Otherwise create a fresh conversation.
    const id = crypto.randomUUID();
    createConversation(id, "New conversation");
    router.replace(`/chat/${id}`);
  }, [router]);

  return null;
}
```

---

## Step 17 — CSS Modules

All styling lives in co-located `.module.css` files. Reference Docket's `chat.module.css` and `global.css` as the source of truth for tokens and layout patterns.

**`app/globals.css`** — design tokens and resets:

```css
:root {
  --bg: #0f0f0f;
  --surface: #1a1a1a;
  --surface-hover: #242424;
  --border: #2a2a2a;
  --text: #e8e8e8;
  --text-muted: #888;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --error: #ef4444;
  --radius: 8px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.6;
}

button {
  cursor: pointer;
  border: none;
  background: none;
  font: inherit;
}
a {
  color: inherit;
  text-decoration: none;
}
input,
textarea {
  font: inherit;
}
```

Each component file listed in Steps 8–15 gets a corresponding `.module.css` with scoped styles. Implement these after the structure and logic are working.

---

## Step 18 — README + `.env.example`

**`README.md`** must include:

1. What the app does (3 sentences max)
2. Live demo URL (add after Vercel deploy)
3. Setup instructions:
   ```
   1. Clone the repo
   2. Create a free Supabase project
   3. Run supabase/schema.sql in the SQL editor
   4. cp .env.example .env.local — fill in 3 values
   5. npm install && npm run dev
   ```
4. Stack table
5. Vercel deploy button

---

## Todo List

**Legend**

- **You** — manual setup in a GUI, dashboard, or CLI that requires your credentials
- **Claude** — code Claude writes into the repo

---

### Phase 0 — External Services Setup

> Everything here is account/config work in external dashboards. Do this before Claude writes a single line of code. Claude cannot do any of these.

- [x] **You** Create a [Supabase](https://supabase.com) account and new project
- [x] **You** In Supabase → Project Settings → API: copy the **Project URL** and **anon/public key**
- [x] **You** In Supabase → Authentication → URL Configuration: add `http://localhost:3000/auth/callback` to the Redirect URLs list
- [x] **You** Create an [OpenAI](https://platform.openai.com) account and generate an API key with GPT-4o access
- [x] **You** Create a [Vercel](https://vercel.com) account and connect it to your GitHub account
- [x] **You** Create a public GitHub repository named `surftrip`

---

### Phase 1 — Local Project Scaffold

- [x] **Claude** Run `create-next-app` with the correct flags (TypeScript, App Router, no Tailwind, `@/*` alias)
- [x] **Claude** Install dependencies: `ai`, `@ai-sdk/openai`, `@ai-sdk/react`, `@supabase/supabase-js`, `@supabase/ssr`
- [x] **Claude** Write `.env.example` with the three required variable names (no values)
- [x] **You** Copy `.env.example` → `.env.local` and fill in the three values from Phase 0

---

### Phase 2 — Database

- [x] **Claude** Write `supabase/schema.sql` — tables, indexes, trigger function, triggers, RLS policies
- [x] **You** Open Supabase → SQL Editor → New query, paste `supabase/schema.sql`, and run it
- [x] **Claude** Write `supabase/seed.sql` — sample conversations and messages in a `DO $$` block
- [x] **You** In Supabase → Authentication → Users: create a test user account
- [x] **You** Copy the test user's UUID from the Users table, paste it into `supabase/seed.sql` replacing `'YOUR-USER-UUID-HERE'`
- [x] **You** Open Supabase → SQL Editor, paste `supabase/seed.sql`, and run it
- [x] **You** Verify in Supabase → Table Editor: confirm `conversations` and `messages` tables have data

---

### Phase 3 — Core Infrastructure

- [ ] **Claude** Write `lib/types.ts` — `Conversation`, `Message`, `LocalConversation`, `LocalMessage`, `ProcessDataPart` types
- [ ] **Claude** Write `lib/supabase/client.ts` — browser client using `createBrowserClient`
- [ ] **Claude** Write `lib/supabase/server.ts` — server client using `createServerClient` + async `cookies()`
- [ ] **Claude** Write `proxy.ts` — session refresh via `getClaims()`; redirects authenticated users away from `/login`/`/signup`; guests are never redirected (Next.js renamed `middleware.ts` → `proxy.ts`; see Step 7)
- [ ] **Claude** Write `lib/local-storage.ts` — `loadConversations`, `loadConversation`, `createConversation`, `appendMessages`, `updateTitle`, `deleteConversation` (Step 7.5)
- [ ] **Claude** Write `lib/process-log-context.tsx` — React context for sharing process steps between `ChatView` and `ProcessLog`

---

### Phase 4 — Auth

- [ ] **Claude** Write `app/(auth)/login/page.tsx` — email/password sign-in form, error state, redirect on success
- [ ] **Claude** Write `app/(auth)/signup/page.tsx` — email/password sign-up form, "check your email" confirmation state
- [ ] **Claude** Write `app/auth/callback/route.ts` — exchanges auth code for session, redirects to `/`
- [ ] **Claude** Write `app/(auth)/login/login.module.css`
- [ ] **Claude** Write `app/(auth)/signup/signup.module.css`
- [ ] **You** Test signup → confirm email → verify redirect to `/` works
- [ ] **You** Test login with confirmed account → verify redirect to `/`
- [ ] **You** Verify that visiting `/login` while already signed in redirects to `/` (proxy handles this)

---

### Phase 5 — App Shell

- [ ] **Claude** Write `app/(app)/layout.tsx` — three-column grid, no auth gate; checks auth to conditionally server-fetch conversations; passes `isAuthenticated` + `serverConversations` to sidebar
- [ ] **Claude** Write `app/(app)/layout.module.css` — CSS grid: `260px 1fr 280px`, full-height
- [ ] **Claude** Write `components/ConversationSidebar.tsx` — two data sources (localStorage for guests, prop for auth); new chat button forks on `isAuthenticated`; sidebar footer shows "Sign in to sync" for guests, "Sign out" for auth users
- [ ] **Claude** Write `components/ConversationSidebar.module.css`
- [ ] **Claude** Write `components/ProcessLog.tsx` — reads steps from context, numbered list, empty state
- [ ] **Claude** Write `components/ProcessLog.module.css`
- [ ] **Claude** Write `app/(app)/page.tsx` — auth users redirected to latest/new Supabase conversation; guests rendered via `GuestHome`
- [ ] **Claude** Write `app/(app)/GuestHome.tsx` — Client Component; on mount loads latest localStorage conversation or creates a new one, then `router.replace`s into it

---

### Phase 6 — API Route

- [ ] **Claude** Write `app/api/chat/route.ts`:
  - [ ] **Claude** Auth check via `getUser()` — **does not reject guests**; result determines whether Supabase writes happen
  - [ ] **Claude** Input validation (empty check, 10,000 character max) — applied to both guests and auth users
  - [ ] **Claude** Conversation ownership check — runs **only for authenticated users** (clean 403 if `chatId` doesn't belong to them)
  - [ ] **Claude** `createDataStreamResponse` wrapper with process log event emissions
  - [ ] **Claude** `streamText` call with surf trip system prompt and full conversation history
  - [ ] **Claude** `onFinish`: if guest → early return (client handles localStorage); if auth → save messages to Supabase, auto-title on first turn, bump `updated_at`

---

### Phase 7 — Chat UI

- [ ] **Claude** Write `app/(app)/chat/[id]/page.tsx` — Server Component shell: checks auth, fetches initial Supabase messages for auth users (passes `[]` for guests), renders `ChatView` with `chatId`, `initialMessages`, `isAuthenticated`
- [ ] **Claude** Write `app/(app)/chat/[id]/ChatView.tsx` — Client Component:
  - [ ] **Claude** `useChat` with `DefaultChatTransport` and `prepareSendMessagesRequest` (sends `chatId` in body)
  - [ ] **Claude** `onData` callback wiring to `addStep` from process log context
  - [ ] **Claude** `onFinish`: if guest → `appendMessages` + `updateTitle` to localStorage + `router.refresh()`; if auth → `router.refresh()` only (Supabase write in API route)
  - [ ] **Claude** Guest `useEffect`: on mount, call `loadConversation(chatId)` and `setMessages()` to hydrate from localStorage
  - [ ] **Claude** `handleClear`: if guest → `deleteConversation(chatId)`; if auth → Supabase `DELETE`; then `router.push('/')`
- [ ] **Claude** Write `app/(app)/chat/[id]/chat.module.css`
- [ ] **Claude** Write `components/ChatMessages.tsx` — parts-based message rendering, streaming cursor (`▊`) on last assistant message, scroll-to-bottom, empty state, error state
- [ ] **Claude** Write `components/ChatMessages.module.css`
- [ ] **Claude** Write `components/ChatInput.tsx` — auto-resize textarea, Enter to send / Shift+Enter for newline, Send button, Stop button (while streaming), Clear button, disabled while `isActive`
- [ ] **Claude** Write `components/ChatInput.module.css`

---

### Phase 8 — Styling Pass

- [ ] **Claude** Write `app/globals.css` — design tokens (`--bg`, `--surface`, `--border`, `--text`, `--accent`, etc.), CSS reset
- [ ] **Claude** Audit all `.module.css` files for visual consistency
- [ ] **Claude** Verify streaming cursor animation works
- [ ] **Claude** Verify three-column layout holds at 1280px+ and degrades gracefully below

---

### Phase 9 — Integration QA

**Guest path (no account required):**

- [ ] **You** Run `npm run dev`, open `http://localhost:3000` — verify you land in a chat without signing in
- [ ] **You** Send a first message — verify optimistic display, process log populates, streaming text appears with cursor
- [ ] **You** Verify conversation title auto-updates in sidebar after first message
- [ ] **You** Refresh the page — verify messages survive the refresh (loaded from `localStorage`)
- [ ] **You** Send a follow-up message — verify conversation history is maintained across the stream
- [ ] **You** Click "Clear conversation" — verify conversation is removed from localStorage and sidebar, redirected to `/`
- [ ] **You** Create a second conversation from the sidebar — verify both appear in the sidebar
- [ ] **You** Open a new incognito window — verify it starts completely fresh (no localStorage bleed)
- [ ] **You** Click "Sign in to sync across devices" link — verify it navigates to `/login`

**Auth path:**

- [ ] **You** Sign up with a new account, confirm email, sign in — verify redirect to `/`
- [ ] **You** Verify conversations now save to Supabase (check Supabase Table Editor)
- [ ] **You** Sign out, sign back in on a different browser — verify conversations are still there (cross-device sync)
- [ ] **You** Verify that visiting `/login` while signed in redirects to `/`

**Shared / edge cases:**

- [ ] **You** Test empty message submission — verify send button stays disabled
- [ ] **You** Test a very long message (10,000+ characters) — verify client blocks it before sending
- [ ] **You** Test clicking "Stop" mid-stream — verify stream halts, input re-enables
- [ ] **You** Hit `POST /api/chat` directly via curl without auth and with a valid payload — verify it streams (guests are allowed)

---

### Phase 10 — Deploy

- [ ] **You** Push the repo to GitHub (`git push origin main`)
- [ ] **You** Go to Vercel → Add New Project → Import the `surftrip` GitHub repo
- [ ] **You** In Vercel project settings → Environment Variables: add all three values from `.env.local`
- [ ] **You** Trigger a deploy, copy the production URL
- [ ] **You** In Supabase → Authentication → URL Configuration: add the Vercel production URL to Redirect URLs
- [ ] **You** Test the live deploy: sign up, send a message, verify streaming works end-to-end

---

### Phase 11 — README

- [ ] **Claude** Write `README.md`:
  - [ ] **Claude** One-paragraph description of the app
  - [ ] **Claude** Live demo link (placeholder — you fill in the Vercel URL)
  - [ ] **Claude** Vercel deploy button
  - [ ] **Claude** 5-step local setup instructions
  - [ ] **Claude** Stack table
  - [ ] **Claude** Screenshot placeholder (you add after deploy)
- [ ] **You** Add the live Vercel URL and a screenshot to the README
- [ ] **You** Final review of the public repo before submitting to Spotnana

---
