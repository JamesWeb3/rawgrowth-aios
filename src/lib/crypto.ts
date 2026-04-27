import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * App-level secret-at-rest helpers.
 *
 * Used for things like the client's `sk-ant-oat01-` Claude Max token in
 * `rgaios_connections.metadata.access_token`  -  the dashboard never wants
 * to see plaintext sitting in Postgres logs / pgdump output / etc.
 *
 * Algorithm: AES-256-GCM. Encryption key is derived from the per-tenant
 * `JWT_SECRET` (already required by the rest of the stack), so adding
 * encryption requires no new env var or KMS dependency.
 *
 * Wire format (base64-url-safe of `iv || authTag || ciphertext`):
 *   bytes 0..11   → 12-byte IV
 *   bytes 12..27  → 16-byte auth tag
 *   bytes 28..    → ciphertext
 *
 * The `enc:v1:` prefix lets us migrate algorithms later without breaking
 * existing values.
 */

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "[crypto] JWT_SECRET is not set  -  cannot derive encryption key",
    );
  }
  // Domain-separated SHA-256 → 32-byte key for AES-256.
  return createHash("sha256")
    .update(`rawgrowth:secret-at-rest:v1:${secret}`)
    .digest();
}

/** Encrypt a UTF-8 string. Returns a `enc:v1:…` base64-url-safe string. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, tag, ciphertext]).toString("base64url");
  return `${PREFIX}${blob}`;
}

/**
 * Decrypt a value produced by `encryptSecret`. Returns the original
 * plaintext, or throws if the input is malformed / tampered with /
 * encrypted under a different key.
 */
export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) {
    // Treat unprefixed values as plaintext (legacy / migration grace).
    return value;
  }
  const blob = Buffer.from(value.slice(PREFIX.length), "base64url");
  if (blob.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("[crypto] ciphertext too short");
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

/** Best-effort decrypt  -  returns `null` on any failure instead of throwing. */
export function tryDecryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}
