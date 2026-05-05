// Full end-to-end demo recording WITH live log overlay + autoresearch retry.
//
// New in this take:
//   - Skip login frames (auth via cookie injection, no signin UI)
//   - Live log overlay (right rail shows audit_log events streaming as
//     the agent works - "task_created", "insight_approved", "retry", etc)
//   - Force autoresearch retry: backdate last_attempt_at then trigger
//     sweep so the metric-still-bad → retry-with-new-angle hop fires
//     ON SCREEN

import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/rawclaw-full-demo";
const URL = process.env.DEMO_URL || "http://localhost:3002";
const EMAIL = "chris@rawclaw.demo";
const PASSWORD = "rawclaw-demo-2026";

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) {
  if (f.endsWith(".webm") || f.endsWith(".png")) {
    try { unlinkSync(join(OUT, f)); } catch {}
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);

// ─── auth FIRST so the recording starts post-login ────────────────
console.log(">> auth (off-screen, before recording)");
const csrfResp = await ctx.request.get(`${URL}/api/auth/csrf`);
const { csrfToken } = await csrfResp.json();
await ctx.request.post(`${URL}/api/auth/callback/credentials`, {
  form: { csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${URL}/`, json: "true" },
  headers: { "content-type": "application/x-www-form-urlencoded" },
  maxRedirects: 0,
});

// ─── overlay CSS + cursor + log feed ──────────────────────────────
const OVERLAY_CSS = `
.__demo_cursor { position: fixed; top: 0; left: 0; width: 22px; height: 22px;
  border-radius: 50%; background: rgba(0, 220, 130, 0.9);
  box-shadow: 0 0 0 4px rgba(0, 220, 130, 0.3), 0 2px 8px rgba(0,0,0,.5);
  pointer-events: none; z-index: 999999; transform: translate(-50%, -50%);
  transition: transform 0.45s cubic-bezier(.22,.9,.25,1.05),
              left 0.45s cubic-bezier(.22,.9,.25,1.05),
              top 0.45s cubic-bezier(.22,.9,.25,1.05); }
.__demo_cursor.click { background: rgba(255,255,255,0.95); transform: translate(-50%,-50%) scale(0.7); }
a[href="/#insights"] { font-size: 14px !important; padding: 14px 18px !important; border-width: 2px !important; }
a[href="/#insights"] svg { width: 18px !important; height: 18px !important; }

/* ── live log feed (minimal terminal pane) ── */
.__demo_log {
  position: fixed; top: 88px; right: 16px; width: 280px; max-height: 70vh;
  background: rgba(10, 10, 10, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px; padding: 0;
  font-family: ui-monospace, "JetBrains Mono", Consolas, monospace;
  font-size: 10.5px; color: rgba(255, 255, 255, 0.78); z-index: 999998;
  overflow: hidden; backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0,0,0,.4);
  pointer-events: none;
}
.__demo_log * { pointer-events: none; }
.__demo_log h4 {
  margin: 0; padding: 8px 12px; font-size: 9px; font-weight: 500;
  letter-spacing: 1.2px; text-transform: uppercase;
  color: rgba(255,255,255,0.5);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex; align-items: center; gap: 6px;
}
.__demo_log h4::before {
  content: ""; display: inline-block; width: 6px; height: 6px;
  border-radius: 50%; background: #33ca7f;
  box-shadow: 0 0 6px rgba(51, 202, 127, 0.7);
  animation: __demo_pulse 1.6s ease-in-out infinite;
}
@keyframes __demo_pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.__demo_log .rows {
  padding: 4px 0;
  display: flex; flex-direction: column;
}
.__demo_log .row {
  display: grid; grid-template-columns: 52px 1fr;
  gap: 8px; padding: 5px 12px;
  align-items: baseline;
}
.__demo_log .row + .row { border-top: 1px solid rgba(255,255,255,0.04); }
.__demo_log .ts {
  color: rgba(255,255,255,0.35); font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}
.__demo_log .body {
  display: flex; flex-direction: column; gap: 1px;
}
.__demo_log .kind {
  font-size: 11px; color: rgba(255,255,255,0.92);
  font-weight: 500;
}
.__demo_log .kind.warn { color: #fbbf24; }
.__demo_log .kind.crit { color: #f87171; }
.__demo_log .kind.ok { color: #4ade80; }
.__demo_log .actor {
  color: rgba(255,255,255,0.4); font-size: 9.5px;
  letter-spacing: 0.3px;
}
`;

async function injectOverlays() {
  await page.evaluate((css) => {
    if (document.getElementById("__demo_style")) return;
    const s = document.createElement("style");
    s.id = "__demo_style"; s.textContent = css;
    document.head.appendChild(s);

    if (!document.querySelector(".__demo_cursor")) {
      const c = document.createElement("div");
      c.className = "__demo_cursor";
      c.style.left = "720px"; c.style.top = "100px";
      document.body.appendChild(c);
    }

    if (!document.querySelector(".__demo_log")) {
      const log = document.createElement("div");
      log.className = "__demo_log";
      log.innerHTML = '<h4>Activity</h4><div class="rows"></div>';
      document.body.appendChild(log);
    }

    // Poll /api/activity every 1.5s and prepend new rows
    const fmt = (iso) => {
      const d = new Date(iso);
      return d.toTimeString().slice(0, 8);
    };
    const KINDS_HUMAN = {
      insight_created: "anomaly detected",
      insight_approved: "operator approved plan",
      insight_auto_approved: "atlas auto-approved",
      insight_retried: "retry - new angle",
      insight_rejected: "operator rejected",
      insight_resolved: "metric recovered",
      insight_escalated: "escalated to human",
      task_created: "task spawned",
      task_executed: "task ran",
      shared_memory_added: "shared memory updated",
      brand_voice_filter: "brand voice applied",
      claude_max_token_refreshed: "auth refreshed",
      data_ingested: "corpus updated",
      autonomous_settings_updated: "autonomous toggle changed",
    };
    const seen = new Set();
    async function tick() {
      try {
        const r = await fetch("/api/activity?limit=12");
        if (!r.ok) return;
        const j = await r.json();
        const entries = (j.events ?? j.activity ?? j.audits ?? []).slice(0, 12);
        const rows = document.querySelector(".__demo_log .rows");
        if (!rows) return;
        for (let i = entries.length - 1; i >= 0; i--) {
          const e = entries[i];
          const id = e.id ?? `${e.ts}-${e.kind}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const div = document.createElement("div");
          div.className = "row";
          const tone =
            e.kind === "insight_created" || e.kind === "insight_escalated" ? "crit"
            : e.kind === "insight_retried" ? "warn"
            : e.kind === "insight_resolved" || e.kind === "task_executed" ? "ok"
            : "";
          const human = KINDS_HUMAN[e.kind] ?? e.kind.replace(/_/g, " ");
          const actor = e.actor_type === "agent" ? "agent" : (e.actor_type ?? "system");
          div.innerHTML =
            `<span class="ts">${fmt(e.ts ?? new Date().toISOString())}</span>` +
            `<span class="body">` +
              `<span class="kind ${tone}">${human}</span>` +
              `<span class="actor">${actor}</span>` +
            `</span>`;
          if (rows.firstChild) rows.insertBefore(div, rows.firstChild);
          else rows.appendChild(div);
        }
        // Trim to top 25
        while (rows.children.length > 25) rows.removeChild(rows.lastChild);
      } catch {}
    }
    setInterval(tick, 1500);
    tick();
  }, OVERLAY_CSS);
}

async function moveCursor(selector, opts = {}) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null);
  if (!box) return null;
  const x = box.x + (opts.dx ?? box.width / 2);
  const y = box.y + (opts.dy ?? box.height / 2);
  await page.evaluate(([x, y]) => {
    const c = document.querySelector(".__demo_cursor");
    if (c) { c.style.left = x + "px"; c.style.top = y + "px"; }
  }, [x, y]);
  await page.mouse.move(x, y);
  await pause(550);
  return { x, y };
}

