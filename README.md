# Surftrip

AI-powered surf trip planning assistant. Ask about any destination — get real-time swell forecasts, wind conditions, tides, gear recommendations, and travel logistics in one response.

**Live demo:** https://www.surftrip.fun

## Stack

- Next.js 16 (App Router) + React 19
- OpenAI gpt-4o-mini via Vercel AI SDK
- Supabase (auth + PostgreSQL) — optional
- TypeScript (strict)

## Setup

### 1. Clone & install

```bash
git clone https://github.com/masonomara/surftrip.git
cd surftrip
npm install
```

### 2. Environment variables

Create `.env.local` using `.env.example` as a template. Fill in your OpenAI key ([get one at platform.openai.com/api-keys](https://platform.openai.com/api-keys)) — the Supabase vars are optional, see below.

### 3. Run

```bash
npm run dev
```

Open http://localhost:3000. The app works immediately — conversation history is stored in localStorage.

---

## Optional: Supabase (auth + persistent history)

Without Supabase the app runs in guest-only mode. To enable user accounts and cross-device conversation history, add Supabase:

### 1. Add credentials to `.env.local`

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

### 2. Run the schema in your Supabase SQL editor

Copy the contents of [`lib/supabase/schema.sql`](lib/supabase/schema.sql) and run it in the Supabase SQL editor. This creates the tables, indexes, triggers, and RLS policies.

Once both env vars are present, sign-up and login become available at `/signup` and `/login`.
