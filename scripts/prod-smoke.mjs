const URL = "https://rawclaw-rose.vercel.app";
const r = await fetch(URL + "/api/auth/csrf");
const { csrfToken } = await r.json();
const cookieFromCsrf = r.headers.get("set-cookie") ?? "";
const cb = await fetch(URL + "/api/auth/callback/credentials", {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    cookie: cookieFromCsrf.split(";")[0],
  },
  body: new URLSearchParams({
    csrfToken, email: "chris@rawclaw.demo", password: "rawclaw-demo-2026",
    json: "true", callbackUrl: URL + "/",
  }).toString(),
  redirect: "manual",
});
console.log("auth status:", cb.status);
const sessionCookie = (cb.headers.getSetCookie?.() ?? []).join("; ") || cb.headers.get("set-cookie") || "";
console.log("got session cookie:", sessionCookie.length > 0);

const insightR = await fetch(URL + "/api/insights", {
  headers: { cookie: sessionCookie + "; " + cookieFromCsrf.split(";")[0] },
});
console.log("insights status:", insightR.status);
const j = await insightR.json().catch(() => ({}));
console.log("insights count:", (j.insights ?? []).length);

const activityR = await fetch(URL + "/api/activity?limit=10", {
  headers: { cookie: sessionCookie + "; " + cookieFromCsrf.split(";")[0] },
});
console.log("activity status:", activityR.status);
const a = await activityR.json().catch(() => ({}));
console.log("recent events:", (a.events ?? []).length);
