/**
 * Environment variables required for encryption operations.
 *
 * ENCRYPTION_KEY is the current key used for encryption.
 * ENCRYPTION_KEY_OLD is optional and used for key rotation -
 * when set, decryption will try the new key first, then fall back to the old key.
 */
export interface EncryptionEnv {
  ENCRYPTION_KEY: string;
  ENCRYPTION_KEY_OLD?: string;
}

/**
 * Number of PBKDF2 iterations for deriving encryption keys.
 * 100,000 is the OWASP recommended minimum.
 */
const PBKDF2_ITERATIONS = 100000;

/**
 * Length of the initialization vector (IV) for AES-GCM.
 * 12 bytes (96 bits) is the recommended size for AES-GCM.
 */
const IV_LENGTH = 12;

/**
 * Derives an AES-256-GCM key from a secret and user-specific salt.
 *
 * Using the userId as salt ensures that even if two users have the same
 * data encrypted with the same key, the ciphertext will be different.
 * This prevents cross-user correlation attacks.
 *
 * @param secret - The encryption secret from environment
 * @param salt - A unique salt (typically the userId)
 * @returns A CryptoKey suitable for AES-GCM encryption/decryption
 */
async function deriveKey(secret: string, salt: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  // Import the secret as raw key material for PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false, // Not extractable
    ["deriveKey"]
  );

  // Derive an AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // Not extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts plaintext using AES-256-GCM.
 *
 * The output format is: [12-byte IV][ciphertext + auth tag]
 *
 * AES-GCM provides both confidentiality (encryption) and authenticity
 * (tamper detection). The 16-byte authentication tag is automatically
 * appended to the ciphertext by the Web Crypto API.
 *
 * @param plaintext - The data to encrypt
 * @param userId - Used as salt for key derivation (unique per user)
 * @param encryptionKey - The encryption secret from environment
 * @returns An ArrayBuffer containing IV + ciphertext
 */
export async function encrypt(
  plaintext: string,
  userId: string,
  encryptionKey: string
): Promise<ArrayBuffer> {
  // Generate a random IV for this encryption operation
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Derive a user-specific key
  const key = await deriveKey(encryptionKey, userId);

  // Encrypt the plaintext
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  // Combine IV + ciphertext into a single buffer
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);

  return result.buffer;
}

/**
 * Decrypts ciphertext using a specific key.
 *
 * @param encrypted - The encrypted data (IV + ciphertext)
 * @param userId - Used as salt for key derivation
 * @param key - The encryption key to use
 * @returns The decrypted plaintext
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
async function decryptWithKey(
  encrypted: ArrayBuffer,
  userId: string,
  key: string
): Promise<string> {
  const data = new Uint8Array(encrypted);

  // Extract the IV (first 12 bytes)
  const iv = data.slice(0, IV_LENGTH);

  // Extract the ciphertext (remaining bytes)
  const ciphertext = data.slice(IV_LENGTH);

  // Derive the key
  const derivedKey = await deriveKey(key, userId);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    derivedKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Decrypts ciphertext, trying the current key first, then falling back to the old key.
 *
 * This supports key rotation: when you rotate keys, set ENCRYPTION_KEY_OLD to
 * the previous key. Data encrypted with the old key will still be decryptable.
 *
 * @param encrypted - The encrypted data (IV + ciphertext)
 * @param userId - Used as salt for key derivation
 * @param env - Environment containing current and optional old encryption keys
 * @returns The decrypted plaintext
 * @throws Error if decryption fails with both keys
 */
export async function decrypt(
  encrypted: ArrayBuffer,
  userId: string,
  env: EncryptionEnv
): Promise<string> {
  // Try the current key first
  try {
    return await decryptWithKey(encrypted, userId, env.ENCRYPTION_KEY);
  } catch {
    // If current key fails and we have an old key, try that
    if (env.ENCRYPTION_KEY_OLD) {
      return decryptWithKey(encrypted, userId, env.ENCRYPTION_KEY_OLD);
    }

    throw new Error("Decryption failed");
  }
}

/**
 * Decrypts ciphertext and re-encrypts with the current key if it was encrypted with the old key.
 *
 * This is useful for gradually migrating data to the new key during normal operations.
 * After decryption, if the old key was used, the data is re-encrypted with the new key
 * so the caller can store the updated ciphertext.
 *
 * @param encrypted - The encrypted data (IV + ciphertext)
 * @param userId - Used as salt for key derivation
 * @param env - Environment containing current and optional old encryption keys
 * @returns An object containing the decrypted value and optionally the re-encrypted data
 */
export async function decryptAndRotate(
  encrypted: ArrayBuffer,
  userId: string,
  env: EncryptionEnv
): Promise<{ value: string; rotated: ArrayBuffer | null }> {
  // Try the current key first
  try {
    const value = await decryptWithKey(encrypted, userId, env.ENCRYPTION_KEY);
    return { value, rotated: null }; // Already encrypted with current key
  } catch {
    // Current key failed - try old key
    if (!env.ENCRYPTION_KEY_OLD) {
      throw new Error("Decryption failed");
    }

    // Decrypt with old key
    const value = await decryptWithKey(
      encrypted,
      userId,
      env.ENCRYPTION_KEY_OLD
    );

    // Re-encrypt with current key
    const rotated = await encrypt(value, userId, env.ENCRYPTION_KEY);

    return { value, rotated };
  }
}

/**
 * Converts an ArrayBuffer to a URL-safe base64 string.
 *
 * URL-safe base64 uses '-' instead of '+' and '_' instead of '/'
 * to avoid issues with URLs. Padding is also removed.
 *
 * @param buffer - The binary data to encode
 * @returns A URL-safe base64 encoded string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // Convert bytes to a binary string
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  // Convert to base64 and make URL-safe
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, ""); // Remove padding
}

/**
 * Converts a URL-safe base64 string back to an ArrayBuffer.
 *
 * @param base64 - A URL-safe base64 encoded string
 * @returns The decoded binary data
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Convert URL-safe base64 back to standard base64
  let standardBase64 = base64.replace(/-/g, "+").replace(/_/g, "/");

  // Add padding if needed
  const paddingNeeded = (4 - (standardBase64.length % 4)) % 4;
  standardBase64 += "=".repeat(paddingNeeded);

  // Decode to binary string
  const binary = atob(standardBase64);

  // Convert to ArrayBuffer
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

/**
 * Compares two strings in constant time to prevent timing attacks.
 *
 * In a timing attack, an attacker measures how long a comparison takes
 * to determine how much of the input matches. Constant-time comparison
 * always takes the same amount of time regardless of the input.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if the strings are equal, false otherwise
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  // If lengths differ, compare a with a same-length buffer to avoid timing leak
  if (aBuf.length !== bBuf.length) {
    // Still perform a comparison to maintain constant time behavior
    crypto.subtle.timingSafeEqual(aBuf, new Uint8Array(aBuf.length));
    return false;
  }

  return crypto.subtle.timingSafeEqual(aBuf, bBuf);
}
