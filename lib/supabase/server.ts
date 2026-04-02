import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types";

// ── createClient ───────────────────────────────────────────────────────────
//
// Returns a Supabase client for use in Server Components, route handlers, and
// middleware. For Client Components and browser contexts, use client.ts instead.
export async function createClient() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(
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
            // cookieStore.set() throws when called from a Server Component
            // (as opposed to a route handler or middleware), because Server
            // Components cannot set response headers. This is expected —
            // the middleware handles session cookie refresh for those cases.
          }
        },
      },
    },
  );
}
