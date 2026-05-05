// E2E covering critical paths via plain fetch + cookie jar.
// Slower box-friendly version: long timeouts, no playwright.
import { spawnSync } from "node:child_process";

const URL = "http://localhost:3002";
const COOKIE_JAR = new Map();

function setCookies(setCookieHeader) {
  if (!setCookieHeader) return;
  const lines = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const c of lines) {
    const m = c.match(/^([^=;]+)=([^;]*)/);
    if (m) COOKIE_JAR.set(m[1].trim(), m[2].trim());
  }
}
function cookieHeader() {
  return Array.from(COOKIE_JAR.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function fetchTimed(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  try {
    const r = await fetch(URL + path, {
      ...opts,
      headers: {
        ...(opts.headers ?? {}),
        cookie: cookieHeader(),
      },
      redirect: "manual",
      signal: ctrl.signal,
    });
    const sc = r.headers.getSetCookie?.() ?? r.headers.get("set-cookie");
    setCookies(sc);
    return r;
  } finally {
    clearTimeout(timer);
  }
}

const fail = (where, msg) => {
  console.error(`✗ FAIL [${where}] ${msg}`);
  process.exit(1);
};
const ok = (where, msg) => console.log(`✓ ${where}: ${msg}`);

// ─── 1. login ─────────────────────────────────────────────
let csrfToken = "";
{
  const r = await fetchTimed("/api/auth/csrf");
  const j = await r.json();
  csrfToken = j.csrfToken;
  if (!csrfToken) fail("csrf", "no csrfToken");
  ok("csrf", `token len=${csrfToken.length}`);
}
{
  const form = new URLSearchParams({
    csrfToken,
    email: "pedro-onboard@rawclaw.demo",
    password: "rawclaw-onboard-2026",
    json: "true",
    callbackUrl: URL + "/",
  });
  const r = await fetchTimed("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (r.status !== 302 && r.status !== 200) fail("login", `status ${r.status}`);
  ok("login", `status ${r.status} cookies=${COOKIE_JAR.size}`);
}

// ─── 2. atlas-coordinate cron ─────────────────────────────
{
  const r = await fetchTimed("/api/cron/atlas-coordinate", {
    headers: { authorization: "Bearer dev-cron-secret-not-for-prod" },
  });
  if (!r.ok) fail("atlas-coordinate", `status ${r.status}`);
  const j = await r.json();
  if (!j.ok) fail("atlas-coordinate", "ok=false");
  ok("atlas-coordinate", `processed=${j.processed}`);
}

// ─── 3. notifications ─────────────────────────────────────
{
  const r = await fetchTimed("/api/notifications/agents");
  const j = await r.json();
  if (!Array.isArray(j.notifications)) fail("notifications", "no array");
  if (j.notifications.length === 0) fail("notifications", "0 msgs");
  ok("notifications", `${j.notifications.length} msgs, latest kind=${j.notifications[0].kind}`);
}

// ─── 4. data ingest ────────────────────────────────────────
{
  const r = await fetchTimed("/api/data/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "note",
      label: "e2e probe",
      text: "End-to-end probe entry. Confirms ingest + chunk + embed work.",
    }),
  });
  if (!r.ok) fail("data-ingest", `status ${r.status}`);
  const j = await r.json();
  if (!j.ok || j.chunks < 1) fail("data-ingest", JSON.stringify(j));
  ok("data-ingest", `chunks=${j.chunks} tokens=${j.tokens}`);
}

// ─── 5. data recent ────────────────────────────────────────
{
  const r = await fetchTimed("/api/data/recent");
  const j = await r.json();
  if (!Array.isArray(j.entries) || j.entries.length === 0)
    fail("data-recent", "0 entries");
  const found = j.entries.some((e) => e.label === "e2e probe");
  if (!found) fail("data-recent", "probe missing in rail");
  ok("data-recent", `${j.entries.length} entries, probe visible`);
}

