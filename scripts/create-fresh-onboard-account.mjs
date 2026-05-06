// Create a brand new test account on the cloud DB for onboarding
// walkthroughs. The default account (pedro-onboard@rawclaw.demo) has
// state from prior runs - this one starts clean every time.
import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const orgId = randomUUID();
const userId = randomUUID();
const ts = Date.now().toString(36).slice(-6);
const email = `pedro-fresh-${ts}@rawclaw.demo`;
const password = `rawclaw-fresh-${ts}`;
const slug = `pedro-fresh-${ts}`;

await c.query(
  `insert into rgaios_organizations
     (id, name, slug, marketing, sales, fulfilment, finance,
      onboarding_completed, onboarding_step, mcp_token, created_at)
   values ($1, $2, $3, true, true, true, true, false, 0, $4, now())`,
  [orgId, `Pedro Fresh ${ts}`, slug, "rgmcp_" + randomUUID().replace(/-/g, "").slice(0, 24)],
);

const hash = await bcrypt.hash(password, 10);
await c.query(
  `insert into rgaios_users
     (id, email, name, password_hash, role, organization_id, created_at)
   values ($1, $2, 'Pedro Fresh', $3, 'owner', $4, now())`,
  [userId, email, hash, orgId],
);

await c.query(
  `insert into rgaios_organization_memberships
     (organization_id, user_id, role, allowed_departments, created_at)
   values ($1, $2, 'owner', '{}', now())`,
  [orgId, userId],
);

console.log("=".repeat(60));
console.log("Fresh onboarding account ready:");
console.log("=".repeat(60));
console.log(`Email:    ${email}`);
console.log(`Password: ${password}`);
console.log(`Org id:   ${orgId}`);
console.log(`Slug:     ${slug}`);
console.log("");
console.log("Local:    http://localhost:3002/auth/signin");
console.log("Prod:     https://rawclaw-rose.vercel.app/auth/signin");
console.log("");
console.log("Onboarding NOT completed - will auto-redirect to /onboarding");
console.log("No Claude Max conn yet - hard gate will force connect.");

await c.end();
