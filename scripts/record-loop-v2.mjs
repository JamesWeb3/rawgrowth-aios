// Big visible loop: open Updates, show ask, approve, watch tasks land in
// Activity, force retry, watch iteration 2 events stream in, expand
// retry event to show council inputs + scores.

import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/rawclaw-loop-v2";
const URL = "http://localhost:3002";
const EMAIL = "chris@rawclaw.demo";
const PASSWORD = "rawclaw-demo-2026";

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) {
  if (f.endsWith(".webm")) try { unlinkSync(join(OUT, f)); } catch {}
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);

const r = await ctx.request.get(URL + "/api/auth/csrf");
const { csrfToken } = await r.json();
await ctx.request.post(URL + "/api/auth/callback/credentials", {
  form: { csrfToken, email: EMAIL, password: PASSWORD, json: "true", callbackUrl: URL + "/" },
  headers: { "content-type": "application/x-www-form-urlencoded" }, maxRedirects: 0,
});

const CURSOR_CSS = `
.__demo_cursor { position: fixed; top: 0; left: 0; width: 22px; height: 22px;
  border-radius: 50%; background: rgba(0, 220, 130, 0.9);
  box-shadow: 0 0 0 4px rgba(0, 220, 130, 0.3), 0 2px 8px rgba(0,0,0,.5);
  pointer-events: none; z-index: 999999; transform: translate(-50%, -50%);
  transition: all 0.4s cubic-bezier(.22,.9,.25,1.05); }
.__demo_cursor.click { background: rgba(255,255,255,0.95); transform: translate(-50%,-50%) scale(0.7); }
`;
async function injectCursor() {
  await page.evaluate((css) => {
    if (document.getElementById("__demo_style")) return;
    const s = document.createElement("style"); s.id = "__demo_style"; s.textContent = css;
    document.head.appendChild(s);
    if (!document.querySelector(".__demo_cursor")) {
      const c = document.createElement("div"); c.className = "__demo_cursor";
      c.style.left = "720px"; c.style.top = "100px"; document.body.appendChild(c);
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
    const c = document.querySelector(".__demo_cursor"); if (c) c.classList.add("click");
  });
  await page.locator(selector).first().click();
  await pause(180);
  await page.evaluate(() => {
    const c = document.querySelector(".__demo_cursor"); if (c) c.classList.remove("click");
  });
}

// ─── ACT 1: /updates - Asks tab with question ─────────────────────
console.log(">> ACT 1: /updates");
await page.goto(URL + "/updates", { waitUntil: "domcontentloaded" });
await pause(8000);
await injectCursor();
await pause(2500);

// Hover stats then ask card
await moveCursor(".grid > div:nth-child(2)"); // Executing stat
await pause(2500);
await moveCursor("ul li", { dy: 60 });
await pause(4000);

// ─── ACT 2: Approve ───────────────────────────────────────────────
console.log(">> ACT 2: Approve plan");
const approveSel = 'button:has-text("Yes - approve plan")';
const approveVisible = await page.locator(approveSel).first().isVisible().catch(() => false);
if (approveVisible) {
  await clickFb(approveSel);
  console.log("  approve clicked, waiting 35s for chatReply...");
  await pause(35000);
}

// ─── ACT 3: Switch to Activity ────────────────────────────────────
console.log(">> ACT 3: Activity tab");
// Programmatic click to avoid Playwright visibility race during compile
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const tab = btns.find((b) => /^Activity\s*\d*$/i.test(b.innerText.trim()));
  if (tab) tab.click();
});
await pause(4000);

// Hover filter chips
const tasksChip = 'button:has-text("Tasks")';
if (await page.locator(tasksChip).first().isVisible().catch(() => false)) {
  await moveCursor(tasksChip);
  await pause(2000);
}

// ─── ACT 4: Force retry ───────────────────────────────────────────
console.log(">> ACT 4: force autoresearch retry");
try {
  const r = await ctx.request.post(URL + "/api/insights/167d07f7-ada9-4097-b80a-47be4c39003b/force-retry", {
    data: {}, timeout: 90000,
  });
  console.log("  retry status:", r.status());
} catch (err) {
  console.log("  retry crashed:", err.message.slice(0, 80));
}
console.log("  waiting 25s for retry event + new tasks to land...");
await pause(25000);

// ─── ACT 5: Scroll to top of feed - latest events ─────────────────
console.log(">> ACT 5: scroll feed to top");
await page.evaluate(() => {
  const ol = document.querySelector("ol");
  if (ol) ol.scrollTop = 0;
  window.scrollTo({ top: 280, behavior: "smooth" });
});
await pause(3500);

// ─── ACT 6: Click first row to expand (task event detail) ─────────
console.log(">> ACT 6: expand top event");
const firstBtn = page.locator("ol > li button").first();
if (await firstBtn.isVisible().catch(() => false)) {
  await clickFb("ol > li button");
  await pause(4500);
}

// ─── ACT 7: Click second row to show another event ────────────────
console.log(">> ACT 7: expand second event");
const secondBtn = page.locator("ol > li").nth(1).locator("button").first();
if (await secondBtn.isVisible().catch(() => false)) {
  await secondBtn.click();
  await pause(4000);
}

// ─── ACT 8: Navigate to /chat - Atlas proactive message ──────────
console.log(">> ACT 8: Atlas chat - proactive message");
await page.goto(URL + "/chat", { waitUntil: "domcontentloaded" });
await pause(7000);
await injectCursor();

// Atlas should be selected by default. The proactive message
// inserted on insight_created should be visible in the thread.
await pause(5000);

// Hover the message bubble
const lastMsg = page.locator('[data-role="assistant"]').last();
if (await lastMsg.isVisible().catch(() => false)) {
  await lastMsg.scrollIntoViewIfNeeded().catch(() => null);
  const box = await lastMsg.boundingBox();
  if (box) {
    await page.evaluate(([x, y]) => {
      const c = document.querySelector(".__demo_cursor");
      if (c) { c.style.left = x + "px"; c.style.top = y + "px"; }
    }, [box.x + box.width / 2, box.y + 30]);
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await pause(4000);
  }
}

// ─── ACT 9: Final hold ────────────────────────────────────────────
console.log(">> ACT 9: final hold");
await pause(3500);

console.log(">> done");
await ctx.close();
await browser.close();

const files = readdirSync(OUT).filter((f) => f.endsWith(".webm"));
if (files.length > 0) {
  renameSync(join(OUT, files[0]), join(OUT, "loop.webm"));
  console.log("✓", join(OUT, "loop.webm"));
}
