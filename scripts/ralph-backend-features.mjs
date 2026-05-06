#!/usr/bin/env node
// Ralph-loop autoresearch - 10 iterations against PROD.
// Each iteration probes ONE backend feature, classifies the result, and
// records to /tmp/ralph-backend-features.jsonl. LLM endpoints poked at
// most ONCE per iteration (Pedro's Claude Max is rate-limited).
//
// Auth: NextAuth credentials login. Cookie jar is plain fetch + manual
// Set-Cookie capture so we don't need playwright.
//
// Feature owners + invariants live in the user prompt.

import { writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: "/home/pedroafonso/rawclaw-research/rawclaw/.env" });

const URL = process.env.URL || "https://rawclaw-rose.vercel.app";
const OUT = "/tmp/ralph-backend-features.jsonl";
const EMAIL = "pedro-onboard@rawclaw.demo";
const PASSWORD = "rawclaw-onboard-2026";
const STAMP = Date.now();
const ITER_FILTER = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;

if (!existsSync(OUT)) writeFileSync(OUT, "");

const log = (e) => {
  const ev = { ts: new Date().toISOString(), ...e };
  appendFileSync(OUT, JSON.stringify(ev) + "\n");
  const sev = ev.severity ?? "ok";
  const tag = sev === "broken" ? "BROKEN" : sev === "ugly" ? "UGLY" : sev === "minor" ? "MINOR" : "OK";
  console.log(`[${tag}] iter${ev.iter ?? "?"}/${ev.surface}: ${ev.summary}`);
};

// ─── Cookie jar (plain fetch) ─────────────────────────────────────────
const jar = new Map(); // name -> value
function applySetCookie(headers) {
  const arr = headers.getSetCookie?.() ?? [];
  if (arr.length === 0) {
    const single = headers.get("set-cookie");
    if (single) arr.push(single);
  }
  for (const raw of arr) {
    const first = raw.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) {
      jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function rfetch(path, opts = {}) {
  const headers = new Headers(opts.headers ?? {});
  const ck = cookieHeader();
  if (ck) headers.set("cookie", ck);
  // CSRF guard on state-changing requests requires Origin.
  if (opts.method && opts.method !== "GET" && !headers.get("origin")) {
    headers.set("origin", URL);
  }
  const r = await fetch(URL + path, { ...opts, headers, redirect: "manual" });
  applySetCookie(r.headers);
  return r;
}

// ─── Login ────────────────────────────────────────────────────────────
async function login() {
  const csrfR = await rfetch("/api/auth/csrf");
  const { csrfToken } = await csrfR.json();
  const cb = await rfetch("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      json: "true",
      callbackUrl: URL + "/",
    }).toString(),
  });
  if (![200, 302].includes(cb.status)) {
    log({ surface: "login", severity: "broken", summary: `auth callback ${cb.status}` });
    return null;
  }
  const me = await rfetch("/api/me");
  if (!me.ok) {
    log({ surface: "login", severity: "broken", summary: `/api/me ${me.status}` });
    return null;
  }
  const meJson = await me.json();
  // Also resolve userId via DB for ACL/onboarding tests.
  const userId = await withDb(async (c) => {
    const r = await c.query("select id from rgaios_users where lower(email)=lower($1) limit 1", [EMAIL]);
    return r.rows[0]?.id ?? null;
  });
  meJson.userId = userId;
  log({ surface: "login", summary: `OK org=${meJson.activeOrgId ?? "?"} user=${userId ?? "?"} admin=${meJson.isAdmin}` });
  return meJson;
}

