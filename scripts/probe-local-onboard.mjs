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
    callbackUrl: URL + "/onboarding",
  },
  headers: { "content-type": "application/x-www-form-urlencoded" },
  maxRedirects: 0,
});

const cookies = await ctx.cookies();
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

const t0 = Date.now();
const res = await fetch(URL + "/api/onboarding/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({
    messages: [
      { role: "assistant", content: "Hi Pedro, ready?" },
      { role: "user", content: "yes" },
    ],
  }),
});
console.log("status:", res.status);
const reader = res.body.getReader();
const dec = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const ts = ((Date.now() - t0) / 1000).toFixed(2);
  process.stdout.write(`[+${ts}s] ${dec.decode(value, { stream: true })}`);
}
console.log(`\n--- end after ${((Date.now() - t0) / 1000).toFixed(2)}s ---`);
await browser.close();
