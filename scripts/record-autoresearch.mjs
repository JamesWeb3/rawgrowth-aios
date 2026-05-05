// Record Atlas resolving an anomaly via autoresearch loop.
//
// Flow:
//   1. Land on /updates - "Needs your call" tab with 1 ask waiting
//   2. Hover the ask card so viewer reads the question
//   3. Click "Yes - approve plan" - server spawns sub-tasks via dept-head agent (~30s)
//   4. Toast "Plan executing - N tasks spawned"
//   5. Switch to Activity tab - feed shows operator approved + tasks spawning
//   6. Force-retry call (server side) - kicks autoresearch iteration
//   7. Activity shows new "retry - new angle" event landing
//   8. Click the retry event row to expand → human summary + spawned sub-tasks chips
//   9. Final hold

import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/rawclaw-autoresearch";
const URL = process.env.DEMO_URL || "http://localhost:3002";
const EMAIL = "chris@rawclaw.demo";
const PASSWORD = "rawclaw-demo-2026";

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) {
  if (f.endsWith(".webm")) {
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

// ─── auth (off-screen) ────────────────────────────────────────────
console.log(">> auth");
const csrfResp = await ctx.request.get(`${URL}/api/auth/csrf`);
const { csrfToken } = await csrfResp.json();
await ctx.request.post(`${URL}/api/auth/callback/credentials`, {
  form: { csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${URL}/`, json: "true" },
  headers: { "content-type": "application/x-www-form-urlencoded" },
  maxRedirects: 0,
});

// ─── cursor overlay ───────────────────────────────────────────────
const CURSOR_CSS = `
.__demo_cursor { position: fixed; top: 0; left: 0; width: 22px; height: 22px;
  border-radius: 50%; background: rgba(0, 220, 130, 0.9);
  box-shadow: 0 0 0 4px rgba(0, 220, 130, 0.3), 0 2px 8px rgba(0,0,0,.5);
  pointer-events: none; z-index: 999999; transform: translate(-50%, -50%);
  transition: all 0.45s cubic-bezier(.22,.9,.25,1.05); }
.__demo_cursor.click { background: rgba(255,255,255,0.95); transform: translate(-50%,-50%) scale(0.7); }
`;
async function injectCursor() {
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
  }, CURSOR_CSS);
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
}
async function clickFb(selector) {
  await moveCursor(selector);
  await pause(300);
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

// ─── ACT 1: land on /updates ──────────────────────────────────────
console.log(">> ACT 1: /updates - asks waiting");
await page.goto(`${URL}/updates`, { waitUntil: "domcontentloaded" });
await pause(8000);
await injectCursor();
await pause(2500);

// Hover stats then the ask card so viewer reads it
await moveCursor(".grid > div:first-child");
await pause(2000);

await moveCursor("ul li", { dy: 50 });
await pause(4500);

// ─── ACT 2: Approve plan ──────────────────────────────────────────
console.log(">> ACT 2: Approve plan → spawns tasks");
const approveBtn = page.locator('button:has-text("Yes - approve plan")').first();
const approveVisible = await approveBtn.isVisible().catch(() => false);
if (approveVisible) {
  await clickFb('button:has-text("Yes - approve plan")');
  console.log("  waiting for chatReply round-trip (~30s)...");
  await pause(35000);
} else {
  console.log("  approve button not visible, skipping");
}

// ─── ACT 3: switch to Activity tab ────────────────────────────────
console.log(">> ACT 3: Activity tab");
await clickFb('button:has-text("Activity")');
await pause(3500);

// ─── ACT 4: force autoresearch retry ──────────────────────────────
console.log(">> ACT 4: force autoresearch retry");
const insightId = "167d07f7-ada9-4097-b80a-47be4c39003b";
try {
  const r = await ctx.request.post(`${URL}/api/insights/${insightId}/force-retry`, {
    data: {}, timeout: 90000,
  });
  console.log("  retry status:", r.status());
} catch (err) {
  console.log("  retry crashed:", err.message.slice(0, 80));
}
console.log("  waiting for retry event to land in feed...");
await pause(20000);

// ─── ACT 5: scroll feed + expand the retry event ──────────────────
console.log(">> ACT 5: expand retry event");
// Scroll to top so the latest retry event is visible
await page.evaluate(() => window.scrollTo({ top: 200, behavior: "smooth" }));
await pause(2500);

// Click first row to expand it
const firstRow = page.locator("ol > li button").first();
if (await firstRow.isVisible().catch(() => false)) {
  await clickFb("ol > li button");
  await pause(4500);
}

// ─── final hold ───────────────────────────────────────────────────
console.log(">> final hold");
await pause(3500);

console.log(">> saving");
await ctx.close();
await browser.close();

const files = readdirSync(OUT).filter((f) => f.endsWith(".webm"));
if (files.length > 0) {
  renameSync(join(OUT, files[0]), join(OUT, "autoresearch.webm"));
  console.log(`✓ ${join(OUT, "autoresearch.webm")}`);
}