async function safeGoto(url) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      return;
    } catch (err) {
      console.log(`  goto retry ${i + 1}: ${err.message.slice(0, 80)}`);
      await pause(8000);
    }
  }
  throw new Error(`safeGoto failed after 3 tries: ${url}`);
}

async function clickFb(selector) {
  await moveCursor(selector);
  await pause(350);
  await page.evaluate(() => {
    const c = document.querySelector(".__demo_cursor");
    if (c) c.classList.add("click");
  });
  await page.locator(selector).first().click();
  await pause(180);
  await page.evaluate(() => {
    const c = document.querySelector(".__demo_cursor");
    if (c) c.classList.remove("click");
  });
}

// ─── ACT 1: dashboard (alarm + autonomous pill + 5-col board) ─────
console.log(">> ACT 1: dashboard");
await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
await pause(7500);
await injectOverlays();
await pause(2500);
await moveCursor('a[href="/company/autonomous"]');
await pause(2500);
await moveCursor('a[href="/#insights"]');
await pause(2500);
// Scroll down to InsightsBanner (renders after pillar grid)
await page.evaluate(() => {
  const banners = [...document.querySelectorAll("button")];
  const target = banners.find(b => b.innerText.includes("Atlas") || b.innerText.includes("anomalies"));
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  else window.scrollTo({ top: 1500, behavior: "smooth" });
});
await pause(2500);

