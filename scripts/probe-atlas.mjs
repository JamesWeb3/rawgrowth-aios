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
await page.goto(URL + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(10000);
const text = await page.locator("body").innerText();
const found = text.match(/Atlas[^\n]*/g);
console.log("Atlas matches:", found ? found.slice(0, 5) : "NONE");
await page.screenshot({ path: "/tmp/probe.png" });
console.log("screenshot /tmp/probe.png");
await browser.close();
