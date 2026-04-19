import { randomBytes, createHash } from "crypto";

const TOKEN_TTL_MS = 60 * 60 * 1000;

export function createResetToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  return { token, tokenHash, expiresAt };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
