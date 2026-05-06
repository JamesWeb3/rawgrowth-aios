// Probe the test org's claude-max token directly against Anthropic to
// see the REAL status (429 vs 401 vs other) - the route's friendly
// error mapping might be misclassifying.
import "dotenv/config";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";

// Local .env DATABASE_URL points to the cloud DB; cloud JWT_SECRET is
// what we need to decrypt rows that were encrypted there.
const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  // Pull cloud JWT_SECRET via vercel env if needed; for now read from
  // .env.cloud since the file exists already.
  JWT_SECRET: process.env.JWT_SECRET,
};

const TEST_ORG = "7154f299-af35-4b14-9e42-ff9f41319694";

function decrypt(value, jwt) {
  const PREFIX = "enc:v1:";
  if (!value.startsWith(PREFIX)) return value;
  const blob = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const key = createHash("sha256").update(`rawgrowth:secret-at-rest:v1:${jwt}`).digest();
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ciphertext), d.final()]).toString("utf8");
}

const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();
const r = await c.query(
  "select metadata from rgaios_connections where organization_id=$1 and provider_config_key='claude-max'",
  [TEST_ORG],
);
console.log("rows:", r.rowCount);
if (r.rowCount === 0) {
  console.log("NO claude-max conn for test org");
  await c.end();
  process.exit(1);
}
const meta = r.rows[0].metadata;
console.log("metadata keys:", Object.keys(meta));
console.log("source:", meta.source);
console.log("installed_at:", meta.installed_at);

let token;
try {
  token = decrypt(meta.access_token, env.JWT_SECRET);
  console.log("decrypted ok, len:", token.length, "starts:", token.slice(0, 25));
} catch (e) {
  console.log("DECRYPT FAILED:", e.message);
  await c.end();
  process.exit(1);
}

console.log("\n--- calling Anthropic ---");
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "oauth-2025-04-20",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 32,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    messages: [{ role: "user", content: "say hi" }],
  }),
});
console.log("status:", res.status);
console.log("retry-after:", res.headers.get("retry-after"));
console.log("ratelimit-reset:", res.headers.get("anthropic-ratelimit-requests-reset"));
const body = await res.text();
console.log("body:", body.slice(0, 500));
await c.end();
