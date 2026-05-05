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

await page.goto(`${URL}/files`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const title = await page.title();
const heading = await page.locator("h2").first().textContent().catch(() => null);
const buckets = await page.locator("aside button").allTextContents().catch(() => []);
const drop = await page.locator("text=/Drop files into/i").first().isVisible().catch(() => false);

await page.screenshot({ path: "/tmp/files-page.png", fullPage: false });
console.log(JSON.stringify({ title, heading, buckets, drop, screenshot: "/tmp/files-page.png" }, null, 2));

await browser.close();
