import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./encryption";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../services/email";
import { createLogger, generateRequestId } from "./logger";

/**
 * Number of PBKDF2 iterations for password hashing.
 * 100,000 is the OWASP recommended minimum for SHA-256.
 * Higher values increase security but also increase login time.
 */
const PBKDF2_ITERATIONS = 100_000;

/**
 * Derives a 256-bit key from a password using PBKDF2-SHA256.
 *
 * PBKDF2 (Password-Based Key Derivation Function 2) is a key stretching
 * algorithm that makes brute-force attacks computationally expensive.
 *
 * @param password - The user's plaintext password
 * @param salt - A random 16-byte salt (unique per password)
 * @returns A 256-bit (32-byte) derived key
 */
async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<ArrayBuffer> {
  // Import the password as raw key material for PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false, // Not extractable
    ["deriveBits"]
  );

  // Derive 256 bits using PBKDF2 with SHA-256
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256 // Output length in bits
  );
}

/**
 * Hashes a password for secure storage.
 *
 * Uses PBKDF2-SHA256 with a random salt. The output format is:
 * "{base64-salt}:{base64-hash}"
 *
 * This format is self-describing - the salt is stored alongside the hash,
 * allowing verification without needing a separate salt lookup.
 *
 * @param password - The plaintext password to hash
 * @returns A string in format "salt:hash" suitable for database storage
 */
async function hashPassword(password: string): Promise<string> {
  // Generate a random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive the hash
  const hash = await deriveKeyFromPassword(password, salt);

  // Return as "salt:hash" format
  return `${arrayBufferToBase64(salt.buffer)}:${arrayBufferToBase64(hash)}`;
}

/**
 * Verifies a password against a stored hash.
 *
 * Uses constant-time comparison to prevent timing attacks.
 * An attacker cannot determine how much of the password is correct
 * based on how long the verification takes.
 *
 * @param password - The plaintext password to verify
 * @param hash - The stored hash in "salt:hash" format
 * @returns true if the password matches, false otherwise
 */
export async function verifyPassword({
  password,
  hash,
}: {
  password: string;
  hash: string;
}): Promise<boolean> {
  // Parse the stored hash
  const [saltBase64, storedHashBase64] = hash.split(":");

  if (!saltBase64 || !storedHashBase64) {
    return false;
  }

  // Decode the salt and stored hash
  const salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
  const storedHash = new Uint8Array(base64ToArrayBuffer(storedHashBase64));

  // Compute the hash of the provided password
  const computedHash = new Uint8Array(
    await deriveKeyFromPassword(password, salt)
  );

  // Verify lengths match (should always be true, but check anyway)
  if (storedHash.length !== computedHash.length) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  // XOR all bytes and accumulate differences
  let difference = 0;
  for (let i = 0; i < storedHash.length; i++) {
    difference |= storedHash[i] ^ computedHash[i];
  }

  // If all bytes matched, difference will be 0
  return difference === 0;
}

/**
 * Environment variables required for authentication.
 */
export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APPLE_CLIENT_ID: string;
  APPLE_CLIENT_SECRET: string;
  APPLE_APP_BUNDLE_IDENTIFIER: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  ENVIRONMENT?: string;
}

/**
 * Creates and configures the Better Auth instance.
 *
 * This is the main authentication configuration for the app.
 * It supports:
 * - Email/password authentication with email verification
 * - Apple and Google social login
 * - Password reset via email
 * - Cross-subdomain cookies for production
 *
 * @param env - Environment variables containing secrets and config
 * @returns A configured Better Auth instance
 */
export function getAuth(env: AuthEnv) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,

    // Email/password auth configuration
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
      sendResetPassword: async ({ user, url }) => {
        const result = await sendPasswordResetEmail(env, {
          to: user.email,
          resetUrl: url,
        });

        if (!result.success) {
          console.error("Failed to send password reset email:", result.error);
        }
      },
    },

    // Email verification configuration
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const result = await sendVerificationEmail(env, {
          to: user.email,
          verificationUrl: url,
        });

        if (!result.success) {
          console.error("Failed to send verification email:", result.error);
        }
      },
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

    // Origins that are allowed to receive auth responses
    trustedOrigins: [
      "https://appleid.apple.com",
      "http://localhost:8787",
      "http://localhost:5173",
      "https://docketadmin.com",
      "https://www.docketadmin.com",
      "https://api.docketadmin.com",
    ],

    // Cookie and security configuration
    advanced:
      env.ENVIRONMENT === "development"
        ? {
            // In development, don't require HTTPS for cookies
            useSecureCookies: false,
          }
        : {
            // In production, enable cross-subdomain cookies
            // This allows the cookie to work on both docketadmin.com and api.docketadmin.com
            crossSubDomainCookies: {
              enabled: true,
              domain: "docketadmin.com",
            },
            useSecureCookies: true,
          },

    // Middleware hooks for request processing
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Normalize email addresses to lowercase on sign-up and sign-in
        // This prevents issues with case-sensitive email matching
        const isEmailAuthPath =
          ctx.path === "/sign-up/email" || ctx.path === "/sign-in/email";

        const hasEmail = ctx.body?.email && typeof ctx.body.email === "string";

        if (isEmailAuthPath && hasEmail) {
          ctx.body.email = ctx.body.email.toLowerCase();
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // Log failed authentication attempts for security auditing
        const returned = ctx.context.returned;
        if (!returned) return;

        const isAuthPath =
          ctx.path === "/sign-in/email" ||
          ctx.path === "/sign-in/social" ||
          ctx.path.startsWith("/callback/");

        if (!isAuthPath) return;

        // Check if response indicates failure (APIError or non-2xx status)
        const isError =
          returned instanceof Error ||
          (returned instanceof Response && !returned.ok);

        if (isError) {
          const log = createLogger({
            requestId: generateRequestId(),
            handler: "auth",
          });

          const email =
            typeof ctx.body?.email === "string" ? ctx.body.email : undefined;

          log.warn("Authentication failed", {
            path: ctx.path,
            email,
            statusCode:
              returned instanceof Response ? returned.status : undefined,
            error: returned instanceof Error ? returned.message : undefined,
          });
        }
      }),
    },
  });
}
