import { chromium } from "playwright";
const URL = "https://rawclaw-rose.vercel.app";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") {
    errors.push(`[${m.type()}] ${m.text()}`);
  }
});
const reqs = [];
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/api/onboarding/chat")) {
    let body = "";
    try { body = await r.text(); } catch {}
    reqs.push({
      url: u,
      status: r.status(),
      body: body.slice(0, 1500),
    });
  }
});

const csrfResp = await ctx.request.get(URL + "/api/auth/csrf");
const { csrfToken } = await csrfResp.json();
await ctx.request.post(URL + "/api/auth/callback/credentials", {
  form: {
    csrfToken,
    email: "pedro-onboard@rawclaw.demo",
    password: "rawclaw-onboard-2026",
    json: "true",
    callbackUrl: URL + "/onboarding",
  },
  headers: { "content-type": "application/x-www-form-urlencoded" },
  maxRedirects: 0,
});

await page.goto(URL + "/onboarding", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const ta = page.locator("textarea").first();
await ta.waitFor({ state: "visible", timeout: 15000 });
await ta.click();
await ta.fill("yes");
// Try clicking the send button (arrow icon) instead of Enter, plus log
// streaming/disabled state right before the send.
const btnCount = await page.locator("button").count();
console.log("button count:", btnCount);
const sendBtn = page.locator("textarea + button, textarea ~ button").last();
const sendVisible = await sendBtn.isVisible().catch(() => false);
const sendDisabled = await sendBtn.isDisabled().catch(() => null);
console.log("send btn visible:", sendVisible, "disabled:", sendDisabled);
await ta.press("Enter");
await page.waitForTimeout(1000);
// fallback: click send button if Enter didn't trigger
if (reqs.length === 0 && sendVisible) {
  console.log("Enter didn't trigger, clicking send button");
  await sendBtn.click({ force: true }).catch((e) => console.log("click err:", e.message));
}
console.log("sent 'yes'");

// wait up to 30s for response
const start = Date.now();
while (Date.now() - start < 30000) {
  if (reqs.length > 0 && reqs[reqs.length - 1].status > 0) {
    await page.waitForTimeout(3000);
    break;
  }
  await page.waitForTimeout(500);
}

console.log("\n=== /api/onboarding/chat responses ===");
for (const r of reqs) {
  console.log(`[${r.status}] ${r.url}`);
  console.log(r.body);
  console.log("---");
}
console.log("\n=== console errors/warnings ===");
for (const e of errors) console.log(e);

await page.screenshot({ path: "/tmp/onboard-debug.png", fullPage: true });
console.log("\nscreenshot /tmp/onboard-debug.png");
await browser.close();
