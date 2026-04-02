import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // If Supabase is not configured, skip session handling entirely and run in
  // guest-only mode. The app still works — conversation history is stored in
  // localStorage instead of the database.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.next({ request });
  }

  // supabaseResponse must be returned from this function as-is (or used as the
  // base for any redirect/rewrite). Never create a plain `new NextResponse()`
  // here — it won't carry the session cookies that Supabase sets, which causes
  // random session logouts.
  let supabaseResponse = NextResponse.next({ request });

  // !! Do NOT put any logic between createServerClient and getClaims() !!
  // The cookie setAll callback below mutates supabaseResponse. Any code between
  // these two calls risks running before that mutation completes and operating
  // on a stale response — causing intermittent session bugs that are hell to debug.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          // First pass: write cookies onto the request so the updated values
          // are available to any downstream code in this request lifecycle.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // Second pass: write cookies onto the response so the browser
          // receives the updated session on the way out.
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims() reads the JWT from the cookie — no network call.
  // Use this in middleware (fast). Use getUser() in route handlers (validates
  // with the Supabase Auth server, slower but authoritative).
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const { pathname } = request.nextUrl;

  // Redirect authenticated users away from auth pages back to the app.
  // Guests are never redirected — the whole app is accessible without signing in.
  if (
    user &&
    (pathname.startsWith("/login") || pathname.startsWith("/signup"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

// Run this proxy on every request except Next.js internals and static assets.
// The negative lookahead excludes: _next/static, _next/image, favicon.ico,
// and any path ending in an image extension.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
