// Polished insights demo recording (Playwright + recordVideo).
//
// Story arc:
//   1. Login → dashboard
//   2. Red alarm banner pulsing at top ("1 critical metric needs attention")
//   3. Click banner → smooth scroll to insights panel
//   4. Hover over the critical card so user reads reason + suggested action + Q
//   5. Hover trace button → click → drawer animates in
//   6. Trace timeline reveals full chain: anomaly → spawned tasks → done/running
//   7. Expand task output to show what the agent actually shipped
//   8. Close drawer → click Acknowledge → card dims (human in the loop)
//   9. Final hold frame
//
// Visible-cursor overlay is injected into the page so the viewer can
// follow what's clicked - headless Chromium has no native pointer.

import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "/tmp/rawclaw-insights-demo";
const FINAL = join(OUT_DIR, "insights-demo.webm");
const URL = process.env.DEMO_URL || "http://localhost:3002";
const EMAIL = "chris@rawclaw.demo";
const PASSWORD = "rawclaw-demo-2026";

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith(".webm")) {
    try { unlinkSync(join(OUT_DIR, f)); } catch {}
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

// ─── helpers ───────────────────────────────────────────────────────
async function pause(ms) { await page.waitForTimeout(ms); }

const CURSOR_CSS = `
.__demo_cursor {
  position: fixed;
  top: 0; left: 0;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: rgba(0, 220, 130, 0.85);
  box-shadow: 0 0 0 4px rgba(0, 220, 130, 0.25), 0 2px 8px rgba(0,0,0,.5);
  pointer-events: none;
  z-index: 999999;
  transform: translate(-50%, -50%);
  transition: transform 0.45s cubic-bezier(.22,.9,.25,1.05),
              left 0.45s cubic-bezier(.22,.9,.25,1.05),
              top 0.45s cubic-bezier(.22,.9,.25,1.05);
}
.__demo_cursor.click {
  background: rgba(255, 255, 255, 0.95);
  transform: translate(-50%, -50%) scale(0.7);
}
/* Bump the alarm bar so it reads on small viewer thumbnails */
a[href="/#insights"] {
  font-size: 14px !important;
  padding: 14px 18px !important;
  border-width: 2px !important;
}
a[href="/#insights"] svg {
  width: 18px !important;
  height: 18px !important;
}
`;

async function injectCursor() {
  // Inject via evaluate (DOM only) instead of addStyleTag - the latter
  // can trigger Next.js dev HMR and remount client components, which
  // drops SWR state and unmounts the alarm banner.
  await page.evaluate((css) => {
    if (document.getElementById("__demo_style")) return;
    const s = document.createElement("style");
    s.id = "__demo_style";
    s.textContent = css;
    document.head.appendChild(s);
    if (document.querySelector(".__demo_cursor")) return;
    const c = document.createElement("div");
    c.className = "__demo_cursor";
    c.style.left = "720px";
    c.style.top = "100px";
    document.body.appendChild(c);
  }, CURSOR_CSS);
}

async function moveCursorTo(selector, opts = {}) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return null;
  const x = box.x + (opts.dx ?? box.width / 2);
  const y = box.y + (opts.dy ?? box.height / 2);
  await page.evaluate(([x, y]) => {
    const c = document.querySelector(".__demo_cursor");
    if (c) { c.style.left = x + "px"; c.style.top = y + "px"; }
  }, [x, y]);
  await page.mouse.move(x, y);
  await pause(550); // let CSS transition catch up
  return { x, y, box };
}

