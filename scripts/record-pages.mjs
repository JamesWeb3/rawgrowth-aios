// Simple page-by-page recording. No interactions, just navigate and pause.
// Avoids click flakiness; captures the polished UI of every shipped page.

import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/rawclaw-pages-demo";
const URL = "http://localhost:3002";

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) {
  if (f.endsWith(".webm")) try { unlinkSync(join(OUT, f)); } catch {}
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});

const r = await ctx.request.get(`${URL}/api/auth/csrf`);
const { csrfToken } = await r.json();
await ctx.request.post(`${URL}/api/auth/callback/credentials`, {
  form: { csrfToken, email: "chris@rawclaw.demo", password: "rawclaw-demo-2026", json: "true", callbackUrl: `${URL}/` },
  headers: { "content-type": "application/x-www-form-urlencoded" },
  maxRedirects: 0,
});

const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);

// Live activity overlay (poll /api/activity, render as terminal pane)
const OVERLAY_CSS = `
.__demo_log { position: fixed; top: 88px; right: 16px; width: 280px; max-height: 70vh;
  background: rgba(10, 10, 10, 0.92); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px; padding: 0;
  font-family: ui-monospace, "JetBrains Mono", Consolas, monospace;
  font-size: 10.5px; color: rgba(255,255,255,0.78); z-index: 999998;
  overflow: hidden; backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0,0,0,.4); pointer-events: none; }
.__demo_log * { pointer-events: none; }
.__demo_log h4 { margin: 0; padding: 8px 12px; font-size: 9px; font-weight: 500;
  letter-spacing: 1.2px; text-transform: uppercase; color: rgba(255,255,255,0.5);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; gap: 6px; }
.__demo_log h4::before { content: ""; display: inline-block; width: 6px; height: 6px;
  border-radius: 50%; background: #33ca7f; box-shadow: 0 0 6px rgba(51,202,127,0.7);
  animation: __demo_pulse 1.6s ease-in-out infinite; }
@keyframes __demo_pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.__demo_log .rows { padding: 4px 0; display: flex; flex-direction: column; }
.__demo_log .row { display: grid; grid-template-columns: 52px 1fr;
  gap: 8px; padding: 5px 12px; align-items: baseline; }
.__demo_log .row + .row { border-top: 1px solid rgba(255,255,255,0.04); }
.__demo_log .ts { color: rgba(255,255,255,0.35); font-size: 9.5px;
  font-variant-numeric: tabular-nums; }
.__demo_log .body { display: flex; flex-direction: column; gap: 1px; }
.__demo_log .kind { font-size: 11px; color: rgba(255,255,255,0.92); font-weight: 500; }
.__demo_log .kind.warn { color: #fbbf24; } .__demo_log .kind.crit { color: #f87171; }
.__demo_log .kind.ok { color: #4ade80; }
.__demo_log .actor { color: rgba(255,255,255,0.4); font-size: 9.5px; letter-spacing: 0.3px; }
`;

