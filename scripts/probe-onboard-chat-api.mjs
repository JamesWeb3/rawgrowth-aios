// Direct fetch /api/onboarding/chat with auth cookie. Read NDJSON
// stream and dump every event so we see what claude-max-oauth returns.
import { chromium } from "playwright";
const URL = "https://rawclaw-rose.vercel.app";
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

const res = await fetch(URL + "/api/onboarding/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
  },
  body: JSON.stringify({
    messages: [
      {
        role: "assistant",
        content:
          "Hi Pedro, welcome to the Rawgrowth Onboarding. We're going to ask you a series of questions to understand exactly how we can support your business. Ready to get started?",
      },
      { role: "user", content: "yes" },
    ],
  }),
});

console.log("status:", res.status);
console.log("content-type:", res.headers.get("content-type"));

const reader = res.body.getReader();
const decoder = new TextDecoder();
let total = "";
const t0 = Date.now();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value, { stream: true });
  total += chunk;
  const ts = ((Date.now() - t0) / 1000).toFixed(2);
  process.stdout.write(`[+${ts}s] ${chunk}`);
}
console.log(`\n--- end of stream after ${((Date.now() - t0) / 1000).toFixed(2)}s ---`);
console.log("total bytes:", total.length);
await browser.close();
