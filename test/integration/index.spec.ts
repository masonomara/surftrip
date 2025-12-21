import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker, { type Env } from "../../src/index";

/**
 * Helper to make requests to the worker.
 */
async function fetchWorker(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const request = new Request(`http://localhost${path}`, init);
  return worker.fetch(request, env as Env);
}

describe("Routes", () => {
  describe("root path", () => {
    it("returns 404", async () => {
      const response = await fetchWorker("/");

      expect(response.status).toBe(404);
    });
  });

  describe("unknown routes", () => {
    it("returns 404", async () => {
      const response = await fetchWorker("/unknown");

      expect(response.status).toBe(404);
    });
  });

  describe("/api/messages", () => {
    it("returns 405 for GET requests", async () => {
      const response = await fetchWorker("/api/messages");

      expect(response.status).toBe(405);
    });
  });

  describe("/callback (Clio OAuth)", () => {
    it("returns 400 without authorization code", async () => {
      const response = await fetchWorker("/callback");
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toBe("Missing authorization code");
    });
  });
});
