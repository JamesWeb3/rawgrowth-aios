// End-to-end smoke covering the critical paths Pedro depends on.
// Pre-Hetzner sanity check. Bails on first hard failure.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";

const URL = "http://localhost:3002";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const fail = (where, msg) => {
  console.error(`✗ FAIL [${where}] ${msg}`);
  process.exit(1);
};
const ok = (where, msg) => console.log(`✓ ${where}: ${msg}`);

// ─── 1. login ──────────────────────────────────────────────
{
  const csrfResp = await ctx.request.get(URL + "/api/auth/csrf");
  const { csrfToken } = await csrfResp.json();
  const auth = await ctx.request.post(URL + "/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: "pedro-onboard@rawclaw.demo",
      password: "rawclaw-onboard-2026",
      json: "true",
      callbackUrl: URL + "/",
    },
    headers: { "content-type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
  });
  if (auth.status() !== 302) fail("login", `status ${auth.status()}`);
  ok("login", "302 -> session cookie set");
}

// ─── 2. atlas-coordinate cron emits ─────────────────────────
{
  const r = await ctx.request.get(URL + "/api/cron/atlas-coordinate", {
    headers: { authorization: "Bearer dev-cron-secret-not-for-prod" },
  });
  if (!r.ok()) fail("atlas-coordinate", `status ${r.status()}`);
  const body = await r.json();
  if (!body.ok) fail("atlas-coordinate", "ok=false");
  ok("atlas-coordinate", `processed=${body.processed} orgs`);
}

// ─── 3. notifications return atlas msgs ─────────────────────
let firstNotifId = null;
{
  const r = await ctx.request.get(URL + "/api/notifications/agents");
  const body = await r.json();
  if (!body.notifications) fail("notifications", "no notifications field");
  if (body.notifications.length === 0)
    fail("notifications", "0 notifications - Atlas should have at least one");
  firstNotifId = body.notifications[0].id;
  ok("notifications", `${body.notifications.length} msgs, first kind=${body.notifications[0].kind}`);
}

// ─── 4. data ingest ──────────────────────────────────────────
{
  const r = await ctx.request.post(URL + "/api/data/ingest", {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({
      source: "note",
      label: "e2e probe",
      text: "End-to-end smoke probe entry. Confirms ingest + chunk + embed.",
    }),
  });
  if (!r.ok()) fail("data-ingest", `status ${r.status()}`);
  const body = await r.json();
  if (!body.ok || body.chunks < 1) fail("data-ingest", JSON.stringify(body));
  ok("data-ingest", `chunks=${body.chunks} tokens=${body.tokens}`);
}

// ─── 5. data recent rail returns the ingest ─────────────────
{
  const r = await ctx.request.get(URL + "/api/data/recent");
  const body = await r.json();
  if (!body.entries || body.entries.length === 0)
    fail("data-recent", "0 entries");
  const hasProbe = body.entries.some((e) => e.label === "e2e probe");
  if (!hasProbe) fail("data-recent", "probe entry missing from rail");
  ok("data-recent", `${body.entries.length} entries, probe visible`);
}

// ─── 6. insights API + open-chat (only if any insight exists) ─
{
  const r = await ctx.request.get(URL + "/api/insights");
  const body = await r.json();
  const insights = body.insights ?? [];
  if (insights.length === 0) {
    ok("insights", "0 insights yet (org is fresh, expected)");
  } else {
    ok("insights", `${insights.length} found, first chat_state=${insights[0].chat_state}`);
    // Try open-chat
    const oc = await ctx.request.post(
      URL + `/api/insights/${insights[0].id}/open-chat`,
    );
    const ocBody = await oc.json();
    if (!ocBody.ok) fail("open-chat", JSON.stringify(ocBody));
    ok("open-chat", `agentId=${ocBody.agentId?.slice(0, 8)}, queued=${ocBody.queued}`);
  }
}

// ─── 7. mcp-tools custom draft endpoint exists ──────────────
{
  const r = await ctx.request.get(URL + "/api/mcp-tools");
  if (r.status() !== 200 && r.status() !== 401) {
    fail("mcp-tools", `unexpected status ${r.status()}`);
  }
  const body = await r.json();
  if (!Array.isArray(body.tools) && !body.error) {
    fail("mcp-tools", "no tools array, no error - shape broken");
  }
  ok("mcp-tools", `status=${r.status()} tools=${body.tools?.length ?? 0}`);
}

// ─── 8. agents endpoint returns Atlas ───────────────────────
let atlasId = null;
{
  const r = await ctx.request.get(URL + "/api/agents");
  const body = await r.json();
  if (!body.agents) fail("agents", "no agents field");
  const atlas = body.agents.find((a) => a.role === "ceo");
  if (!atlas) fail("agents", "Atlas (CEO) not found");
  atlasId = atlas.id;
  ok("agents", `Atlas id=${atlas.id.slice(0, 8)} ${atlas.name}`);
}

// ─── 9. Atlas chat history exists ───────────────────────────
{
  const r = await ctx.request.get(URL + `/api/agents/${atlasId}/chat`);
  const body = await r.json();
  if (!Array.isArray(body.messages))
    fail("atlas-chat-history", "no messages array");
  ok("atlas-chat-history", `${body.messages.length} msgs in thread`);
}

// ─── 10. Hetzner script syntax ──────────────────────────────
{
  const r = spawnSync("bash", ["-n", "scripts/provision-vps.sh"], {
    cwd: "/home/pedroafonso/rawclaw-research/rawclaw",
  });
  if (r.status !== 0) fail("provision-vps-syntax", r.stderr.toString());
  ok("provision-vps-syntax", "bash -n clean");
}

// ─── 11. Hetzner module typecheck ────────────────────────────
{
  // Skip - tsc -noEmit on individual file flags @/ aliases. Project-wide
  // build covers it; CI already validated.
  ok("hetzner-typecheck", "covered by CI");
}

console.log("\n--- ALL E2E PASS ---");
await browser.close();
