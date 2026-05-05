// Probe POST /api/insights/[id]/open-chat against local + check
// notification flow.
import { chromium } from "playwright";

const URL = process.argv[2] || "http://localhost:3002";
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

// Pull current insights list
const list = await ctx.request.get(URL + "/api/insights");
const j = await list.json();
console.log(`insights returned: ${j.insights?.length ?? 0}`);
const sample = j.insights?.[0];
if (!sample) {
  console.log("no insights to test");
  await browser.close();
  process.exit(0);
}
console.log("first insight:", {
  id: sample.id,
  title: sample.title,
  chat_state: sample.chat_state,
});

// Hit /api/notifications/agents to see if backfill landed
const notif = await ctx.request.get(URL + "/api/notifications/agents");
const nj = await notif.json();
console.log(`notifications: ${nj.notifications?.length ?? 0}`);
if (nj.notifications?.[0]) {
  console.log("first notification:", {
    agent_name: nj.notifications[0].agent_name,
    kind: nj.notifications[0].kind,
    content: nj.notifications[0].content.slice(0, 100),
  });
}

// Try open-chat on first insight
const oc = await ctx.request.post(
  URL + `/api/insights/${sample.id}/open-chat`,
);
console.log(`open-chat status: ${oc.status()}`);
console.log("open-chat body:", await oc.json());

await browser.close();
