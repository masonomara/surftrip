import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./encryption";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../services/email";

// Number of PBKDF2 iterations for password hashing.
// 100,000 is the OWASP recommended minimum as of 2023.
const PBKDF2_ITERATIONS = 100_000;

/**
 * Derives a 256-bit key from a password and salt using PBKDF2-SHA256.
 * This is the core of our password hashing - it's intentionally slow
 * to make brute-force attacks impractical.
 */
async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<ArrayBuffer> {
  // Import the password as a key for PBKDF2
  const passwordBytes = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive a 256-bit key using PBKDF2
  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256 // 256 bits = 32 bytes
  );

  return derivedKey;
}

/**
 * Hashes a password for storage.
 * Returns a string in the format "salt:hash" where both are base64-encoded.
 */
async function hashPassword(password: string): Promise<string> {
  // Generate a random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive the hash from password + salt
  const hash = await deriveKeyFromPassword(password, salt);

  // Combine salt and hash into a storable string
  const saltBase64 = arrayBufferToBase64(salt.buffer);
  const hashBase64 = arrayBufferToBase64(hash);

  return `${saltBase64}:${hashBase64}`;
}

/**
 * Verifies a password against a stored hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
async function verifyPassword({
  password,
  hash,
}: {
  password: string;
  hash: string;
}): Promise<boolean> {
  // Parse the stored hash into salt and hash components
  const [saltBase64, storedHashBase64] = hash.split(":");

  if (!saltBase64 || !storedHashBase64) {
    return false;
  }

  // Decode the stored values
  const salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
  const storedHash = new Uint8Array(base64ToArrayBuffer(storedHashBase64));

  // Derive the hash from the provided password
  const computedHash = new Uint8Array(
    await deriveKeyFromPassword(password, salt)
  );

  // Verify lengths match (they always should, but check anyway)
  if (storedHash.length !== computedHash.length) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks.
  // We XOR all bytes and accumulate differences - if any byte differs,
  // the result will be non-zero.
  let difference = 0;
  for (let i = 0; i < storedHash.length; i++) {
    difference |= storedHash[i] ^ computedHash[i];
  }

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
}

/**
 * Creates and configures the better-auth instance.
 * This handles all authentication: email/password, OAuth, email verification, etc.
 */
export function getAuth(env: AuthEnv) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    // Database configuration
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),

    // Secret key for signing tokens
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,

    // Email/password authentication
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

    // Email verification
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

    // OAuth providers
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

    // Trusted origins for OAuth callbacks and CSRF protection
    trustedOrigins: [
      "https://appleid.apple.com",
      "http://localhost:8787",
      "http://localhost:5173",
      "https://docketadmin.com",
      "https://www.docketadmin.com",
      "https://api.docketadmin.com",
    ],

    // Advanced cookie settings
    advanced: {
      crossSubDomainCookies: {
        enabled: true,
        domain: "docketadmin.com",
      },
      useSecureCookies: true,
    },
  });
}