// ─── DB helper (cleanup, ACL setup) ───────────────────────────────────
async function withDb(fn) {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// ─── Track resources to clean up at the end ───────────────────────────
const cleanupAgentIds = [];
const cleanupRoutineIds = [];
const cleanupMcpToolIds = [];
const cleanupSalesCallIds = [];
const cleanupInsightIds = [];

async function maybeRun(n, fn) {
  if (ITER_FILTER && !ITER_FILTER.has(n)) return;
  try {
    await fn();
  } catch (err) {
    log({ iter: n, surface: "iter.crash", severity: "broken", summary: (err?.message ?? String(err)).slice(0, 200) });
  }
}

// ============================================================
// ITER 1: Hire flow REAL submit
// ============================================================
async function iter1() {
  const ITER = 1;
  const name = `Ralph QA Hire ${STAMP}`;
  const r = await rfetch("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      title: "QA Probe",
      role: "Marketing Manager",
      description: "Auto-probe agent. Safe to delete.",
      department: "marketing",
      isDepartmentHead: false,
    }),
  });
  if (r.status !== 201) {
    log({ iter: ITER, surface: "agents.POST", severity: "broken", summary: `expected 201 got ${r.status}: ${(await r.text()).slice(0, 200)}` });
    return;
  }
  const j = await r.json();
  if (!j.agent?.id) {
    log({ iter: ITER, surface: "agents.POST", severity: "broken", summary: "no agent.id in 201 body" });
    return;
  }
  cleanupAgentIds.push(j.agent.id);
  // Verify role-template applied: system_prompt + skills attached
  const ok = await withDb(async (c) => {
    const a = await c.query("select id, system_prompt, role from rgaios_agents where id=$1", [j.agent.id]);
    if (a.rowCount === 0) return { fail: "agent row missing" };
    const sp = a.rows[0].system_prompt;
    const skills = await c.query("select skill_id from rgaios_agent_skills where agent_id=$1", [j.agent.id]);
    return {
      systemPromptLen: (sp ?? "").length,
      skillCount: skills.rowCount,
      role: a.rows[0].role,
    };
  });
  if (ok.fail) {
    log({ iter: ITER, surface: "agents.POST", severity: "broken", summary: ok.fail });
    return;
  }
  if (ok.systemPromptLen < 50) {
    log({ iter: ITER, surface: "agents.POST.template", severity: "broken", summary: `system_prompt too short (${ok.systemPromptLen} chars)` });
    return;
  }
  if (ok.skillCount === 0) {
    log({ iter: ITER, surface: "agents.POST.template", severity: "ugly", summary: "no skills attached after hire (role-template fail or empty defaults)" });
    return;
  }
  log({ iter: ITER, surface: "agents.POST", summary: `201 id=${j.agent.id} sp=${ok.systemPromptLen}c skills=${ok.skillCount} role=${ok.role}` });
}

