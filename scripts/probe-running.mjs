import { chromium } from "playwright";
const URL = "http://localhost:3002";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const r = await ctx.request.get(URL + "/api/auth/csrf");
const { csrfToken } = await r.json();
await ctx.request.post(URL + "/api/auth/callback/credentials", {
  form: { csrfToken, email: "chris@rawclaw.demo", password: "rawclaw-demo-2026", json: "true", callbackUrl: URL + "/" },
  headers: { "content-type": "application/x-www-form-urlencoded" }, maxRedirects: 0,
});
const page = await ctx.newPage();
// 1. /data
await page.goto(URL + "/data", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
await page.screenshot({ path: "/tmp/entry.png", fullPage: false });
console.log("✓ entry");
// 2. /updates (executing state)
await page.goto(URL + "/updates", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
await page.screenshot({ path: "/tmp/running.png", fullPage: false });
console.log("✓ running");
// 3. /updates Activity tab
await page.locator("button:has-text('Activity')").first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/running-activity.png", fullPage: false });
console.log("✓ running-activity");
await browser.close();
