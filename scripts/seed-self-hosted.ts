/* eslint-disable no-console */
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";

/**
 * One-shot seed for a fresh self-hosted instance. Safe to run on every
 * container boot — finds or creates the single org, mints the MCP token
 * if missing, and issues a first-time invite for the admin email so the
 * client can set their own password instead of us handing out a
 * generated one.
 *
 * Flow:
 *   1. Find-or-create the org (respects single-org DB invariant)
 *   2. Mint MCP token once (never rotated on re-run)
 *   3. If no user with SEED_ADMIN_EMAIL exists and no pending invite is
 *      active, create a 7-day invite and print the /auth/invite URL
 *   4. Legacy override: if SEED_ADMIN_PASSWORD is set, create the user
 *      directly with that password (skips the invite)
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[seed] DATABASE_URL is required");
    process.exit(1);
  }

  const orgName = process.env.SEED_ORG_NAME ?? "Local Dev";
  const orgSlug = process.env.SEED_ORG_SLUG ?? "local-dev";
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@local").toLowerCase();
  const adminName = process.env.SEED_ADMIN_NAME ?? "Admin";
  const baseUrl = (process.env.NEXTAUTH_URL ?? "http://localhost").replace(/\/$/, "");

  // Legacy override: if operator set SEED_ADMIN_PASSWORD, skip the invite
  // flow and create the user directly. Useful for local dev / CI.
  const legacyPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
  const useLegacy = legacyPassword.length > 0;
  if (useLegacy && legacyPassword.length < 8) {
    console.error("[seed] SEED_ADMIN_PASSWORD must be ≥ 8 chars");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  // ─── Step 1: find or create the org ──────────────────────────────
  const { rows: existing } = await client.query<{
    id: string;
    name: string;
    slug: string;
    mcp_token: string | null;
  }>(
    `select id, name, slug, mcp_token from rgaios_organizations
     order by created_at asc limit 1`,
  );

  let orgId: string;
  let orgDisplay: { name: string; slug: string };

  if (existing[0]) {
    orgId = existing[0].id;
    orgDisplay = { name: existing[0].name, slug: existing[0].slug };
  } else {
    const { rows: created } = await client.query<{
      id: string;
      name: string;
      slug: string;
    }>(
      `insert into rgaios_organizations (name, slug)
       values ($1, $2)
       returning id, name, slug`,
      [orgName, orgSlug],
    );
    orgId = created[0]!.id;
    orgDisplay = { name: created[0]!.name, slug: created[0]!.slug };
  }

  // ─── Step 2: ensure the org has an MCP token ─────────────────────
  let mcpToken = existing[0]?.mcp_token ?? null;
  if (!mcpToken) {
    mcpToken = `rgmcp_${randomBytes(24).toString("hex")}`;
    await client.query(
      `update rgaios_organizations set mcp_token = $1 where id = $2`,
      [mcpToken, orgId],
    );
  }

  // ─── Step 3: determine admin user state + create invite if needed ─
  const { rows: userRows } = await client.query<{ id: string }>(
    `select id from rgaios_users where email = $1`,
    [adminEmail],
  );
  const userExists = userRows.length > 0;

  let inviteUrl: string | null = null;
  let status: "user_exists" | "new_user" | "new_invite" | "invite_pending";

  if (userExists) {
    // Make sure their org link is correct (paranoia on re-run)
    await client.query(
      `update rgaios_users set organization_id = $1, role = 'owner' where email = $2`,
      [orgId, adminEmail],
    );
    status = "user_exists";
  } else if (useLegacy) {
    // Legacy: create user directly with the provided password
    const passwordHash = await bcrypt.hash(legacyPassword, 10);
    await client.query(
      `insert into rgaios_users (email, name, password_hash, organization_id, role, email_verified)
       values ($1, $2, $3, $4, 'owner', now())`,
      [adminEmail, adminName, passwordHash, orgId],
    );
    status = "new_user";
  } else {
    // Invite flow: check for an active unexpired invite first
    const { rows: invites } = await client.query<{ expires_at: string }>(
      `select expires_at from rgaios_invites
       where organization_id = $1 and email = $2 and accepted_at is null`,
      [orgId, adminEmail],
    );
    const hasActive = invites.some(
      (i) => new Date(i.expires_at) > new Date(),
    );
    if (hasActive) {
      status = "invite_pending";
    } else {
      // Generate a fresh invite token
      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      await client.query(
        `insert into rgaios_invites
          (token_hash, email, name, role, organization_id, invited_by, expires_at)
         values ($1, $2, $3, 'owner', $4, null, $5)`,
        [tokenHash, adminEmail, adminName, orgId, expiresAt],
      );
      inviteUrl = `${baseUrl}/auth/invite?token=${encodeURIComponent(token)}`;
      status = "new_invite";
    }
  }

  // ─── Step 4: banner ──────────────────────────────────────────────
  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log("[seed] Bootstrap complete");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`  Organization:  ${orgDisplay.name} (${orgDisplay.slug})`);
  console.log(`  Admin email:   ${adminEmail}`);
  console.log(`  Admin role:    owner`);
  console.log("");

  switch (status) {
    case "new_invite":
      console.log(`  🎟  Invite link (send this to the client — expires in 7 days):`);
      console.log(`    ${inviteUrl}`);
      console.log("");
      console.log(
        `  They click it, set their own password, and they're signed in.`,
      );
      break;
    case "invite_pending":
      console.log(`  🎟  An invite is already pending for this email.`);
      console.log(
        `      If the client lost the link, re-seed with a fresh invite by clearing the old row:`,
      );
      console.log(
        `      docker compose exec postgres psql -U postgres -d rawgrowth -c \\`,
      );
      console.log(
        `        "delete from rgaios_invites where email = '${adminEmail}' and accepted_at is null;"`,
      );
      console.log(`      then restart the app container.`);
      break;
    case "new_user":
      console.log(`  🔑  Admin user created with password from SEED_ADMIN_PASSWORD env.`);
      console.log(`      Sign in at ${baseUrl}/auth/signin`);
      break;
    case "user_exists":
      console.log(`  ✓ Admin user already exists. Sign in at ${baseUrl}/auth/signin`);
      break;
  }

  console.log("");
  console.log(`  MCP token (paste into Claude Code config):`);
  console.log(`    ${mcpToken}`);
  console.log("");
  console.log(`  Sign-in URL:   ${baseUrl}/auth/signin`);
  console.log(`  Claude Code:   See CLAUDE_CODE_SETUP.md`);
  console.log("──────────────────────────────────────────────────────────");
  console.log("");

  await client.end();
}

main().catch((err) => {
  console.error("[seed] fatal:", err);
  process.exit(1);
});
