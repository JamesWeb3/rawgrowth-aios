import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const orgId = randomUUID();
const userId = randomUUID();
const email = "pedro-onboard@rawclaw.demo";
const password = "rawclaw-onboard-2026";
const slug = "pedro-onboard-" + Date.now().toString(36).slice(-5);

await c.query(
  `insert into rgaios_organizations (id, name, slug, marketing, sales, fulfilment, finance, onboarding_completed, onboarding_step, mcp_token, created_at)
   values ($1, 'Pedro Onboard Test', $2, true, true, true, true, false, 0, $3, now())`,
  [orgId, slug, "rgmcp_" + randomUUID().replace(/-/g, "").slice(0, 24)],
);

const hash = await bcrypt.hash(password, 10);
await c.query(
  `insert into rgaios_users (id, email, name, password_hash, role, organization_id, created_at)
   values ($1, $2, 'Pedro Onboard', $3, 'owner', $4, now())`,
  [userId, email, hash, orgId],
);

await c.query(
  `insert into rgaios_organization_memberships (organization_id, user_id, role, allowed_departments, created_at)
   values ($1, $2, 'owner', '{}', now())`,
  [orgId, userId],
);

console.log("URL:      https://rawclaw-rose.vercel.app/auth/signin");
console.log("Email:    " + email);
console.log("Password: " + password);
console.log("Org id:   " + orgId);
console.log("Slug:     " + slug);
console.log("Onboarding NOT completed - will auto-redirect to /onboarding");

await c.end();