async function injectOverlay() {
  await page.evaluate((css) => {
    if (document.getElementById("__demo_style")) return;
    const s = document.createElement("style");
    s.id = "__demo_style"; s.textContent = css;
    document.head.appendChild(s);
    if (!document.querySelector(".__demo_log")) {
      const log = document.createElement("div");
      log.className = "__demo_log";
      log.innerHTML = '<h4>Activity</h4><div class="rows"></div>';
      document.body.appendChild(log);
    }
    const KH = {
      insight_created: "anomaly detected", insight_approved: "operator approved plan",
      insight_auto_approved: "atlas auto-approved", insight_retried: "retry - new angle",
      insight_resolved: "metric recovered", insight_escalated: "escalated to human",
      task_created: "task spawned", task_executed: "task ran",
    };
    const fmt = (iso) => new Date(iso).toTimeString().slice(0, 8);
    const seen = new Set();
    async function tick() {
      try {
        const r = await fetch("/api/activity?limit=14");
        if (!r.ok) return;
        const j = await r.json();
        const entries = (j.events ?? []).slice(0, 14);
        const rows = document.querySelector(".__demo_log .rows");
        if (!rows) return;
        for (let i = entries.length - 1; i >= 0; i--) {
          const e = entries[i];
          const id = e.id ?? `${e.ts}-${e.kind}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const tone = (e.kind === "insight_created" || e.kind === "insight_escalated") ? "crit"
            : e.kind === "insight_retried" ? "warn"
            : (e.kind === "insight_resolved" || e.kind === "task_executed") ? "ok" : "";
          const human = KH[e.kind] ?? e.kind.replace(/_/g, " ");
          const actor = e.actor_type === "agent" ? "agent" : (e.actor_type ?? "system");
          const div = document.createElement("div");
          div.className = "row";
          div.innerHTML = `<span class="ts">${fmt(e.ts ?? new Date().toISOString())}</span>` +
            `<span class="body"><span class="kind ${tone}">${human}</span><span class="actor">${actor}</span></span>`;
          if (rows.firstChild) rows.insertBefore(div, rows.firstChild);
          else rows.appendChild(div);
        }
        while (rows.children.length > 14) rows.removeChild(rows.lastChild);
      } catch {}
    }
    setInterval(tick, 1500); tick();
  }, OVERLAY_CSS);
}

const PAGES = [
  { url: "/",                     label: "Dashboard - charts + Atlas banner + alarm" },
  { url: "/files",                label: "Files - Brand+Knowledge merged" },
  { url: "/agents",               label: "Agents - quick hire" },
  { url: "/chat",                 label: "Chat - Atlas + dept heads" },
  { url: "/data",                 label: "Data entry - paste CRM" },
  { url: "/sales-calls",          label: "Sales calls - Fireflies sync" },
  { url: "/connections",          label: "Connections - Composio grid" },
  { url: "/mini-saas",            label: "Mini SaaS - generator" },
  { url: "/activity",             label: "Activity - live audit feed (proper tab)" },
  { url: "/company/autonomous",   label: "Autonomous - Off/Review/On + 30-iter slider" },
];

for (const p of PAGES) {
  console.log(`>> ${p.label}`);
  try {
    await page.goto(`${URL}${p.url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await pause(7500);
    // (overlay removed - activity now lives in its own tab)
    // Brief scroll to show full page if there's overflow
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await pause(2500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await pause(1500);
  } catch (err) {
    console.log(`  fail: ${err.message.slice(0, 100)}`);
  }
}

// ─── Autoresearch live demo on dashboard ──────────────────────────
console.log(">> Autoresearch live: force retry + watch trace");
try {
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await pause(8000);
  await injectOverlay();

  // Scroll to InsightsBanner (below charts)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.querySelector("span.animate-ping") || x.innerText.includes("Atlas"),
    );
    if (b) b.scrollIntoView({ behavior: "smooth", block: "center" });
    else window.scrollTo({ top: 1500, behavior: "smooth" });
  });
  await pause(2500);

  // Click banner via evaluate (avoids overlay/button conflicts)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.querySelector("span.animate-ping"),
    );
    if (b) b.click();
  });
  await pause(4000);

  // Scroll to insights panel anchor
  await page.evaluate(() => {
    const el = document.getElementById("insights");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  await pause(3000);

  // Trigger force-retry server-side - shows agent iterating
  console.log("  triggering force-retry...");
  const insightId = "167d07f7-ada9-4097-b80a-47be4c39003b";
  await ctx.request.post(`${URL}/api/insights/${insightId}/force-retry`, {
    data: {},
    timeout: 90000,
  }).catch((e) => console.log("  force-retry err:", e.message.slice(0, 80)));
  console.log("  retry kicked, holding for activity to land...");
  await pause(15000);

  // Hover over the View trace button (in case panel is expanded)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (x) => x.innerText.includes("View trace"),
    );
    if (btn) btn.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await pause(3500);
} catch (err) {
  console.log("  autoresearch demo fail:", err.message.slice(0, 100));
}

console.log(">> done");
await ctx.close();
await browser.close();

const files = readdirSync(OUT).filter((f) => f.endsWith(".webm"));
if (files.length > 0) {
  renameSync(join(OUT, files[0]), join(OUT, "pages.webm"));
  console.log("✓ /tmp/rawclaw-pages-demo/pages.webm");
}
