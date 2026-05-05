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
await page.goto(URL + "/updates", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.screenshot({ path: "/tmp/updates-asks.png" });
console.log("✓ asks");
await page.locator("button:has-text('Activity')").first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/updates-activity.png" });
console.log("✓ activity");
// Click first event to expand
const first = page.locator("ol > li button").first();
if (await first.isVisible().catch(() => false)) {
  await first.click();
  await page.waitForTimeout(1500);
  // Click "Raw payload" details to expand
  const raw = page.locator("summary:has-text('Raw payload')").first();
  if (await raw.isVisible().catch(() => false)) {
    await raw.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: "/tmp/updates-expanded.png" });
  console.log("✓ expanded");
}
await browser.close();
