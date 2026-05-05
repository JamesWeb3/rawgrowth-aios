import { chromium } from "playwright";

const URL = "http://localhost:3002";
const EMAIL = "chris@rawclaw.demo";
const PASSWORD = "rawclaw-demo-2026";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const csrfResp = await ctx.request.get(`${URL}/api/auth/csrf`);
const { csrfToken } = await csrfResp.json();
await ctx.request.post(`${URL}/api/auth/callback/credentials`, {
  form: { csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${URL}/`, json: "true" },
  headers: { "content-type": "application/x-www-form-urlencoded" },
  maxRedirects: 0,
});

// Dashboard top
await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await page.screenshot({ path: "/tmp/dashboard.png", fullPage: false });
console.log("✓ /tmp/dashboard.png");

// Scroll to insight card with new approve/reject buttons
await page.evaluate(() => {
  const el = document.querySelector("#insights");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
});
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/dashboard-insight-actions.png", fullPage: false });
console.log("✓ /tmp/dashboard-insight-actions.png");

// Scroll to marketing pillar to capture sparkline
await page.evaluate(() => window.scrollTo({ top: 1000, behavior: "smooth" }));
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/dashboard-marketing.png", fullPage: false });
console.log("✓ /tmp/dashboard-marketing.png");

// Chat with slash open
await page.goto(`${URL}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const ta = page.locator('textarea').first();
await ta.waitFor({ state: "visible", timeout: 10000 });
await ta.click();
await ta.type("/", { delay: 100 });
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/chat-slash.png", fullPage: false });
console.log("✓ /tmp/chat-slash.png");

await browser.close();
