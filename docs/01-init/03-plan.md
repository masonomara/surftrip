# Surftrip — Implementation Plan

Full plan for building the Spotnana take-home assessment. Each step is self-contained. Steps 2 and 3 produce SQL files you run in the Supabase SQL editor; all other steps produce source files.

---

## Steps at a Glance

| #   | Step                    | Output                                                                                  |
| --- | ----------------------- | --------------------------------------------------------------------------------------- |
| 1   | Project bootstrap       | `package.json`, `next.config.ts`, `tsconfig.json`                                       |
| 2   | Database schema         | `supabase/schema.sql` — run in Supabase SQL editor                                      |
| 3   | Sample data             | `supabase/seed.sql` — run in Supabase SQL editor                                        |
| 4   | Environment variables   | `.env.example`, `.env.local`                                                            |
| 5   | Supabase clients        | `lib/supabase/client.ts`, `lib/supabase/server.ts`                                      |
| 6   | TypeScript types        | `lib/types.ts`                                                                          |
| 7   | Middleware              | `middleware.ts`                                                                         |
| 8   | Auth pages              | `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`, `app/auth/callback/route.ts` |
| 9   | App shell layout        | `app/(app)/layout.tsx`                                                                  |
| 10  | Conversation sidebar    | `components/ConversationSidebar.tsx`                                                    |
| 11  | API route               | `app/api/chat/route.ts`                                                                 |
| 12  | Chat page               | `app/(app)/chat/[id]/page.tsx`                                                          |
| 13  | ChatMessages            | `components/ChatMessages.tsx`                                                           |
| 14  | ChatInput               | `components/ChatInput.tsx`                                                              |
| 15  | ProcessLog              | `components/ProcessLog.tsx`                                                             |
| 16  | Root redirect           | `app/(app)/page.tsx`                                                                    |
| 17  | CSS Modules             | `app/globals.css`, `components/*.module.css`                                            |
| 18  | README + `.env.example` | `README.md`                                                                             |

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
│   │   └── layout.tsx
│   ├── api/
│   │   └── chat/
│   │       └── route.ts
│   └── auth/
│       └── callback/
│           └── route.ts
├── components/
├── lib/
│   └── supabase/
├── supabase/
│   ├── schema.sql
│   └── seed.sql
├── .env.example
├── middleware.ts
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
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

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
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
            // Called from a Server Component — safe to ignore.
            // The middleware handles session refresh.
          }
        },
      },
    },
  );
}
```

The `try/catch` in `setAll` is intentional: Server Components are read-only after they start rendering, so `cookieStore.set` will throw. Suppressing it is correct because the middleware (Step 7) is responsible for writing the refreshed session cookie on every request.

---

## Step 6 — TypeScript Types

**`lib/types.ts`**

```ts
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

## Step 7 — Middleware

**`middleware.ts`** — lives at the project root (same level as `app/`).

Runs on every request. Refreshes the Supabase session token and redirects unauthenticated users to `/login`.

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Do NOT put any code between createServerClient and getClaims().
  // A mistake here causes random session logouts.
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

  // getClaims() reads the JWT locally — no network call.
  // Use this in middleware. Use getUser() in route handlers.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const { pathname } = request.nextUrl;

  if (
    !user &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/signup") &&
    !pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
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
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

Three-column layout: sidebar | main | process log. This is a Server Component — it fetches the conversation list for the sidebar on the server before rendering.

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ConversationSidebar from "@/components/ConversationSidebar";
import ProcessLog from "@/components/ProcessLog";
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

  if (!user) redirect("/login");

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div className={styles.shell}>
      <ConversationSidebar
        conversations={conversations ?? []}
        userId={user.id}
      />
      <main className={styles.main}>{children}</main>
      <ProcessLog />
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

The sidebar is rendered server-side (passed conversations as props) but the "New chat" button and sign-out trigger client actions. The active conversation is highlighted client-side via `usePathname`.

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Conversation } from "@/lib/types";
import styles from "./ConversationSidebar.module.css";

type Props = {
  conversations: Pick<Conversation, "id" | "title" | "updated_at">[];
  userId: string;
};

