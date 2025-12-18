import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker, { type Env } from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function call(path: string) {
  const res = await worker.fetch(
    new IncomingRequest(`http://x${path}`),
    env as Env
  );
  return res.json() as Promise<Record<string, unknown>>;
}

describe("Bindings", () => {
  it("/ lists routes", async () => {
    const data = await call("/");
    expect(data.routes).toContain("/test/d1");
  });
  it("/test/d1", async () =>
    expect((await call("/test/d1")).success).toBe(true));
  it("/test/do", async () => expect((await call("/test/do")).id).toBeDefined());
  it("/test/r2", async () =>
    expect((await call("/test/r2")).success).toBe(true));
  it("/test/ai", async () =>
    expect((await call("/test/ai")).dimensions).toBe(768));
});
