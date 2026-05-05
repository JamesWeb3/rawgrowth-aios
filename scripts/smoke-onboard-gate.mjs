// Smoke: log in as the test onboarding account, hit /onboarding, confirm
// the hard gate is rendered (no chat, "Sign in with Claude Max" CTA).
import { chromium } from "playwright";

const URL = "https://rawclaw-rose.vercel.app";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const csrfResp = await ctx.request.get(URL + "/api/auth/csrf");
const { csrfToken } = await csrfResp.json();
const cb = await ctx.request.post(URL + "/api/auth/callback/credentials", {
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
console.log("auth status:", cb.status());

await page.goto(URL + "/onboarding", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const text = await page.locator("body").innerText();
const hasGate = text.includes("Sign in with Claude Max");
const hasChat = text.includes("Let's get to know your business") && text.match(/\bbrand\b|\bintake\b/i);
console.log("gate visible:", hasGate);
console.log("chat visible (should be false):", !!hasChat);
console.log("---");
console.log(text.split("\n").slice(0, 30).join("\n"));

await page.screenshot({ path: "/tmp/onboard-gate.png", fullPage: false });
console.log("screenshot /tmp/onboard-gate.png");
await browser.close();
process.exit(hasGate && !hasChat ? 0 : 1);
