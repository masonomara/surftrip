# Surftrip.com

## Development Ethos

Always code as if the guy who ends up maintaining your code will be a violent psychopath who knows where you live. Code for readability.

## Development Rules

- Schema in `lib/types.ts` is single source of truth
- No type is defined anywhere else in the codebase
- No `as SomeType[]` = if you need a cast, fix the schema and regenerate
- Regenerate types everytime the schema changes, not at the end
- If TypeScript can;t infer from `database.ts`, the schema is wrong. Fix the schema, regenerate
- No brwoser check = no next step

## Project Objective

This task is designed to simulate a real-world scenario, giving you the chance to showcase your skills. We’re not looking for perfection — we want to see how you solve problems and communicate effectively.

### Assessment Overview

- Role: Frontend Engineer
- Challenge: Build an AI-integrated web app with clean UI and solid architecture
- Stack: React, Angular, Vue or NextJS (your choice)

### Objective

Create a lightweight app where a user can input a prompt, submit it to an AI API (e.g., OpenAI), and receive/display a response. Focus on:

- Prompt input + submit button
- Fetching from OpenAI or HuggingFace
- Displaying results dynamically
- Error handling and loading states

### Bonus (+10 pts)

- Save and show past prompts/responses (chat history)
- Include a “Clear” button for the user
- Submission Instructions
- Create a public GitHub repository
- Include a simple README.md with setup instructions

## Key Reminders

- `OPENAI_API_KEY` — never prefix with `NEXT_PUBLIC_`. It must only appear in `app/api/chat/route.ts`.
- `params` in Next.js 15 pages/layouts is a `Promise` — always `await params` or use `useEffect` to resolve it client-side.
- `cookies()` from `next/headers` is async in Next.js 15 — always `await cookies()`.
- Middleware must return `supabaseResponse` as-is — never create a new `NextResponse` without copying its cookies.
- `getClaims()` in middleware (local JWT read, no network). `getUser()` in route handlers (validates with Supabase Auth server).
- RLS is enforced at the DB layer — route handlers don't need manual `WHERE user_id = ?` guards, but an explicit conversation ownership check in the route handler gives a cleaner 403 response.
- `onFinish` in `streamText` is async — use `await` and handle errors with try/catch (errors there are non-fatal to the stream but must be logged).
- `router.refresh()` after mutations (new conversation, message sent) to revalidate Server Component data (the sidebar list).
