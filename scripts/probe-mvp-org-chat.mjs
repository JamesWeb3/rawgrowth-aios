// Hit the prod /api/onboarding/chat as the Rawgrowth MVP admin.
// If THIS works, 429 was the test org's stale token, not Pedro's pool.
const URL = "https://rawclaw-rose.vercel.app";
const COOKIE = new Map();
function setCk(h){if(!h)return;const lines=Array.isArray(h)?h:[h];for(const c of lines){const m=c.match(/^([^=;]+)=([^;]*)/);if(m)COOKIE.set(m[1].trim(),m[2].trim())}}
function ck(){return Array.from(COOKIE.entries()).map(([k,v])=>`${k}=${v}`).join("; ")}

const csrf = await (await fetch(URL+"/api/auth/csrf")).json();
const auth = await fetch(URL+"/api/auth/callback/credentials",{
  method:"POST",
  headers:{"content-type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({csrfToken:csrf.csrfToken,email:"chris@rawclaw.demo",password:"rawclaw-demo-2026",json:"true",callbackUrl:URL+"/"}).toString(),
  redirect:"manual",
});
console.log("auth status:", auth.status);
setCk(auth.headers.getSetCookie?.()??auth.headers.get("set-cookie"));
console.log("cookies:", COOKIE.size);
console.log("cookie names:", Array.from(COOKIE.keys()).join(", "));
console.log("set-cookie raw:", JSON.stringify(auth.headers.getSetCookie?.() ?? []).slice(0, 500));

const me = await fetch(URL+"/api/me",{headers:{cookie:ck()}});
const meBody = await me.text();
console.log("me:", me.status, meBody.slice(0,200));

const r = await fetch(URL+"/api/onboarding/chat",{
  method:"POST",
  headers:{"content-type":"application/json",cookie:ck()},
  body:JSON.stringify({messages:[{role:"user",content:"yes"}]}),
});
console.log("\n--- onboarding chat ---");
console.log("status:", r.status);
const reader = r.body.getReader();
const dec = new TextDecoder();
let total = "";
const t0 = Date.now();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = dec.decode(value, { stream: true });
  total += chunk;
  process.stdout.write(`[+${((Date.now()-t0)/1000).toFixed(1)}s] ${chunk}`);
}
console.log("\n--- end after", ((Date.now()-t0)/1000).toFixed(1), "s,", total.length, "bytes ---");
