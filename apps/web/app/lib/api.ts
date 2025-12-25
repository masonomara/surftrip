import { API_URL } from "./auth-client";

/**
 * Makes an authenticated API request, using the service binding when available
 * (for server-side requests in Cloudflare Workers) or falling back to fetch.
 *
 * @param context - The loader/action context from React Router
 * @param path - API path like "/api/auth/get-session"
 * @param cookie - The cookie header from the incoming request
 */
export async function apiFetch(
  context: unknown,
  path: string,
  cookie: string
): Promise<Response> {
  const requestOptions = {
    headers: { Cookie: cookie },
  };

  // Try to use the Cloudflare service binding if available (server-side)
  const cloudflareContext = context as {
    cloudflare?: {
      env?: {
        API?: { fetch: typeof fetch };
      };
    };
  };

  const serviceBinding = cloudflareContext.cloudflare?.env?.API;

  if (serviceBinding) {
    try {
      const request = new Request(
        `https://api.docketadmin.com${path}`,
        requestOptions
      );
      return await serviceBinding.fetch(request);
    } catch (error) {
      // Service binding failed, fall through to regular fetch
      console.error("Service binding fetch failed:", error);
    }
  }

  // Fallback to regular fetch (client-side or if service binding unavailable)
  return fetch(`${API_URL}${path}`, requestOptions);
}
