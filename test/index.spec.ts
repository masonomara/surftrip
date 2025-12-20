import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker, { type Env } from "../src/index";

// ============================================================================
// Route Tests
// ============================================================================

describe("Routes", () => {
  it("/ returns auth demo page", async () => {
    const request = new Request("http://localhost/");
    const response = await worker.fetch(request, env as Env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
  });

  it("unknown routes return available routes", async () => {
    const request = new Request("http://localhost/unknown");
    const response = await worker.fetch(request, env as Env);

    const data = (await response.json()) as { routes: string[] };

    expect(data.routes).toContain("/api/messages");
    expect(data.routes).toContain("/callback");
    expect(data.routes).toContain("/");
  });
});
