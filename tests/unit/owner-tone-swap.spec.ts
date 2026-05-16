import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Chris feedback 2026-05-17 FLEX MODE: agents must stop sounding like
// they are talking ABOUT the operator ("the client", "Marti's instance")
// and start talking TO them ("you / your") when the operator IS the
// owner/admin of the active org. The brand-profile injection in
// preamble.ts is the loudest leak - it always says "THIS IS THE CLIENT
// YOU WORK FOR", even when the CEO/owner themselves is the one driving
// the chat.
//
// These specs pin:
//   1. getActiveOrgRole helper exists with the documented contract.
//   2. buildAgentChatPreamble accepts userRole + threads isOwnerContext.
//   3. brand-profile string flips owner -> "Your brand profile" while
//      non-owner stays on the original "THIS IS THE CLIENT YOU WORK FOR"
//      so legacy surfaces (Telegram webhook, scheduled routines) are
//      unaffected.
//   4. chat route imports getActiveOrgRole + passes userRole through.

const ADMIN_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/auth/admin.ts"),
  "utf8",
);
const PREAMBLE_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/agent/preamble.ts"),
  "utf8",
);
const CHAT_ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../src/app/api/agents/[id]/chat/route.ts"),
  "utf8",
);

test("getActiveOrgRole is exported with owner/admin/developer/member return type", () => {
  assert.match(
    ADMIN_SRC,
    /export async function getActiveOrgRole\([\s\S]*?\):\s*Promise<\s*"owner"\s*\|\s*"admin"\s*\|\s*"developer"\s*\|\s*"member"\s*\|\s*null\s*>/,
    "getActiveOrgRole must export the documented union return type",
  );
});

test("getActiveOrgRole short-circuits to 'admin' for ADMIN_ORG_ID users", () => {
  // The platform-admin home org is the Rawgrowth operator account
  // viewing client VPSes via impersonation. They should always get
  // owner-mode tone, even though they have no membership row in the
  // viewed org.
  assert.match(
    ADMIN_SRC,
    /if \(ctx\.isAdmin\) return "admin";/,
    "ADMIN_ORG_ID users must bypass the membership lookup with 'admin'",
  );
});

test("getActiveOrgRole reads rgaios_organization_memberships.role", () => {
  // The role column is the source of truth set by the seed flow + the
  // members admin UI. Dropping this lookup would silently re-enable
  // client-facing tone for every owner.
  assert.match(
    ADMIN_SRC,
    /\.from\(\s*"rgaios_organization_memberships"\s*\)[\s\S]*?\.select\(\s*"role"\s*\)/,
    "getActiveOrgRole must read role from rgaios_organization_memberships",
  );
});

test("buildAgentChatPreamble accepts optional userRole + computes isOwnerContext", () => {
  // userRole is OPTIONAL so the Telegram webhook + routine executor
  // (neither has a signed-in user) keep the original tone.
  assert.match(
    PREAMBLE_SRC,
    /userRole\?:\s*"owner"\s*\|\s*"admin"\s*\|\s*"developer"\s*\|\s*"member"\s*\|\s*null/,
    "buildAgentChatPreamble input must accept optional userRole",
  );
  assert.match(
    PREAMBLE_SRC,
    /const isOwnerContext\s*=\s*input\.userRole === "owner"\s*\|\|\s*input\.userRole === "admin";/,
    "owner-mode flag must include both owner and admin",
  );
});

test("brand-profile block flips frame on owner vs non-owner", () => {
  // Owner sees second-person "Your brand profile"; everyone else keeps
  // the original "THIS IS THE CLIENT YOU WORK FOR" framing so legacy
  // surfaces are unaffected.
  assert.match(
    PREAMBLE_SRC,
    /const brandFrame = isOwnerContext[\s\S]*?Your brand profile[\s\S]*?:[\s\S]*?THIS IS THE CLIENT YOU WORK FOR/,
    "brand block must branch on isOwnerContext and keep client-mode fallback",
  );
});

test("chat route imports getActiveOrgRole + threads userRole into preamble", () => {
  assert.match(
    CHAT_ROUTE_SRC,
    /import \{[^}]*\bgetActiveOrgRole\b[^}]*\} from "@\/lib\/auth\/admin"/,
    "chat route must import getActiveOrgRole alongside getOrgContext",
  );
  assert.match(
    CHAT_ROUTE_SRC,
    /const userRole = await getActiveOrgRole\(ctx\);/,
    "chat route must resolve the caller's role before building preamble",
  );
  assert.match(
    CHAT_ROUTE_SRC,
    /buildAgentChatPreamble\(\{[\s\S]*?userRole,[\s\S]*?\}\)/,
    "buildAgentChatPreamble call must pass userRole through",
  );
});

test("two non-brand color leaks fixed - members + slack badge use brand primary", () => {
  // Chris feedback "needs to be RG green": these two badges were the
  // last non-brand hex/tailwind leaks in surfaces an operator sees
  // routinely (members table + connections card).
  const members = readFileSync(
    resolve(__dirname, "../../src/components/company/members-view.tsx"),
    "utf8",
  );
  const slack = readFileSync(
    resolve(__dirname, "../../src/components/connections/slack-card.tsx"),
    "utf8",
  );
  assert.ok(
    !/cyan-(300|400|500)/.test(members),
    "members-view.tsx must not use cyan-* (RG green replacement applied)",
  );
  assert.ok(
    !/cyan-(300|400|500)/.test(slack),
    "slack-card.tsx must not use cyan-* (RG green replacement applied)",
  );
});
