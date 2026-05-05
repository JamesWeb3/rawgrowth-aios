// Test the approve endpoint via real session.
import { chromium } from "playwright";

const URL = "http://localhost:3002";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();

const csrfResp = await ctx.request.get(`${URL}/api/auth/csrf`);
const { csrfToken } = await csrfResp.json();
const cb = await ctx.request.post(`${URL}/api/auth/callback/credentials`, {
  form: { csrfToken, email: "chris@rawclaw.demo", password: "rawclaw-demo-2026", json: "true", callbackUrl: `${URL}/` },
  headers: { "content-type": "application/x-www-form-urlencoded" },
  maxRedirects: 0,
});
console.log("auth:", cb.status());

const insightId = "167d07f7-ada9-4097-b80a-47be4c39003b";
const t0 = Date.now();
const approve = await ctx.request.post(`${URL}/api/insights/${insightId}/approve`, {
  headers: { "content-type": "application/json" },
  data: {},
  timeout: 90000,
});
const dt = Date.now() - t0;
console.log(`approve status=${approve.status()} took=${dt}ms`);
console.log("body:", (await approve.text()).slice(0, 800));

await browser.close();
