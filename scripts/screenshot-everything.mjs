// Capture screenshots of all the new pages so Pedro can verify
// the build matches what he asked for.

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

const targets = [
  { url: "/", name: "dashboard" },
  { url: "/company/autonomous", name: "autonomous-settings" },
  { url: "/data", name: "data-entry" },
  { url: "/chat", name: "chat-atlas" },
];

for (const t of targets) {
  console.log(`>> ${t.name}`);
  try {
    await page.goto(`${URL}${t.url}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `/tmp/shot-${t.name}.png`, fullPage: false });
    console.log(`✓ /tmp/shot-${t.name}.png`);
  } catch (err) {
    console.log(`✗ ${t.name}: ${err.message}`);
  }
}

await browser.close();
