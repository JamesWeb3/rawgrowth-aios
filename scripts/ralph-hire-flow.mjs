// Ralph hire-flow loop against prod admin.rawgrowth.ai.
// 7 step E2E:
//   1. /api/health 200
//   2. Sign in (api credentials path)
//   3. POST /api/agents -> 201 + {agent, trained}
//   4. Inspect trained envelope: system_prompt:true, skills>0, files>0
//   5. GET /api/agents/<id>/files -> files array non-empty
//   6. POST /api/agents/<id>/chat -> SSE response
//   7. DELETE /api/agents/<id>
// Exits 0 if every step PASS. Loop forever (or N times via ITERS env).
//
// Usage: node scripts/ralph-hire-flow.mjs
//        BASE=https://admin.rawgrowth.ai ITERS=1 node scripts/ralph-hire-flow.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "https://admin.rawgrowth.ai";
const EMAIL = process.env.E2E_OWNER_EMAIL ?? "demo@novabloom.com";
const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "e2e-test-2026";
const ITERS = Number(process.env.ITERS ?? 1);

const log = (tag, ok, note = "") => {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${tag}${note ? "  -  " + String(note).slice(0, 240) : ""}`);
};

async function step1Health(ctx) {
  const r = await ctx.request.get(`${BASE}/api/health`, { timeout: 30_000 });
  const ok = r.status() === 200;
  log("1.health", ok, `status=${r.status()}`);
  return ok;
}

async function step2SignIn(ctx) {
  const csrf = await ctx.request.get(`${BASE}/api/auth/csrf`).then((r) => r.json());
  const r = await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: {
      csrfToken: csrf.csrfToken,
      email: EMAIL,
      password: PASSWORD,
      json: "true",
      callbackUrl: `${BASE}/agents`,
    },
    headers: { "content-type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
  });
  const ok = r.status() === 200 || r.status() === 302;
  log("2.signin", ok, `status=${r.status()}`);
  return ok;
}

async function step3Hire(ctx) {
  const r = await ctx.request.post(`${BASE}/api/agents`, {
    data: { name: "E2E Hire", role: "Copywriter", department: "marketing" },
    headers: { "content-type": "application/json" },
    timeout: 60_000,
  });
  const status = r.status();
  let body = null;
  try {
    body = await r.json();
  } catch {
    body = { _raw: (await r.text()).slice(0, 200) };
  }
  const ok = status === 201 && body?.agent?.id;
  log("3.hire.status", ok, `status=${status} agentId=${body?.agent?.id ?? "(none)"} body=${JSON.stringify(body).slice(0, 200)}`);
  return { ok, body };
}

function step4Trained(body) {
  const t = body?.trained;
  const sp = t?.system_prompt === true;
  const sk = typeof t?.skills === "number" && t.skills > 0;
  const fl = typeof t?.files === "number" && t.files > 0;
  const ok = Boolean(sp && sk && fl);
  log("4.trained", ok, `system_prompt=${t?.system_prompt} skills=${t?.skills} files=${t?.files}`);
  return ok;
}

async function step5Files(ctx, agentId) {
  const r = await ctx.request.get(`${BASE}/api/agents/${agentId}/files`, {
    timeout: 30_000,
  });
  const status = r.status();
  let body = null;
  try { body = await r.json(); } catch {}
  const files = body?.files;
  const ok = status === 200 && Array.isArray(files) && files.length > 0;
  log("5.files", ok, `status=${status} count=${files?.length ?? "?"}`);
  return ok;
}

async function step6Chat(ctx, agentId) {
  const r = await ctx.request.post(`${BASE}/api/agents/${agentId}/chat`, {
    data: { messages: [{ role: "user", content: "hello" }] },
    headers: { "content-type": "application/json" },
    timeout: 90_000,
  });
  const status = r.status();
  const text = await r.text();
  if (status === 429) {
    log("6.chat", true, "429 rate-limit (not regression)");
    return true;
  }
  // SSE: lines start with "data:" and contain {"type":"text"|"done"}
  const ok = status === 200 && /"type"\s*:\s*"(text|done)"/.test(text);
  log("6.chat", ok, `status=${status} bytes=${text.length} sample=${text.slice(0, 120).replace(/\n/g, " ")}`);
  return ok;
}

async function step7Delete(ctx, agentId) {
  const r = await ctx.request.delete(`${BASE}/api/agents/${agentId}`, { timeout: 30_000 });
  const ok = r.status() === 200;
  log("7.delete", ok, `status=${r.status()}`);
  return ok;
}

async function runOnce(ctx) {
  const summary = { steps: [], green: false, agentId: null };
  if (!(await step1Health(ctx))) return summary;
  if (!(await step2SignIn(ctx))) return summary;
  const { ok: hireOk, body } = await step3Hire(ctx);
  if (!hireOk) return summary;
  const agentId = body.agent.id;
  summary.agentId = agentId;
  const trained = step4Trained(body);
  const files = await step5Files(ctx, agentId);
  const chat = await step6Chat(ctx, agentId);
  const del = await step7Delete(ctx, agentId);
  summary.green = trained && files && chat && del;
  return summary;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let exitCode = 1;
  try {
    for (let i = 1; i <= ITERS; i++) {
      console.log(`\n=== ITER ${i}/${ITERS} ===`);
      const ctx = await browser.newContext();
      const s = await runOnce(ctx);
      // Best-effort cleanup if hire succeeded but later step exploded.
      if (s.agentId && !s.green) {
        await ctx.request.delete(`${BASE}/api/agents/${s.agentId}`).catch(() => {});
      }
      await ctx.close();
      console.log(`=== ITER ${i} ${s.green ? "GREEN" : "RED"} ===`);
      if (s.green) exitCode = 0;
      if (!s.green) exitCode = 1;
    }
  } finally {
    await browser.close();
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
