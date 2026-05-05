// Prod end-to-end smoke test: log in, open Atlas chat, send msg, wait for reply.
import { chromium } from "playwright";

const URL = "https://rawclaw-rose.vercel.app";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Auth via NextAuth credentials (off-screen)
const csrfResp = await ctx.request.get(URL + "/api/auth/csrf");
const { csrfToken } = await csrfResp.json();
const cb = await ctx.request.post(URL + "/api/auth/callback/credentials", {
  form: {
    csrfToken,
    email: "chris@rawclaw.demo",
    password: "rawclaw-demo-2026",
    json: "true",
    callbackUrl: URL + "/",
  },
  headers: { "content-type": "application/x-www-form-urlencoded" },
  maxRedirects: 0,
});
console.log("auth status:", cb.status());

await page.goto(URL + "/chat", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

console.log("on /chat. Atlas should be selected by default.");

// Type a message and send
const ta = page.locator("textarea").first();
await ta.waitFor({ state: "visible", timeout: 15000 });
await ta.click();
await ta.fill("What's marketing working on this week? Quick summary, 2 bullets.");
await page.waitForTimeout(800);

// Press Enter to send
await ta.press("Enter");
console.log("sent message, waiting for reply...");

// Wait for assistant bubble to grow with content
const start = Date.now();
let lastLen = 0;
let stableCount = 0;
const maxWait = 60000;
while (Date.now() - start < maxWait) {
  const text = await page.locator('[data-role="assistant"]').last().innerText().catch(() => "");
  if (text.length > lastLen) {
    lastLen = text.length;
    stableCount = 0;
  } else if (text.length > 0) {
    stableCount++;
    if (stableCount >= 6) break; // stable 3+ seconds = stream done
  }
  await page.waitForTimeout(500);
}

const reply = await page.locator('[data-role="assistant"]').last().innerText().catch(() => "");
console.log(`reply length: ${reply.length}`);
console.log(`reply head:\n${reply.slice(0, 400)}\n---`);
await page.screenshot({ path: "/tmp/prod-chat.png", fullPage: false });
console.log("screenshot /tmp/prod-chat.png");
await browser.close();
