// Login as Pedro Onboard Test, hit /api/notifications/agents, dump
// the latest Atlas msgs so Pedro can see proactive output is real.
import { chromium } from "playwright";
const URL = "http://localhost:3002";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();

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

const r = await ctx.request.get(URL + "/api/notifications/agents");
const j = await r.json();
console.log(`notifications: ${j.notifications?.length ?? 0}`);
for (const n of (j.notifications ?? []).slice(0, 5)) {
  console.log("---");
  console.log(`[${n.kind}] ${n.agent_name} (${new Date(n.created_at).toLocaleTimeString()})`);
  console.log(n.content);
}

await browser.close();