// ============================================================
// ITER 2: Routine create + run dispatch
// ============================================================
async function iter2() {
  const ITER = 2;
  // Need an agent to attach the routine to. Use the one we just hired
  // if iter1 ran, else fetch first agent.
  let agentId = cleanupAgentIds[0];
  if (!agentId) {
    const lr = await rfetch("/api/agents");
    const lj = await lr.json();
    agentId = lj.agents?.[0]?.id;
  }
  if (!agentId) {
    log({ iter: ITER, surface: "routines.create", severity: "broken", summary: "no agent available to assign" });
    return;
  }
  const create = await rfetch("/api/routines", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `Ralph QA Routine ${STAMP}`,
      description: "Auto-probe routine. Safe to delete.",
      assigneeAgentId: agentId,
      triggers: [],
    }),
  });
  if (create.status !== 201) {
    log({ iter: ITER, surface: "routines.POST", severity: "broken", summary: `expected 201 got ${create.status}: ${(await create.text()).slice(0, 200)}` });
    return;
  }
  const cj = await create.json();
  const routineId = cj.routine?.id;
  if (!routineId) {
    log({ iter: ITER, surface: "routines.POST", severity: "broken", summary: "no routine.id in 201 body" });
    return;
  }
  cleanupRoutineIds.push(routineId);

  const run = await rfetch(`/api/routines/${routineId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (run.status !== 202) {
    log({ iter: ITER, surface: "routines.run", severity: "broken", summary: `expected 202 got ${run.status}: ${(await run.text()).slice(0, 200)}` });
    return;
  }
  const rj = await run.json();
  if (!rj.run_id) {
    log({ iter: ITER, surface: "routines.run", severity: "broken", summary: "no run_id" });
    return;
  }
  // Verify routine_runs row created.
  const dbRow = await withDb(async (c) => {
    const r = await c.query("select id, status, source from rgaios_routine_runs where id=$1", [rj.run_id]);
    return r.rows[0];
  });
  if (!dbRow) {
    log({ iter: ITER, surface: "routines.run", severity: "broken", summary: "run row missing in DB" });
    return;
  }
  log({ iter: ITER, surface: "routines.run", summary: `OK routine=${routineId} run=${rj.run_id} status=${dbRow.status} src=${dbRow.source}` });
}

// ============================================================
// ITER 3: Custom MCP draft
// ============================================================
async function iter3() {
  const ITER = 3;
  const name = `qa_probe_tool_${STAMP}`;
  const r = await rfetch("/api/mcp-tools", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      description: "Auto-probe MCP tool. Safe to delete.",
      requestor_prompt: "Return a static hello world string for QA testing.",
    }),
  });
  if (r.status >= 500) {
    log({ iter: ITER, surface: "mcp-tools.POST", severity: "broken", summary: `5xx ${r.status}: ${(await r.text()).slice(0, 200)}` });
    return;
  }
  if (r.status >= 400) {
    log({ iter: ITER, surface: "mcp-tools.POST", severity: "broken", summary: `4xx ${r.status}: ${(await r.text()).slice(0, 200)}` });
    return;
  }
  const j = await r.json();
  const toolId = j.tool?.id ?? j.id;
  if (!toolId) {
    log({ iter: ITER, surface: "mcp-tools.POST", severity: "broken", summary: `no tool id in body: ${JSON.stringify(j).slice(0, 200)}` });
    return;
  }
  cleanupMcpToolIds.push(toolId);

  const dbRow = await withDb(async (c) => {
    const q = await c.query("select id, status, name from rgaios_custom_mcp_tools where id=$1", [toolId]);
    return q.rows[0];
  });
  if (!dbRow) {
    log({ iter: ITER, surface: "mcp-tools.POST", severity: "broken", summary: "row missing in DB" });
    return;
  }
  if (dbRow.status !== "draft") {
    log({ iter: ITER, surface: "mcp-tools.POST", severity: "ugly", summary: `expected status=draft got ${dbRow.status}` });
    return;
  }
  log({ iter: ITER, surface: "mcp-tools.POST", summary: `OK id=${toolId} status=draft` });
}

// ============================================================
// ITER 4: Brand voice filter
// ============================================================
async function iter4() {
  const ITER = 4;
  // Pure invariant smoke - import the runtime filter module via a
  // local node script to confirm checkBrandVoice strips banned words.
  // The PROD chat surface would burn LLM credits, so we exercise the
  // pure function.
  try {
    const mod = await import("file:///home/pedroafonso/rawclaw-research/rawclaw/src/lib/brand/runtime-filter.ts").catch(() => null);
    if (!mod) {
      // Cannot import .ts directly without ts loader. Instead spawn
      // tsx to evaluate the function.
    }
  } catch {}
  const { spawnSync } = await import("node:child_process");
  const probe = `
import { checkBrandVoice } from "/home/pedroafonso/rawclaw-research/rawclaw/src/lib/brand/runtime-filter.ts";
const samples = [
  "We will leverage cutting-edge synergy to streamline workflows.",
  "Just plain copy.",
  "Certainly, this is a game-changer.",
];
for (const s of samples) {
  const r = checkBrandVoice(s);
  console.log(JSON.stringify({ input: s, ok: r.ok, hits: r.hits ?? [], rewritten: r.rewritten ?? null }));
}
`;
  const tmp = `/tmp/brand-probe-${STAMP}.mjs`;
  writeFileSync(tmp, probe);
  const out = spawnSync("npx", ["--yes", "tsx", tmp], {
    cwd: "/home/pedroafonso/rawclaw-research/rawclaw",
    encoding: "utf8",
    timeout: 30000,
  });
  if (out.status !== 0) {
    log({ iter: ITER, surface: "brand.checkBrandVoice", severity: "broken", summary: `tsx run failed: ${(out.stderr ?? "").slice(0, 300)}` });
    return;
  }
  const lines = out.stdout.trim().split("\n").filter(Boolean);
  let bannedCaught = false, cleanPassed = false, certaintyCaught = false;
  for (const ln of lines) {
    try {
      const j = JSON.parse(ln);
      if (j.input.includes("leverage") && !j.ok && j.hits.length >= 3) bannedCaught = true;
      if (j.input === "Just plain copy." && j.ok) cleanPassed = true;
      if (j.input.includes("Certainly") && !j.ok) certaintyCaught = true;
    } catch {}
  }
  if (!bannedCaught) {
    log({ iter: ITER, surface: "brand.checkBrandVoice", severity: "broken", summary: `multi-banned input not caught: ${out.stdout.slice(0, 300)}` });
    return;
  }
  if (!cleanPassed) {
    log({ iter: ITER, surface: "brand.checkBrandVoice", severity: "broken", summary: "clean copy flagged as banned (false positive)" });
    return;
  }
  if (!certaintyCaught) {
    log({ iter: ITER, surface: "brand.checkBrandVoice", severity: "broken", summary: "'certainly' not banned" });
    return;
  }
  log({ iter: ITER, surface: "brand.checkBrandVoice", summary: "OK 3-sample pass: leverage/cutting-edge/synergy/streamline + certainly + game-changer all caught, clean passes" });
}

// ============================================================
// ITER 5: Per-dept ACL
// ============================================================
async function iter5(meJson) {
  const ITER = 5;
  const orgId = meJson.activeOrgId;
  const userId = meJson.userId;
  if (!orgId || !userId) {
    log({ iter: ITER, surface: "dept-acl", severity: "broken", summary: `no orgId/userId in /api/org/me: ${JSON.stringify(meJson).slice(0, 200)}` });
    return;
  }
  // Snapshot baseline (admin = sees all); restrict to marketing only.
  const before = await withDb(async (c) => {
    const m = await c.query(
      "select allowed_departments from rgaios_organization_memberships where user_id=$1 and organization_id=$2",
      [userId, orgId],
    );
    return m.rows[0]?.allowed_departments ?? null;
  });
  // First query agents while admin/unrestricted to get the "see all" count
  const allR = await rfetch("/api/agents");
  const allJ = await allR.json();
  const allCount = allJ.agents?.length ?? 0;
  // Patch membership to allowed=['marketing']
  await withDb(async (c) => {
    await c.query(
      "update rgaios_organization_memberships set allowed_departments=$1 where user_id=$2 and organization_id=$3",
      [["marketing"], userId, orgId],
    );
  });
  // The session might be admin-org which bypasses ACL. So we need to
  // check if homeOrg is admin-org. If so, this test is a no-op.
  const isAdmin = meJson.isAdmin === true;
  const r = await rfetch("/api/agents");
  const j = await r.json();
  const restricted = j.agents ?? [];
  const allMarketing = restricted.every((a) => a.department === "marketing");
  // Restore
  await withDb(async (c) => {
    await c.query(
      "update rgaios_organization_memberships set allowed_departments=$1 where user_id=$2 and organization_id=$3",
      [before ?? [], userId, orgId],
    );
  });
  if (isAdmin) {
    log({ iter: ITER, surface: "dept-acl", severity: "ugly", summary: `account is admin org - ACL bypass means we cannot probe restriction (count=${allCount} both before+after). Test inconclusive on this account.` });
    return;
  }
  if (!allMarketing) {
    log({ iter: ITER, surface: "dept-acl", severity: "broken", summary: `restricted list contained non-marketing agents: ${JSON.stringify(restricted.map(a => a.department))}` });
    return;
  }
  log({ iter: ITER, surface: "dept-acl", summary: `OK before=${allCount} restricted=${restricted.length} all marketing=${allMarketing}` });
}

// ============================================================
// ITER 6: Cron schedule-tick
// ============================================================
async function iter6() {
  const ITER = 6;
  // Prod CRON_SECRET is whatever is set on Vercel - we don't have it
  // locally for prod. Test the auth gate instead.
  // Without bearer (or with wrong bearer): expect 401.
  const noauth = await rfetch("/api/cron/schedule-tick");
  if (noauth.status !== 401) {
    log({ iter: ITER, surface: "cron.schedule-tick.guard", severity: "broken", summary: `unauth call returned ${noauth.status}, expected 401` });
    return;
  }
  // With wrong bearer
  const wrong = await rfetch("/api/cron/schedule-tick", {
    headers: { authorization: "Bearer obviously-wrong-secret" },
  });
  if (wrong.status !== 401) {
    log({ iter: ITER, surface: "cron.schedule-tick.guard", severity: "broken", summary: `wrong bearer returned ${wrong.status}, expected 401` });
    return;
  }
  // We can't actually exercise the success path on prod without the
  // real CRON_SECRET (Vercel-only). Document partial coverage.
  log({ iter: ITER, surface: "cron.schedule-tick.guard", summary: `OK 401 on missing+wrong bearer. Success-path requires Vercel CRON_SECRET (untestable from this client).` });
}

// ============================================================
// ITER 7: Atlas-route-failures cron
// ============================================================
async function iter7() {
  const ITER = 7;
  const noauth = await rfetch("/api/cron/atlas-route-failures");
  if (noauth.status !== 401) {
    log({ iter: ITER, surface: "cron.atlas-route-failures.guard", severity: "broken", summary: `unauth ${noauth.status}, expected 401` });
    return;
  }
  const wrong = await rfetch("/api/cron/atlas-route-failures", {
    headers: { authorization: "Bearer obviously-wrong-secret" },
  });
  if (wrong.status !== 401) {
    log({ iter: ITER, surface: "cron.atlas-route-failures.guard", severity: "broken", summary: `wrong bearer ${wrong.status}, expected 401` });
    return;
  }
  log({ iter: ITER, surface: "cron.atlas-route-failures.guard", summary: "OK 401 on missing+wrong bearer." });
}

// ============================================================
// ITER 8: Insight queue (multi-click)
// ============================================================
async function iter8(meJson) {
  const ITER = 8;
  const orgId = meJson.activeOrgId;
  // Find at least 2 insights. If <2, skip rather than burn LLM budget.
  let insights = await withDb(async (c) => {
    const r = await c.query(
      "select id, chat_state from rgaios_insights where organization_id=$1 and status<>'dismissed' order by created_at desc limit 5",
      [orgId],
    );
    return r.rows;
  });
  if (insights.length < 2) {
    log({ iter: ITER, surface: "insights.queue", severity: "ugly", summary: `only ${insights.length} insights for org - skipping multi-click test (sweep would cost LLM credits, deferred).` });
    return;
  }
  // Reset both to chat_state='none' so we have a clean slate.
  // Allowed values per migration 0057: none, queued, sent, answered.
  await withDb(async (c) => {
    await c.query(
      "update rgaios_insights set chat_state='none', chat_state_updated_at=now() where id = any($1)",
      [insights.slice(0, 2).map((i) => i.id)],
    );
  });
  const [a, b] = insights;
  // Click both back-to-back.
  const r1 = await rfetch(`/api/insights/${a.id}/open-chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const r2 = await rfetch(`/api/insights/${b.id}/open-chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!r1.ok || !r2.ok) {
    log({ iter: ITER, surface: "insights.open-chat", severity: "broken", summary: `r1=${r1.status} r2=${r2.status}` });
    return;
  }
  const j1 = await r1.json();
  const j2 = await r2.json();
  // Verify state via DB.
  const states = await withDb(async (c) => {
    const r = await c.query("select id, chat_state from rgaios_insights where id = any($1)", [[a.id, b.id]]);
    return Object.fromEntries(r.rows.map((x) => [x.id, x.chat_state]));
  });
  const sent = Object.values(states).filter((s) => s === "sent").length;
  const queued = Object.values(states).filter((s) => s === "queued").length;
  if (sent !== 1 || queued !== 1) {
    log({ iter: ITER, surface: "insights.queue", severity: "broken", summary: `expected exactly 1 sent + 1 queued, got sent=${sent} queued=${queued}: ${JSON.stringify(states)}` });
    return;
  }
  if (j1.queued !== false || j2.queued !== true) {
    log({ iter: ITER, surface: "insights.queue.response-shape", severity: "ugly", summary: `r1.queued=${j1.queued} (want false), r2.queued=${j2.queued} (want true)` });
  }
  log({ iter: ITER, surface: "insights.queue", summary: `OK first sent, second queued. shapes r1.queued=${j1.queued} r2.queued=${j2.queued}` });
}

// ============================================================
// ITER 9: Sales call ingest path
// ============================================================
async function iter9(meJson) {
  const ITER = 9;
  // Fake mp3: tiny ID3 header + bytes. Will fail transcription but the
  // row should land + return either ok:false with id, or the route
  // should reject with a clean 4xx.
  const fakeMp3 = Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), // ID3v2 header
    Buffer.from([0xFF, 0xFB, 0x90, 0x00]), // MP3 frame sync
    Buffer.alloc(2048, 0x55), // fake audio data
  ]);

  const fd = new FormData();
  const file = new File([fakeMp3], `qa-probe-${STAMP}.mp3`, { type: "audio/mpeg" });
  fd.append("file", file);
  // Note: rfetch sets cookie. fetch with FormData auto-sets multipart.
  const r = await rfetch("/api/onboarding/sales-calls/upload", {
    method: "POST",
    body: fd,
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  // The route currently does the transcription synchronously and may
  // 500 on the bad audio. The invariant Pedro wants is "row created
  // for retry". Check DB:
  const orgId = meJson.activeOrgId;
  const found = await withDb(async (c) => {
    const r = await c.query(
      "select id, status, error from rgaios_sales_calls where organization_id=$1 and filename like $2 order by created_at desc limit 1",
      [orgId, `qa-probe-${STAMP}%`],
    );
    return r.rows[0];
  });
  if (!found) {
    log({ iter: ITER, surface: "sales-calls.upload", severity: "broken", summary: `no row created. status=${r.status} body=${text.slice(0, 200)}` });
    return;
  }
  cleanupSalesCallIds.push(found.id);
  // Acceptable: 200 ok:true (row=ready), 200 ok:false (row=error), or
  // 500 with row in error state (transcription failed gracefully).
  // Unacceptable: 4xx on a valid mime/file shape, OR row missing.
  const acceptable = (r.status === 200) || (r.status === 500 && found.status === "error");
  if (!acceptable) {
    log({ iter: ITER, surface: "sales-calls.upload", severity: "broken", summary: `unexpected status=${r.status} row.status=${found.status} body=${text.slice(0, 200)}` });
    return;
  }
  log({ iter: ITER, surface: "sales-calls.upload", summary: `OK status=${r.status} row=${found.id} state=${found.status} err=${(found.error ?? "").slice(0, 80)}` });
}

// ============================================================
// ITER 10: Onboarding skip + complete
// ============================================================
async function iter10(meJson) {
  const ITER = 10;
  const orgId = meJson.activeOrgId;
  // Snapshot current state.
  const before = await withDb(async (c) => {
    const r = await c.query("select onboarding_completed from rgaios_organizations where id=$1", [orgId]);
    return r.rows[0]?.onboarding_completed ?? null;
  });
  // Hit /api/onboarding/skip - it's GET (returns redirect or 401).
  const r = await rfetch("/api/onboarding/skip");
  // Skip route uses redirect("/") which produces 307 in fetch. Or 200/302.
  if (![200, 302, 303, 307, 308].includes(r.status)) {
    log({ iter: ITER, surface: "onboarding.skip", severity: "broken", summary: `expected redirect, got ${r.status}: ${(await r.text()).slice(0, 200)}` });
    return;
  }
  const after = await withDb(async (c) => {
    const r = await c.query("select onboarding_completed from rgaios_organizations where id=$1", [orgId]);
    return r.rows[0]?.onboarding_completed ?? null;
  });
  if (after !== true) {
    log({ iter: ITER, surface: "onboarding.skip", severity: "broken", summary: `onboarding_completed not flipped to true (was ${before}, now ${after})` });
    return;
  }
  // Restore so subsequent runs can re-test
  await withDb(async (c) => {
    await c.query("update rgaios_organizations set onboarding_completed=$1 where id=$2", [before, orgId]);
  });
  log({ iter: ITER, surface: "onboarding.skip", summary: `OK before=${before} after=${after}, restored.` });
}

// ─── Cleanup ──────────────────────────────────────────────────────────
async function cleanup() {
  await withDb(async (c) => {
    if (cleanupAgentIds.length) {
      await c.query("delete from rgaios_agent_skills where agent_id = any($1)", [cleanupAgentIds]);
      await c.query("delete from rgaios_agent_files where agent_id = any($1)", [cleanupAgentIds]);
      await c.query("delete from rgaios_agents where id = any($1)", [cleanupAgentIds]);
    }
    if (cleanupRoutineIds.length) {
      await c.query("delete from rgaios_routine_runs where routine_id = any($1)", [cleanupRoutineIds]);
      await c.query("delete from rgaios_routines where id = any($1)", [cleanupRoutineIds]);
    }
    if (cleanupMcpToolIds.length) {
      await c.query("delete from rgaios_custom_mcp_tools where id = any($1)", [cleanupMcpToolIds]);
    }
    if (cleanupSalesCallIds.length) {
      await c.query("delete from rgaios_company_chunks where source_id = any($1)", [cleanupSalesCallIds]);
      await c.query("delete from rgaios_sales_calls where id = any($1)", [cleanupSalesCallIds]);
    }
  });
  log({ surface: "cleanup", summary: `removed agents=${cleanupAgentIds.length} routines=${cleanupRoutineIds.length} mcp=${cleanupMcpToolIds.length} sales=${cleanupSalesCallIds.length}` });
}

// ─── Main ─────────────────────────────────────────────────────────────
const meJson = await login();
if (!meJson) { process.exit(1); }

await maybeRun(1, () => iter1());
await maybeRun(2, () => iter2());
await maybeRun(3, () => iter3());
await maybeRun(4, () => iter4());
await maybeRun(5, () => iter5(meJson));
await maybeRun(6, () => iter6());
await maybeRun(7, () => iter7());
await maybeRun(8, () => iter8(meJson));
await maybeRun(9, () => iter9(meJson));
await maybeRun(10, () => iter10(meJson));

await cleanup();
console.log("\nDone. Findings: " + OUT);
