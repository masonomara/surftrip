import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";

/**
 * Extends the cloudflare:test environment with our test-specific bindings.
 */
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

/**
 * Allows importing SQL files as raw strings for migrations.
 */
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
