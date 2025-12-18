import { DurableObject } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  TENANT: DurableObjectNamespace;
  R2: R2Bucket;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}

export class TenantDO extends DurableObject {
  async fetch(): Promise<Response> {
    const count = ((await this.ctx.storage.get<number>("count")) || 0) + 1;
    await this.ctx.storage.put("count", count);
    return Response.json({ id: this.ctx.id.toString(), count });
  }
}

const routes: Record<string, (req: Request, env: Env) => Promise<Response>> = {
  "/test/d1": async (_, env) => {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS test_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`
    ).run();
    const result = await env.DB.prepare(
      "INSERT INTO test_accounts (name) VALUES (?) RETURNING *"
    )
      .bind("Test")
      .run();
    return Response.json({ success: true, inserted: result.results });
  },
  "/test/do": async (req, env) =>
    env.TENANT.get(env.TENANT.idFromName("test")).fetch(req),
  "/test/r2": async (_, env) => {
    const key = "test/verify.json";
    await env.R2.put(key, "{}", {
      httpMetadata: { contentType: "application/json" },
    });
    const content = await (await env.R2.get(key))?.text();
    return Response.json({ success: true, content });
  },
  "/test/ai": async (_, env) => {
    const result = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: "test",
    })) as { data: number[][] };
    const embedding = result.data[0];
    await env.VECTORIZE.upsert([
      { id: "test-1", values: embedding, metadata: {} },
    ]);
    const query = await env.VECTORIZE.query(embedding, { topK: 1 });
    return Response.json({
      success: true,
      dimensions: embedding.length,
      match: query.matches[0],
    });
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const handler = routes[new URL(request.url).pathname];
    return handler
      ? handler(request, env)
      : Response.json({ routes: Object.keys(routes) });
  },
};
