import { defineConfig } from "vitest/config";

/**
 * E2E test configuration
 *
 * These tests run against a live deployed worker (or local dev server).
 * They're separate from unit/integration tests because they:
 * - Don't use the workers pool (no miniflare)
 * - Make real HTTP requests
 * - Test the full request/response cycle
 *
 * Run with: npm run test:e2e
 * Requires: WORKER_URL environment variable (defaults to localhost:8787)
 */
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.spec.ts"],
  },
});
