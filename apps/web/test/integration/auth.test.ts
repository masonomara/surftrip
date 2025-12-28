import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";

/**
 * Integration tests for authentication flow.
 *
 * These tests verify that the web app works correctly with the API.
 * Run with: npm run test:integration
 *
 * Prerequisites:
 * - API server running on localhost:8787 (npm run dev in apps/api)
 * - D1 database initialized (wrangler d1 migrations apply)
 */

const API_URL = process.env.API_URL || "http://localhost:8787";
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const API_DIR = resolve(__dirname, "../../../api");

// Generate unique email for each test run to avoid conflicts
const TEST_EMAIL = `test-${Date.now()}@example.com`;
const TEST_PASSWORD = "SecureP@ssw0rd123";
const TEST_NAME = "Test User";

// Store cookies between requests
let sessionCookie: string | null = null;
let testUserId: string | null = null;

/**
 * Helper to execute SQL against the local D1 database
 */
function executeD1(sql: string): void {
  try {
    execSync(`npx wrangler d1 execute docket-db --local --command "${sql}"`, {
      cwd: API_DIR,
      stdio: "pipe",
    });
  } catch {
    // Ignore errors - command may not have output
  }
}

/**
 * Helper to verify a user's email directly in the database
 */
function verifyEmailInDb(email: string): void {
  executeD1(`UPDATE user SET email_verified = 1 WHERE email = '${email}'`);
}

/**
 * Helper to extract cookies from response headers
 */
function extractCookies(response: Response): string {
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  return setCookieHeaders
    .map((cookie: string) => cookie.split(";")[0])
    .join("; ");
}

/**
 * Helper to make authenticated requests
 */
async function authFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Origin: WEB_ORIGIN, // Required for CSRF protection - must match trustedOrigins
    ...(options.headers || {}),
  };

  if (sessionCookie) {
    (headers as Record<string, string>)["Cookie"] = sessionCookie;
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
}

describe("Authentication Flow", () => {
  beforeAll(() => {
    // Skip tests if INTEGRATION flag is not set
    if (!process.env.INTEGRATION) {
      console.log("Skipping integration tests. Set INTEGRATION=true to run.");
    }
  });

  afterAll(() => {
    // Clean up
    sessionCookie = null;
  });

  it("creates a new account", async () => {
    if (!process.env.INTEGRATION) return;

    const response = await authFetch("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        name: TEST_NAME,
      }),
    });

    // Better Auth returns 200 on success
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(TEST_EMAIL);
    expect(data.user.name).toBe(TEST_NAME);

    // Store user ID for later tests
    testUserId = data.user.id;

    // Verify email directly in database for subsequent tests
    // This simulates the user clicking the verification link
    verifyEmailInDb(TEST_EMAIL);
  });

  it("retrieves session with cookie", async () => {
    if (!process.env.INTEGRATION) return;

    // First, sign in to get a session cookie
    const signInResponse = await authFetch("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      }),
    });

    expect(signInResponse.ok).toBe(true);

    // Store the session cookie
    const cookies = extractCookies(signInResponse);
    if (cookies) {
      sessionCookie = cookies;
    }

    expect(sessionCookie).toBeTruthy();

    // Now verify we can get the session
    const sessionResponse = await authFetch("/api/auth/get-session", {
      method: "GET",
    });

    expect(sessionResponse.ok).toBe(true);

    const session = await sessionResponse.json();
    expect(session.user).toBeDefined();
    expect(session.user.email).toBe(TEST_EMAIL);
    expect(session.session).toBeDefined();
    expect(session.session.id).toBeDefined();
  });

  it("fails to access protected route without session", async () => {
    if (!process.env.INTEGRATION) return;

    // Clear the session cookie
    const savedCookie = sessionCookie;
    sessionCookie = null;

    // Try to access a protected API endpoint without a session
    const response = await authFetch("/api/user/org", {
      method: "GET",
    });

    // Should return 401 Unauthorized
    expect(response.status).toBe(401);

    // Restore cookie for next test
    sessionCookie = savedCookie;
  });

  it("signs out successfully", async () => {
    if (!process.env.INTEGRATION) return;

    // Make sure we have a session first
    if (!sessionCookie) {
      const signInResponse = await authFetch("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        }),
      });

      const cookies = extractCookies(signInResponse);
      if (cookies) {
        sessionCookie = cookies;
      }
    }

    // Sign out (requires Content-Type header and Origin)
    const signOutResponse = await authFetch("/api/auth/sign-out", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(signOutResponse.ok).toBe(true);

    // Update cookies from sign-out response (should clear session)
    const cookies = extractCookies(signOutResponse);
    if (cookies) {
      sessionCookie = cookies;
    }

    // Verify session is invalid
    const sessionResponse = await authFetch("/api/auth/get-session", {
      method: "GET",
    });

    const session = await sessionResponse.json();
    // Session response should be null or have null user after sign out
    const hasNoSession = session === null || session.user === null;
    expect(hasNoSession).toBe(true);
  });
});
