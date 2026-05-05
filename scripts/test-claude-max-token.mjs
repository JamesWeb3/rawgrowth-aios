// Pull the stored claude-max token for the test org, decrypt with the
// same JWT_SECRET we set on Vercel, and call Anthropic /v1/messages
// directly. If the call succeeds, the token + crypto are fine and the
// problem is downstream. If it fails, surface the exact error.
import "dotenv/config";
import pg from "pg";
import { createDecipheriv, createHash } from "node:crypto";

// Pull JWT_SECRET from Vercel via env pull (one-shot).
import { spawnSync } from "node:child_process";
spawnSync("npx", ["vercel", "env", "pull", ".env.vercel.tmp", "--yes", "--environment", "production"], { stdio: "inherit" });

const envText = await import("node:fs").then((fs) =>
  fs.readFileSync(".env.vercel.tmp", "utf8"),
);
const jwt = (envText.match(/^JWT_SECRET="?([^"\n]+)"?/m) || [])[1];
const dbUrl = (envText.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1];
console.log("JWT_SECRET length:", jwt?.length);
console.log("DATABASE_URL host:", dbUrl?.match(/@([^/]+)/)?.[1]);

function decrypt(value) {
  const PREFIX = "enc:v1:";
  if (!value.startsWith(PREFIX)) return value;
  const blob = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const key = createHash("sha256")
    .update(`rawgrowth:secret-at-rest:v1:${jwt}`)
    .digest();
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ciphertext), d.final()]).toString("utf8");
}

const c = new pg.Client({ connectionString: dbUrl });
await c.connect();
const orgId = "7154f299-af35-4b14-9e42-ff9f41319694";
const r = await c.query(
  "select metadata, created_at, updated_at from rgaios_connections where organization_id = $1 and provider_config_key = 'claude-max'",
  [orgId],
);
console.log("rows:", r.rowCount);
if (!r.rowCount) {
  console.log("NO claude-max row for org", orgId);
  process.exit(1);
}
const meta = r.rows[0].metadata;
console.log("metadata keys:", Object.keys(meta));
console.log("access_token starts:", meta.access_token?.slice(0, 20));
console.log("refresh_token starts:", meta.refresh_token?.slice(0, 20));

let token;
try {
  token = decrypt(meta.access_token);
  console.log("decrypted token starts:", token.slice(0, 20), "len:", token.length);
} catch (e) {
  console.log("DECRYPT FAILED:", e.message);
  process.exit(1);
}

console.log("\n--- calling Anthropic /v1/messages ---");
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "oauth-2025-04-20",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-5",
    max_tokens: 64,
    system:
      "You are Claude Code, Anthropic's official CLI for Claude.\n\nReply with just OK.",
    messages: [{ role: "user", content: "say OK" }],
  }),
});
console.log("status:", res.status);
const text = await res.text();
console.log("body:", text.slice(0, 1000));

await c.end();
import("node:fs").then((fs) => fs.unlinkSync(".env.vercel.tmp").catch?.(() => {}));