// ─── ACT 2: click Atlas banner to expand insights ─────────────────
console.log(">> ACT 2: click Atlas banner → expand insights");
// Banner has the pulse dot inside; match via inner span class then click parent
const candidates = [
  'button:has(span.animate-ping)',
  'button:has-text("new analysis")',
  'button:has-text("Atlas")',
];
let clicked = false;
for (const sel of candidates) {
  const loc = page.locator(sel).first();
  if (await loc.isVisible().catch(() => false)) {
    await loc.scrollIntoViewIfNeeded().catch(() => null);
    await pause(800);
    await clickFb(sel);
    clicked = true;
    console.log("  banner clicked via:", sel);
    break;
  }
}
if (!clicked) console.log("  banner not found");
await pause(4000);

// Hover over the critical card
await moveCursor("#insights h4", { dy: 60 });
await pause(3500);

// ─── ACT 3: trace drawer ──────────────────────────────────────────
console.log(">> ACT 3: trace drawer");
// Scroll insights panel section into view (rendered below banner after expand)
await page.evaluate(() => {
  const el = document.getElementById("insights");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
});
await pause(2000);
const traceBtn = page.locator('button:has-text("View trace")').first();
await traceBtn.waitFor({ state: "visible", timeout: 20000 });
await pause(1000);
await clickFb('button:has-text("View trace")');
await pause(5000);
const sumCount = await page.locator("aside details summary").count();
if (sumCount > 0) {
  await clickFb("aside details summary");
  await pause(3500);
}
await page.keyboard.press("Escape");
await pause(1500);

// ─── ACT 4: approve → tasks spawn ─────────────────────────────────
console.log(">> ACT 4: APPROVE → tasks spawn");
await page.evaluate(() => {
  const el = document.querySelector("#insights");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
});
await pause(1500);
await clickFb('button:has-text("Approve plan")');
console.log("  waiting for chatReply round-trip (~30s)...");
await pause(35000);
await page.evaluate(() => {
  const el = document.querySelector("#insights");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
});
await pause(4500);

// ─── ACT 5: AUTORESEARCH RETRY (force the loop) ───────────────────
console.log(">> ACT 5: force autoresearch retry (Atlas iterates new angle)");
// Trigger retryInsight directly via /api/insights/[id]/force-retry.
// The agent re-thinks with "iteration N: try a DIFFERENT approach"
// prompt, spawns NEW <task> blocks via different angle, audit rows
// land + the live log overlay reflects them.
const insightId = "167d07f7-ada9-4097-b80a-47be4c39003b";
try {
  const retryResp = await ctx.request.post(
    `${URL}/api/insights/${insightId}/force-retry`,
    { data: {}, timeout: 60000 },
  );
  console.log("  force-retry status:", retryResp.status());
} catch (err) {
  console.log("  force-retry crashed (server OOM?):", err.message.slice(0, 80));
  // Continue anyway - the live log overlay still shows the prior
  // retry events from earlier in the session if any
  await pause(15000);
}
console.log("  waiting for retry round-trip + audit rows to land...");
await pause(8000);

await clickFb('button:has-text("View trace")');
await pause(6000);
await page.keyboard.press("Escape");
await pause(2000);

// ─── ACT 6: autonomous settings ───────────────────────────────────
console.log(">> ACT 6: autonomous settings");
await safeGoto(`${URL}/company/autonomous`);
await pause(6000);
await injectOverlays();
await moveCursor('button:has-text("On")');
await pause(2500);
await moveCursor('input[type="range"]', { dx: 200 });
await pause(2500);

// ─── ACT 7: data entry ────────────────────────────────────────────
console.log(">> ACT 7: data entry");
await safeGoto(`${URL}/data`);
await pause(5500);
await injectOverlays();
const dealBtn = page.locator('button:has-text("CRM Deal / Pipeline")').first();
if (await dealBtn.isVisible().catch(() => false)) {
  await moveCursor('button:has-text("CRM Deal / Pipeline")');
  await pause(2000);
  await dealBtn.click();
  await pause(2500);
}

// ─── ACT 8: Atlas chat ────────────────────────────────────────────
console.log(">> ACT 8: Atlas chat");
await safeGoto(`${URL}/chat`);
await pause(6500);
await injectOverlays();
const starter = page.locator('button:has-text("health check")').first();
if (await starter.isVisible().catch(() => false)) {
  await moveCursor('button:has-text("health check")');
  await pause(2500);
}

await pause(2500);

console.log(">> saving");
await ctx.close();
await browser.close();

const files = readdirSync(OUT).filter((f) => f.endsWith(".webm"));
if (files.length > 0) {
  renameSync(join(OUT, files[0]), join(OUT, "full.webm"));
  console.log(`✓ ${join(OUT, "full.webm")}`);
}
