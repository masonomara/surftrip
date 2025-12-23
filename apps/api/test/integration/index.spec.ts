// =============================================================================
// Worker Integration Tests
// =============================================================================
//
// Tests for the main worker routes and request handling.
// These tests run against the actual worker without mocking.

import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker, { type Env } from "../../src/index";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Helper to make requests to the worker for testing
 */
async function fetchWorker(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const request = new Request(`http://localhost${path}`, init);
  return worker.fetch(request, env as unknown as Env);
}

// =============================================================================
// Route Tests
// =============================================================================

describe("Routes", () => {
  // ---------------------------------------------------------------------------
  // Basic Route Handling
  // ---------------------------------------------------------------------------

  describe("Root and Unknown Routes", () => {
    it("returns 404 for root path", async () => {
      const response = await fetchWorker("/");

      expect(response.status).toBe(404);
    });

    it("returns 404 for unknown routes", async () => {
      const response = await fetchWorker("/unknown");

      expect(response.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Teams Message Endpoint
  // ---------------------------------------------------------------------------

  describe("/api/messages", () => {
    it("returns 405 for GET requests (POST only)", async () => {
      const response = await fetchWorker("/api/messages");

      expect(response.status).toBe(405);
    });

    it("ignores non-message activity types", async () => {
      // Teams sends various activity types (conversationUpdate, typing, etc.)
      // Only 'message' type should be processed for responses
      const conversationUpdatePayload = {
        type: "conversationUpdate",
        from: { aadObjectId: "test-aad-id" },
        conversation: { id: "test-conv-id" },
      };

      const response = await fetchWorker("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conversationUpdatePayload),
      });

      // Should return 200 OK but not generate a message response
      expect(response.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Clio OAuth Callback
  // ---------------------------------------------------------------------------

  describe("/clio/callback", () => {
    it("redirects with error when authorization code is missing", async () => {
      // OAuth callback without a code query param should redirect with error
      const response = await fetchWorker("/clio/callback", {
        redirect: "manual", // Don't follow redirect so we can inspect it
      });

      expect(response.status).toBe(302);

      const redirectLocation = response.headers.get("Location");
      expect(redirectLocation).toContain("/settings/clio?error=");
    });
  });
});
