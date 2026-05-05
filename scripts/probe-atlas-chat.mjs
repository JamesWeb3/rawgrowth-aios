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
page.on("console", m => console.log("[browser]", m.type(), m.text().slice(0, 200)));
page.on("pageerror", e => console.log("[pageerror]", e.message.slice(0, 300)));
await page.goto(URL + "/chat", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
const text = await page.locator("body").innerText();
const errors = text.match(/(Error|error|failed|Failed|404|500)[^\n]*/g);
console.log("Page errors found:", errors?.slice(0, 10));
await page.screenshot({ path: "/tmp/atlas-chat.png" });
console.log("✓ /tmp/atlas-chat.png");
await browser.close();
