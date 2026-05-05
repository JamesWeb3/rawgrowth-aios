// Multiple short focused videos (30-50s each) instead of one 5min reel.
// Each scene records independently, server crashes don't lose previous takes.

import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const URL = "http://localhost:3002";
const EMAIL = "chris@rawclaw.demo";
const PASSWORD = "rawclaw-demo-2026";
const OUT = "/tmp/rawclaw-shorts";

mkdirSync(OUT, { recursive: true });

const SCENES = [
  {
    id: "01-updates-asks",
    name: "Updates - Asks tab + Approve flow",
    fn: async (page, ctx, pause, moveCursor, clickFb, injectCursor) => {
      await page.goto(URL + "/updates", { waitUntil: "domcontentloaded" });
      await pause(7000);
      await injectCursor();
      await pause(2000);
      await moveCursor(".grid > div:nth-child(2)"); // Executing stat
      await pause(2500);
      await moveCursor("ul li", { dy: 60 });
      await pause(4500);
      const approveSel = 'button:has-text("Yes - approve plan")';
      if (await page.locator(approveSel).first().isVisible().catch(() => false)) {
        await clickFb(approveSel);
        await pause(8000);
      }
    },
  },
  {
    id: "02-activity-feed",
    name: "Activity feed - autoresearch loop running",
    fn: async (page, ctx, pause, moveCursor, clickFb, injectCursor) => {
      await page.goto(URL + "/updates", { waitUntil: "domcontentloaded" });
      await pause(6000);
      await injectCursor();
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll("button")];
        const tab = btns.find((b) => /^Activity\s*\d*$/i.test(b.innerText.trim()));
        if (tab) tab.click();
      });
      await pause(4000);
      await moveCursor('button:has-text("Tasks")');
      await pause(2500);
      // Click first row to expand
      const first = page.locator("ol > li button").first();
      if (await first.isVisible().catch(() => false)) {
        await clickFb("ol > li button");
        await pause(5500);
      }
    },
  },
  {
    id: "03-atlas-chat-proactive",
    name: "Atlas chat - proactive message + Open Updates button",
    fn: async (page, ctx, pause, moveCursor, clickFb, injectCursor) => {
      await page.goto(URL + "/chat", { waitUntil: "domcontentloaded" });
      await pause(7000);
      await injectCursor();
      // Hover the proactive bubble
      const bubble = page.locator('[data-role="assistant"]').last();
      if (await bubble.isVisible().catch(() => false)) {
        await bubble.scrollIntoViewIfNeeded().catch(() => null);
        await pause(1500);
        const box = await bubble.boundingBox();
        if (box) {
          await page.evaluate(([x, y]) => {
            const c = document.querySelector(".__demo_cursor");
            if (c) { c.style.left = x + "px"; c.style.top = y + "px"; }
          }, [box.x + box.width / 2, box.y + 40]);
          await page.mouse.move(box.x + box.width / 2, box.y + 40);
          await pause(4500);
        }
      }
    },
  },
  {
    id: "04-bell-notification",
    name: "Bell notification - dropdown",
    fn: async (page, ctx, pause, moveCursor, clickFb, injectCursor) => {
      await page.goto(URL + "/", { waitUntil: "domcontentloaded" });
      await pause(7500);
      await injectCursor();
      await pause(1500);
      const bell = page.locator('button[aria-label*="agent notifications"]').first();
      if (await bell.isVisible().catch(() => false)) {
        const box = await bell.boundingBox();
        if (box) {
          await page.evaluate(([x, y]) => {
            const c = document.querySelector(".__demo_cursor");
            if (c) { c.style.left = x + "px"; c.style.top = y + "px"; }
          }, [box.x + box.width / 2, box.y + box.height / 2]);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await pause(800);
          await bell.click();
          await pause(4500);
        }
      }
    },
  },
];

const CURSOR_CSS = `
.__demo_cursor { position: fixed; top: 0; left: 0; width: 22px; height: 22px;
  border-radius: 50%; background: rgba(0, 220, 130, 0.9);
  box-shadow: 0 0 0 4px rgba(0, 220, 130, 0.3), 0 2px 8px rgba(0,0,0,.5);
  pointer-events: none; z-index: 999999; transform: translate(-50%, -50%);
  transition: all 0.4s cubic-bezier(.22,.9,.25,1.05); }
.__demo_cursor.click { background: rgba(255,255,255,0.95); transform: translate(-50%,-50%) scale(0.7); }
`;

async function recordScene(scene) {
  const sceneDir = join(OUT, scene.id);
  mkdirSync(sceneDir, { recursive: true });
  for (const f of readdirSync(sceneDir)) {
    if (f.endsWith(".webm")) try { unlinkSync(join(sceneDir, f)); } catch {}
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: sceneDir, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();
  const pause = (ms) => page.waitForTimeout(ms);

  const r = await ctx.request.get(URL + "/api/auth/csrf");
  const { csrfToken } = await r.json();
  await ctx.request.post(URL + "/api/auth/callback/credentials", {
    form: { csrfToken, email: EMAIL, password: PASSWORD, json: "true", callbackUrl: URL + "/" },
    headers: { "content-type": "application/x-www-form-urlencoded" }, maxRedirects: 0,
  });

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

  console.log(`>> ${scene.name}`);
  try {
    await scene.fn(page, ctx, pause, moveCursor, clickFb, injectCursor);
  } catch (err) {
    console.log(`  err: ${err.message.slice(0, 80)}`);
  }
  await ctx.close();
  await browser.close();

  const files = readdirSync(sceneDir).filter((f) => f.endsWith(".webm"));
  if (files.length > 0) {
    renameSync(join(sceneDir, files[0]), join(sceneDir, "out.webm"));
    console.log(`✓ ${join(sceneDir, "out.webm")}`);
  }
}

for (const scene of SCENES) {
  await recordScene(scene);
}
console.log("DONE");