export default function ConversationSidebar({ conversations }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleNewChat() {
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
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
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
            className={`${styles.item} ${pathname === `/chat/${c.id}` ? styles.active : ""}`}
          >
            {c.title}
          </Link>
        ))}
      </nav>

      <div className={styles.footer}>
        <button onClick={handleSignOut} className={styles.signOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
```

---

## Step 11 — API Route: POST /api/chat

**`app/api/chat/route.ts`**

The most important server file. This is where the AI lives.

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
  // 1. Authenticate
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse and validate input
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

  // 3. Verify the conversation belongs to this user (RLS also enforces this,
  //    but an explicit check gives a cleaner 403 rather than an empty result)
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", chatId)
    .single();

  if (!conversation) {
    return new Response("Conversation not found", { status: 403 });
  }

  // 4. Stream response with process log events
  return createDataStreamResponse({
    execute: async (writer) => {
      // Emit process steps before and during the AI call.
      // transient: true means these are delivered to the client but not
      // stored in message history — they only appear in the process log.
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
          // Save both the user message and the completed assistant message.
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
          // Only runs if the title is still the default.
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

          // updated_at trigger fires automatically on conversations update above,
          // but if we only inserted messages we need to bump it manually.
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

**`app/(app)/chat/[id]/page.tsx`**

This is a Client Component. It owns the `useChat` state, process log state, and renders `ChatMessages`, `ChatInput`, and passes process steps to `ProcessLog` via a shared state mechanism (context or prop drilling — context is cleaner here).

Because `ProcessLog` lives in the layout and this page is a child, use a React context to share process step state between the page and the layout's process log panel.

**`lib/process-log-context.tsx`** — context for passing process steps up to the layout:

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

Update `app/(app)/layout.tsx` to wrap children in `ProcessLogProvider`:

```tsx
import { ProcessLogProvider } from "@/lib/process-log-context";

// In the return:
<div className={styles.shell}>
  <ConversationSidebar conversations={conversations ?? []} userId={user.id} />
  <ProcessLogProvider>
    <main className={styles.main}>{children}</main>
    <ProcessLog />
  </ProcessLogProvider>
</div>;
```

**`app/(app)/chat/[id]/page.tsx`**:

```tsx
"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useProcessLog } from "@/lib/process-log-context";
import ChatMessages from "@/components/ChatMessages";
import ChatInput from "@/components/ChatInput";
import styles from "./chat.module.css";

type Props = {
  params: Promise<{ id: string }>;
};

export default function ChatPage({ params }: Props) {
  const router = useRouter();
  const { addStep, clearSteps } = useProcessLog();
  const chatIdRef = useRef<string | null>(null);

  // Resolve dynamic route params (Next.js 15: params is a Promise)
  useEffect(() => {
    params.then(({ id }) => {
      chatIdRef.current = id;
    });
  }, [params]);

  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: {
          messages,
          chatId: chatIdRef.current ?? id,
        },
      }),
    }),
    onData: (dataPart) => {
      if (dataPart.type === "data-process") {
        addStep((dataPart.data as { step: string }).step);
      }
    },
    onError: () => {
      // error is already surfaced via the error return value
    },
    onFinish: () => {
      // Refresh the sidebar to show updated title + recency sort
      router.refresh();
    },
  });

  function handleSend(text: string) {
    clearSteps();
    sendMessage({ text });
  }

  async function handleClear() {
    const resolved = await params;
    const supabase = createClient();
    await supabase.from("conversations").delete().eq("id", resolved.id);
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

## Step 16 — Root Redirect

**`app/(app)/page.tsx`**

When the user navigates to `/`, create a new conversation and redirect into it.

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Redirect to the most recent conversation if one exists
  const { data: latest } = await supabase
    .from("conversations")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (latest) {
    redirect(`/chat/${latest.id}`);
  }

  // No conversations yet — create a new one
  const { data: created } = await supabase
    .from("conversations")
    .insert({ user_id: user.id, title: "New conversation" })
    .select("id")
    .single();

  if (created) {
    redirect(`/chat/${created.id}`);
  }

  // Fallback — should not happen
  redirect("/login");
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

## Key Reminders

- `OPENAI_API_KEY` — never prefix with `NEXT_PUBLIC_`. It must only appear in `app/api/chat/route.ts`.
- `params` in Next.js 15 pages/layouts is a `Promise` — always `await params` or use `useEffect` to resolve it client-side.
- `cookies()` from `next/headers` is async in Next.js 15 — always `await cookies()`.
- Middleware must return `supabaseResponse` as-is — never create a new `NextResponse` without copying its cookies.
- `getClaims()` in middleware (local JWT read, no network). `getUser()` in route handlers (validates with Supabase Auth server).
- RLS is enforced at the DB layer — route handlers don't need manual `WHERE user_id = ?` guards, but an explicit conversation ownership check in the route handler gives a cleaner 403 response.
- `onFinish` in `streamText` is async — use `await` and handle errors with try/catch (errors there are non-fatal to the stream but must be logged).
- `router.refresh()` after mutations (new conversation, message sent) to revalidate Server Component data (the sidebar list).
