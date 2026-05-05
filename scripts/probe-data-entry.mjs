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

const r = await ctx.request.post(URL + "/api/data/ingest", {
  headers: { "content-type": "application/json" },
  data: JSON.stringify({
    source: "note",
    label: "Smoke test 2026-05-05",
    text: "This is a probe entry confirming data entry works end-to-end. Should chunk + embed into the company corpus and be searchable.",
  }),
});
console.log("status:", r.status());
console.log("body:", await r.text());

const upload = await ctx.request.post(URL + "/api/files/upload", {
  multipart: {
    file: {
      name: "test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello world. Probe upload to /api/files/upload."),
    },
    bucket: "other",
  },
});
console.log("upload status:", upload.status());
console.log("upload body:", await upload.text());

await browser.close();