async function clickWithFeedback(selector) {
  await moveCursorTo(selector);
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

// ─── auth ─────────────────────────────────────────────────────────
console.log(">> auth");
const csrfResp = await ctx.request.get(`${URL}/api/auth/csrf`);
const { csrfToken } = await csrfResp.json();
const cbResp = await ctx.request.post(
  `${URL}/api/auth/callback/credentials`,
  {
    form: { csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${URL}/`, json: "true" },
    headers: { "content-type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
  },
);
if (cbResp.status() >= 400) {
  console.error("auth failed", cbResp.status(), (await cbResp.text()).slice(0, 200));
  process.exit(1);
}

// ─── act 1: dashboard + alarm banner ──────────────────────────────
console.log(">> act 1: dashboard + alarm");
await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });

// Check insights API direct first to confirm data
const apiCheck = await ctx.request.get(`${URL}/api/insights`);
const apiBody = await apiCheck.json();
console.log("  /api/insights count:", (apiBody.insights ?? []).length);
if ((apiBody.insights ?? []).length > 0) {
  console.log("  first:", apiBody.insights[0].severity, apiBody.insights[0].status, apiBody.insights[0].title.slice(0, 50));
}

await pause(10000); // generous for SWR + first render
await injectCursor();

// Wait for alarm banner; snapshot whether it actually exists in DOM
const alarmExists = await page
  .locator('a[href="/#insights"]')
  .first()
  .waitFor({ state: "visible", timeout: 12000 })
  .then(() => true)
  .catch(() => false);
console.log("  alarm visible:", alarmExists);
if (alarmExists) {
  const txt = await page.locator('a[href="/#insights"]').first().innerText();
  console.log("  alarm text:", txt.replace(/\s+/g, " ").trim());
  // Move cursor to alarm so it's prominent
  await moveCursorTo('a[href="/#insights"]');
}
await pause(3500); // let viewer see the pulsing red bar

// ─── act 2: scroll to insights ────────────────────────────────────
console.log(">> act 2: click alarm → scroll to insights");
if (alarmExists) {
  await clickWithFeedback('a[href="/#insights"]');
} else {
  // Fallback: scroll manually
  await page.evaluate(() => {
    const el = document.querySelector("#insights");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
await pause(2500); // smooth-scroll lands

// ─── act 3: hover over critical card ──────────────────────────────
console.log(">> act 3: hover critical card");
await moveCursorTo("#insights h4", { dy: 40 });
await pause(3500); // viewer reads the reason

// ─── act 4: open trace drawer ─────────────────────────────────────
console.log(">> act 4: open trace");
await clickWithFeedback('button:has-text("View trace")');
await pause(4500); // drawer animates + SWR fetch

// ─── act 5: expand task output ────────────────────────────────────
console.log(">> act 5: expand output");
const sumCount = await page.locator("aside details summary").count();
if (sumCount > 0) {
  await clickWithFeedback("aside details summary");
  await pause(3500); // viewer reads the agent's output
}

// ─── act 6: scroll inside drawer ──────────────────────────────────
console.log(">> act 6: scroll drawer");
await page.evaluate(() => {
  const aside = document.querySelector("aside");
  const inner = aside?.querySelector(".overflow-y-auto");
  if (inner) inner.scrollTo({ top: 250, behavior: "smooth" });
});
await pause(2500);

// ─── act 7: close drawer + Approve plan (agentic execution) ───────
console.log(">> act 7: close + APPROVE PLAN");
const xCloseSel = 'aside button[aria-label="Close"]';
const xExists = await page.locator(xCloseSel).first().isVisible().catch(() => false);
if (xExists) {
  await clickWithFeedback(xCloseSel);
} else {
  await page.keyboard.press("Escape");
}
await pause(2000);

// Highlight the new action row by scrolling card into view
await page.evaluate(() => {
  const el = document.querySelector("#insights");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
});
await pause(1500);

// Click Approve plan - the agentic moment. Server kicks off tasks
// via the dept-head agent; status flips to "Executing".
const approveSel = 'button:has-text("Approve plan")';
const approveExists = await page.locator(approveSel).first().isVisible().catch(() => false);
console.log("  approve visible:", approveExists);
if (approveExists) {
  await clickWithFeedback(approveSel);
  // Wait for server to spawn tasks via chatReply (~30s) + status flip
  // to Executing + the inline executing-block to render
  await pause(35000);
  // Scroll back to the insight card so viewer sees the executing state
  await page.evaluate(() => {
    const el = document.querySelector("#insights");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  await pause(3000);
}

// ─── act 8: scroll down to the 5-col dept board ───────────────────
console.log(">> act 8: scroll to 5-col board");
await page.evaluate(() => {
  const sections = document.querySelectorAll("section, article");
  // Scroll to the marketing column header
  const board = document.querySelector('[class*="grid-cols-5"], [class*="lg:grid-cols-5"]');
  if (board) board.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
});
await pause(4500); // viewer reads the 5 dept columns

// Hover one of the column "open →" links so cursor lands there
const openLink = page.locator('a[href*="/departments/"]').first();
if (await openLink.isVisible().catch(() => false)) {
  const box = await openLink.boundingBox();
  if (box) {
    await page.evaluate(([x, y]) => {
      const c = document.querySelector(".__demo_cursor");
      if (c) { c.style.left = x + "px"; c.style.top = y + "px"; }
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await pause(2000);
  }
}

// ─── final hold ───────────────────────────────────────────────────
console.log(">> final hold");
await pause(2500);

console.log(">> done, saving");
await ctx.close();
await browser.close();

const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".webm"));
if (files.length > 0) {
  renameSync(join(OUT_DIR, files[0]), FINAL);
  console.log(`✓ ${FINAL}`);
} else {
  console.error("no video"); process.exit(1);
}
