/**
 * Authentication configuration using Better Auth
 *
 * Supports:
 * - Email/password authentication
 * - Apple Sign In
 * - Google Sign In
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

/**
 * Environment variables required for authentication
 */
export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;

  // Apple OAuth
  APPLE_CLIENT_ID: string;
  APPLE_CLIENT_SECRET: string;
  APPLE_APP_BUNDLE_IDENTIFIER: string;

  // Google OAuth
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

/**
 * Creates a configured Better Auth instance
 *
 * Uses Drizzle ORM with SQLite (D1) for session and user storage.
 * Enables email/password plus Apple and Google social login.
 */
export function getAuth(env: AuthEnv) {
  const db = drizzle(env.DB);

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,

    // Enable email/password authentication
    emailAndPassword: {
      enabled: true,
    },

    // Social login providers
    socialProviders: {
      apple: {
        clientId: env.APPLE_CLIENT_ID,
        clientSecret: env.APPLE_CLIENT_SECRET,
        appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },

    // Required for Apple Sign In redirect
    trustedOrigins: ["https://appleid.apple.com"],
  });
}
