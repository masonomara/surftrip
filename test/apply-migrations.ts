/**
 * This file runs before all tests to apply database migrations.
 * It ensures the test database has the correct schema.
 */
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
