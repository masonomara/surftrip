# Surftrip — Frontend Engineer Technical Assessment

AI-powered surf trip planning assistant. Users input a destination prompt,
the app calls OpenAI, and streams a real-time response with swell forecasts,
wind, tides, and travel logistics.

**Live demo:** https://www.surftrip.fun

---

## Stack

- Next.js 16 (App Router) + React 19
- OpenAI gpt-4o-mini via Vercel AI SDK
- TypeScript (strict)
- Supabase auth + PostgreSQL — optional, app works without it

## Setup

### 1. Clone & install

```bash
git clone https://github.com/masonomara/surftrip.git
cd surftrip
npm install
```

### 2. Environment

```bash
cp .env.example .env.local
```

Add your OpenAI key to `.env.local` — get one at platform.openai.com/api-keys.
The Supabase vars are optional (see below).

### 3. Run

```bash
npm run dev
```

Open http://localhost:3000. Works immediately — no database required.

---

## Optional: persistent auth (Supabase)

Without Supabase, conversation history lives in localStorage. To enable user
accounts and cross-device history:

1. Add to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_anon_key
```

2. Run `lib/supabase/schema.sql` in the Supabase SQL editor.

---

## Tests

```bash
npm run test
```
