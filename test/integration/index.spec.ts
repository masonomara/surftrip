import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker, { type Env } from "../../src/index";

describe("Routes", () => {
  it("/ returns 404", async () => {
    const request = new Request("http://localhost/");
    const response = await worker.fetch(request, env as Env);

    expect(response.status).toBe(404);
  });

  it("unknown routes return 404", async () => {
    const request = new Request("http://localhost/unknown");
    const response = await worker.fetch(request, env as Env);

    expect(response.status).toBe(404);
  });

  it("/api/messages returns 405 for GET", async () => {
    const request = new Request("http://localhost/api/messages");
    const response = await worker.fetch(request, env as Env);

    expect(response.status).toBe(405);
  });

  it("/callback returns 400 without code", async () => {
    const request = new Request("http://localhost/callback");
    const response = await worker.fetch(request, env as Env);

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe("Missing authorization code");
  });
});
