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
await page.goto(URL + "/connections", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.screenshot({ path: "/tmp/mcp.png", fullPage: false });
console.log("✓ /tmp/mcp.png");
await browser.close();