// ─── 6. insights + open-chat ──────────────────────────────
{
  const r = await fetchTimed("/api/insights");
  const j = await r.json();
  const ins = j.insights ?? [];
  if (ins.length === 0) {
    ok("insights", "0 insights (fresh org, expected)");
  } else {
    ok("insights", `${ins.length} found, first chat_state=${ins[0].chat_state}`);
    const oc = await fetchTimed(`/api/insights/${ins[0].id}/open-chat`, {
      method: "POST",
    });
    const ocj = await oc.json();
    if (!ocj.ok) fail("open-chat", JSON.stringify(ocj));
    ok("open-chat", `agentId=${ocj.agentId?.slice(0, 8)} queued=${ocj.queued}`);
  }
}

// ─── 7. mcp-tools list ─────────────────────────────────────
{
  const r = await fetchTimed("/api/mcp-tools");
  if (r.status !== 200 && r.status !== 401)
    fail("mcp-tools", `status ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j.tools) && !j.error)
    fail("mcp-tools", "shape broken");
  ok("mcp-tools", `status=${r.status} tools=${j.tools?.length ?? 0}`);
}

// ─── 8. agents list returns Atlas ─────────────────────────
let atlasId = null;
{
  const r = await fetchTimed("/api/agents");
  const j = await r.json();
  if (!Array.isArray(j.agents)) fail("agents", "no array");
  const atlas = j.agents.find((a) => a.role === "ceo");
  if (!atlas) fail("agents", "Atlas not found");
  atlasId = atlas.id;
  ok("agents", `Atlas ${atlas.name} id=${atlas.id.slice(0, 8)}`);
}

// ─── 9. atlas chat history ────────────────────────────────
{
  const r = await fetchTimed(`/api/agents/${atlasId}/chat`);
  const j = await r.json();
  if (!Array.isArray(j.messages)) fail("atlas-chat", "no msgs array");
  ok("atlas-chat", `${j.messages.length} msgs`);
}

// ─── 10. provision-vps.sh syntax ──────────────────────────
{
  const r = spawnSync("bash", ["-n", "scripts/provision-vps.sh"], {
    cwd: "/home/pedroafonso/rawclaw-research/rawclaw",
  });
  if (r.status !== 0) fail("provision-syntax", r.stderr.toString());
  ok("provision-syntax", "bash -n clean");
}

// ─── 11. unit tests ──────────────────────────────────────
{
  const r = spawnSync("npm", ["run", "test:unit"], {
    cwd: "/home/pedroafonso/rawclaw-research/rawclaw",
    encoding: "utf8",
  });
  if (r.status !== 0) {
    fail("unit-tests", r.stdout.slice(-500) + r.stderr.slice(-500));
  }
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const m = out.match(/# pass (\d+)/);
  ok("unit-tests", `pass=${m?.[1] ?? "?"}`);
}

// ─── 12. tasks endpoint ───────────────────────────────────
{
  const r = await fetchTimed("/api/tasks");
  if (r.status !== 200 && r.status !== 404)
    fail("tasks", `status ${r.status}`);
  ok("tasks", `status ${r.status}`);
}

// ─── 13. dashboard stats ──────────────────────────────────
{
  const r = await fetchTimed("/api/dashboard/stats");
  if (!r.ok) fail("dashboard-stats", `status ${r.status}`);
  ok("dashboard-stats", "ok");
}

// ─── 14. approvals endpoint ───────────────────────────────
{
  const r = await fetchTimed("/api/approvals?status=pending");
  if (!r.ok) fail("approvals", `status ${r.status}`);
  ok("approvals", "ok");
}

// ─── 15. company knowledge query ──────────────────────────
{
  const r = await fetchTimed("/api/company/knowledge?q=probe");
  if (r.status !== 200 && r.status !== 404)
    fail("company-knowledge", `status ${r.status}`);
  ok("company-knowledge", `status ${r.status}`);
}

console.log("\n=== ALL E2E PASS ===");
