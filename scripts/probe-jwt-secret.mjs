// Hit /api/connections/claude as the test user. Should return 200 with
// connected: false (no token yet). Crucially: NO crypto error in logs.
import { chromium } from "playwright";
const URL = "https://rawclaw-rose.vercel.app";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const csrfResp = await ctx.request.get(URL + "/api/auth/csrf");
const { csrfToken } = await csrfResp.json();
await ctx.request.post(URL + "/api/auth/callback/credentials", {
  form: {
    csrfToken,
    email: "pedro-onboard@rawclaw.demo",
    password: "rawclaw-onboard-2026",
    json: "true",
    callbackUrl: URL + "/",
  },
  headers: { "content-type": "application/x-www-form-urlencoded" },
  maxRedirects: 0,
});

const r = await ctx.request.get(URL + "/api/connections/claude");
console.log("status:", r.status());
console.log("body:", await r.text());

// Also probe oauth/start - this requires JWT_SECRET-derived state token
const start = await ctx.request.post(URL + "/api/connections/claude/oauth/start", {
  headers: { "content-type": "application/json" },
  data: "{}",
});
console.log("\nstart status:", start.status());
const startBody = await start.text();
console.log("start body:", startBody.slice(0, 300));

await browser.close();
