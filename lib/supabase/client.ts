import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types";

// Returns a Supabase client for use in Client Components and browser contexts.
// For Server Components, route handlers, and middleware, use lib/supabase/server.ts instead.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
