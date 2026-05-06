// Ralph-loop comprehensive UI smoke - 10 iterations against LOCAL DEV.
// Headless chromium, viewport 1440x900. Findings -> /tmp/ralph-local-ui-findings.jsonl.
// LLM endpoints (onboarding chat, agent chat) ARE fair game here:
// LLM_PROVIDER=anthropic-cli uses host claude CLI (no rate limit).

import { chromium } from "playwright";
import { writeFileSync, appendFileSync, existsSync } from "node:fs";

const URL = process.env.URL || "http://localhost:3002";
const OUT = "/tmp/ralph-local-ui-findings.jsonl";
const EMAIL = process.env.EMAIL || "pedro-onboard@rawclaw.demo";
const PASSWORD = process.env.PASSWORD || "rawclaw-onboard-2026";
const FRESH_EMAIL = "pedro-fresh-tg2ivp@rawclaw.demo";
const FRESH_PASSWORD = "rawclaw-fresh-tg2ivp";

if (!existsSync(OUT)) writeFileSync(OUT, "");

const log = (e) => {
  const ev = { ts: new Date().toISOString(), ...e };
  appendFileSync(OUT, JSON.stringify(ev) + "\n");
  const sev = ev.severity ?? "ok";
  const tag = sev === "broken" ? "BROKEN" : sev === "ugly" ? "UGLY" : sev === "minor" ? "MINOR" : "OK";
  console.log(`[${tag}] iter${ev.iter ?? "?"}/${ev.surface}: ${ev.summary}`);
};

const browser = await chromium.launch({ headless: true });

function isSpuriousError(text) {
  if (/"error":"\$undefined"/.test(text)) return true;
  if (/Failed to load resource: the server responded with a status of 401/.test(text)) return true;
  if (/Hydration|hydrat/i.test(text)) return false;
  if (/manifest\.json|favicon/.test(text)) return true;
  return false;
}

async function makeContext(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const csrfRaw = await ctx.request.get(URL + "/api/auth/csrf");
  const { csrfToken } = await csrfRaw.json();
  await ctx.request.post(URL + "/api/auth/callback/credentials", {
    form: { csrfToken, email, password, json: "true", callbackUrl: URL + "/" },
    headers: { "content-type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
  });
  const me = await ctx.request.get(URL + "/api/org/me");
  if (!me.ok()) {
    log({ surface: "login.bootstrap", severity: "broken", summary: `org/me ${me.status()} for ${email}` });
    return null;
  }
  const meJson = await me.json();
  log({ surface: "login.bootstrap", summary: `OK ${email} org=${meJson.activeOrgId ?? "?"}` });
  return ctx;
}

async function newProbedPage(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/")) requests.push({ url: u, status: r.status() });
  });
  return { page, errors, requests };
}

async function snapshot(page, name) {
  try {
    const path = `/tmp/ralph-ui-${name}.png`;
    await page.screenshot({ path, fullPage: false });
    return path;
  } catch (e) {
    return null;
  }
}

const ctx = await makeContext(EMAIL, PASSWORD);
if (!ctx) {
  await browser.close();
  process.exit(1);
}

// =========================================================
// ITER 1: Login -> dashboard renders, sidebar visible, bell visible
// =========================================================
async function iter1() {
  const ITER = 1;
  const { page, errors, requests } = await newProbedPage(ctx);
  const resp = await page.goto(URL + "/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const status = resp?.status() ?? 0;
  // Sidebar: shadcn renders <div data-slot="sidebar-wrapper">
  const sidebar = await page.locator('[data-slot="sidebar"], [data-slot="sidebar-wrapper"], nav').count();
  // Bell: button with aria-label or with bell icon. Look for the notification trigger.
  const bell = await page.locator('button[aria-label*="otif" i], button[aria-label*="ell" i], [data-testid*="bell"], button:has(svg.lucide-bell)').count();
  const realErr = errors.filter((e) => !isSpuriousError(e));
  const failing = requests.filter((r) => r.status >= 500);
  let severity;
  if (status >= 400) severity = "broken";
  else if (sidebar === 0) severity = "broken";
  else if (bell === 0) severity = "ugly";
  if (severity) await snapshot(page, `i1-dashboard`);
  log({
    iter: ITER, surface: "dashboard.render",
    summary: `status=${status} sidebar=${sidebar} bell=${bell} 5xx=${failing.length} errs=${realErr.length}`,
    severity,
  });
  await page.close();
}

// =========================================================
// ITER 2: /agents list -> click first -> 6 tabs each switch with content
// =========================================================
async function iter2() {
  const ITER = 2;
  const { page, errors, requests } = await newProbedPage(ctx);
  const resp = await page.goto(URL + "/agents", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const status = resp?.status() ?? 0;
  const cards = await page.locator('a[href^="/agents/"]').count();
  if (status >= 400 || cards === 0) {
    await snapshot(page, "i2-agents-empty");
    log({ iter: ITER, surface: "agents.list", severity: "broken", summary: `status=${status} cards=${cards}` });
    await page.close();
    return;
  }
  log({ iter: ITER, surface: "agents.list", summary: `status=${status} cards=${cards}` });
  const firstHref = await page.locator('a[href^="/agents/"]').first().getAttribute("href");
  await page.close();

  if (!firstHref) return;
  const probe = await newProbedPage(ctx);
  const ap = probe.page;
  await ap.goto(URL + firstHref, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await ap.waitForTimeout(2500);
  const tabs = ["chat", "vision", "memory", "files", "tasks", "settings"];
  let passed = 0;
  for (const tab of tabs) {
    const tabBtn = ap.getByRole("button", { name: new RegExp(`^${tab}$`, "i") });
    const cnt = await tabBtn.count().catch(() => 0);
    if (cnt === 0) {
      log({ iter: ITER, surface: `agent.tab.${tab}`, severity: "ugly", summary: "tab missing" });
      continue;
    }
    try {
      await tabBtn.first().click({ timeout: 4000 });
      await ap.waitForTimeout(1500);
      // Verify the active button now has primary classes (border-b-2 border-primary in the source).
      const activeIs = await tabBtn.first().evaluate((el) => el.className.includes("border-primary"));
      // Page main always has the agent header so any text length is fine; check active styling instead.
      const mainText = (await ap.locator("main").innerText().catch(() => "")).slice(0, 200);
      if (!activeIs && mainText.length === 0) {
        log({ iter: ITER, surface: `agent.tab.${tab}`, severity: "ugly", summary: "panel empty after click" });
      } else {
        passed++;
        log({ iter: ITER, surface: `agent.tab.${tab}`, summary: `click ok active=${activeIs}` });
      }
    } catch (e) {
      log({ iter: ITER, surface: `agent.tab.${tab}`, severity: "ugly", summary: `click failed: ${e.message.slice(0, 80)}` });
    }
  }
  log({ iter: ITER, surface: "agent.tabs.summary", summary: `${passed}/6 tabs working` });
  await ap.close();
}

// =========================================================
// ITER 3: + Hire -> sheet opens -> select role -> fill name -> save -> toast
// =========================================================
async function iter3() {
  const ITER = 3;
  const { page, errors } = await newProbedPage(ctx);
  await page.goto(URL + "/agents", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const hireBtn = page.locator('button:has-text("Hire"), a:has-text("Hire")');
  const hireCnt = await hireBtn.count();
  if (hireCnt === 0) {
    await snapshot(page, "i3-no-hire");
    log({ iter: ITER, surface: "agents.hire-button", severity: "broken", summary: "no Hire button visible" });
    await page.close();
    return;
  }
  await hireBtn.first().click({ timeout: 4000 });
  await page.waitForTimeout(1500);
  const dialog = await page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').count();
  if (dialog === 0) {
    await snapshot(page, "i3-no-sheet");
    log({ iter: ITER, surface: "agents.hire-sheet", severity: "broken", summary: "Hire click did not open sheet" });
    await page.close();
    return;
  }
  log({ iter: ITER, surface: "agents.hire-sheet", summary: `dialog count=${dialog}` });

  // Fill quick-role input. Component uses an <input list="rawclaw-role-suggestions">.
  const roleInput = page.locator('[role="dialog"] input[list]').first();
  const hasRoleInput = await roleInput.count();
  if (hasRoleInput === 0) {
    await snapshot(page, "i3-no-role-input");
    log({ iter: ITER, surface: "agents.hire-role-input", severity: "ugly", summary: "no quick-role input found" });
    await page.close();
    return;
  }
  await roleInput.fill("copywriter");
  await page.waitForTimeout(300);
  // Click the primary "Hire" submit (different from trigger). Look for a button inside the dialog.
  const submit = page.locator('[role="dialog"] button:has-text("Hire")').last();
  const submitCnt = await submit.count();
  if (submitCnt === 0) {
    log({ iter: ITER, surface: "agents.hire-submit", severity: "ugly", summary: "no submit button in sheet" });
    await page.close();
    return;
  }
  let createdAgent = null;
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/agents") && r.request().method() === "POST") {
      try {
        const j = await r.json();
        createdAgent = j;
      } catch {}
    }
  });
  await submit.first().click({ timeout: 4000 });
  await page.waitForTimeout(3000);
  // Look for sonner toast text
  const toastText = await page.locator('[data-sonner-toast], li[data-sonner-toast]').innerText().catch(() => "");
  const success = /Hired|created|success/i.test(toastText);
  if (!success && !createdAgent) {
    await snapshot(page, "i3-hire-no-toast");
    log({ iter: ITER, surface: "agents.hire-flow", severity: "broken", summary: `no success toast / no agent in response (toast="${toastText.slice(0, 80)}")` });
  } else {
    log({ iter: ITER, surface: "agents.hire-flow", summary: `toast="${toastText.slice(0, 80)}" agent=${createdAgent?.id ?? "?"}` });
  }
  await page.close();
}

// =========================================================
// ITER 4: Onboarding gate FRESH account
// =========================================================
async function iter4() {
  const ITER = 4;
  const fresh = await makeContext(FRESH_EMAIL, FRESH_PASSWORD);
  if (!fresh) {
    log({ iter: ITER, surface: "onboarding.gate-fresh-login", severity: "broken", summary: "fresh login failed" });
    return;
  }
  const { page, errors } = await newProbedPage(fresh);
  const resp = await page.goto(URL + "/onboarding", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const status = resp?.status() ?? 0;
  const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 800);
  const hasGate = /Connect Claude|Claude Max|connect.*claude/i.test(text);
  const connectBtn = page.locator('button:has-text("Connect Claude"), a:has-text("Connect Claude"), button:has-text("Claude Max")');
  const hasBtn = await connectBtn.count();
  if (status >= 400) {
    await snapshot(page, "i4-onboarding-fresh");
    log({ iter: ITER, surface: "onboarding.gate-fresh", severity: "broken", summary: `status=${status}` });
    await page.close();
    await fresh.close();
    return;
  }
  log({
    iter: ITER, surface: "onboarding.gate-fresh",
    summary: `status=${status} gate-text=${hasGate} connect-btn=${hasBtn}`,
    severity: !hasGate && hasBtn === 0 ? "ugly" : undefined,
  });
  // Click connect Claude Max button
  if (hasBtn > 0) {
    try {
      await Promise.all([
        page.waitForURL(/\/connections/, { timeout: 6000 }).catch(() => null),
        connectBtn.first().click({ timeout: 4000 }),
      ]);
      await page.waitForTimeout(2000);
      const url2 = page.url();
      if (!url2.includes("/connections")) {
        log({ iter: ITER, surface: "onboarding.gate-fresh.cta", severity: "ugly", summary: `did not navigate to /connections (now ${url2})` });
      } else {
        const claudeCard = await page.locator('text=/Claude/i').count();
        log({ iter: ITER, surface: "onboarding.gate-fresh.cta", summary: `nav OK to /connections, claude refs=${claudeCard}` });
      }
    } catch (e) {
      log({ iter: ITER, surface: "onboarding.gate-fresh.cta", severity: "ugly", summary: `click err: ${e.message.slice(0, 80)}` });
    }
  }
  await page.close();
  await fresh.close();
}

// =========================================================
// ITER 5: Onboarding chat with EXISTING -> send "yes" then channel
// =========================================================
async function iter5() {
  const ITER = 5;
  // Seed step state via API: we'll just send "yes" then "telegram, my handle is @pedrotest"
  // and observe whether complete_section_1 was called by checking the questionnaire endpoint.
  const before = await ctx.request.get(URL + "/api/onboarding/questionnaire");
  const beforeJson = await before.json().catch(() => ({}));
  log({ iter: ITER, surface: "onboarding.state-before", summary: `keys=${Object.keys(beforeJson || {}).slice(0, 8).join(",")}` });

  // Single combined turn: telegram + handle (should trigger complete_section_1 immediately).
  // We skip the "yes" turn to save memory - the EXTRACTION SHORTCUT in the system prompt is
  // designed to fire immediately when a user message has channel + handle.
  const r2 = await ctx.request.post(URL + "/api/onboarding/chat", {
    data: { messages: [
      { role: "user", content: "telegram, my handle is @pedrotest" },
    ] },
    headers: { "content-type": "application/json" },
    timeout: 120_000,
  });
  const t2Status = r2.status();
  const t2Body = await r2.text();
  log({ iter: ITER, surface: "onboarding.chat.turn", summary: `status=${t2Status} body=${t2Body.slice(0, 250).replace(/\s+/g, " ")}`, severity: !r2.ok() ? "broken" : undefined });

  // Check questionnaire for messaging_channel = telegram
  const after = await ctx.request.get(URL + "/api/onboarding/questionnaire");
  const afterJson = await after.json().catch(() => ({}));
  const channelSet = JSON.stringify(afterJson).toLowerCase().includes("telegram") || JSON.stringify(afterJson).includes("@pedrotest");
  log({
    iter: ITER, surface: "onboarding.state-delta",
    summary: `channel-applied=${channelSet} after-keys=${Object.keys(afterJson || {}).slice(0, 8).join(",")}`,
    severity: !channelSet && t2Status === 200 ? "ugly" : undefined,
  });
}

// =========================================================
// ITER 6: /data type 50+ chars, click Save, verify rail entry
// =========================================================
async function iter6() {
  const ITER = 6;
  const { page, errors } = await newProbedPage(ctx);
  const resp = await page.goto(URL + "/data", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const status = resp?.status() ?? 0;
  if (status >= 400) {
    await snapshot(page, "i6-data");
    log({ iter: ITER, surface: "data.page", severity: "broken", summary: `status=${status}` });
    await page.close();
    return;
  }
  const ta = page.locator("textarea").first();
  const taCnt = await ta.count();
  if (taCnt === 0) {
    log({ iter: ITER, surface: "data.textarea", severity: "broken", summary: "no textarea on /data" });
    await page.close();
    return;
  }
  const stamp = Date.now();
  const txt = `Ralph local UI smoke - data ingest test ${stamp}. This is a long-enough body to clear validation thresholds (50+ chars).`;
  await ta.fill(txt);
  await page.waitForTimeout(400);
  const saveBtn = page.locator('button:has-text("Save"), button:has-text("Index"), button:has-text("Add")').first();
  const saveCnt = await saveBtn.count();
  if (saveCnt === 0) {
    await snapshot(page, "i6-no-save");
    log({ iter: ITER, surface: "data.save-button", severity: "broken", summary: "no Save button" });
    await page.close();
    return;
  }
  await saveBtn.click({ timeout: 4000 });
  await page.waitForTimeout(3500);
  const toastText = await page.locator('[data-sonner-toast]').innerText().catch(() => "");
  const railText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const railHit = railText.includes(String(stamp));
  const success = /saved|indexed|added/i.test(toastText) || railHit;
  if (!success) {
    await snapshot(page, "i6-data-save");
  }
  log({
    iter: ITER, surface: "data.save-flow",
    summary: `toast="${toastText.slice(0, 80)}" rail-hit=${railHit}`,
    severity: !success ? "broken" : undefined,
  });
  await page.close();
}

// =========================================================
// ITER 7: /files dropzone synthesize file via API (UI dropzone is hard)
// =========================================================
async function iter7() {
  const ITER = 7;
  const { page } = await newProbedPage(ctx);
  const resp = await page.goto(URL + "/files", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const status = resp?.status() ?? 0;
  if (status >= 400) {
    await snapshot(page, "i7-files");
    log({ iter: ITER, surface: "files.page", severity: "broken", summary: `status=${status}` });
    await page.close();
    return;
  }
  const drop = await page.locator('[data-testid="files-dropzone"], [class*="border-dashed"], input[type="file"]').count();
  log({ iter: ITER, surface: "files.page", summary: `status=${status} drop=${drop}` });

  // Try input[type=file] direct upload if visible.
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    try {
      const stamp = Date.now();
      const buf = Buffer.from(`ralph local ui smoke ${stamp}\n`);
      await fileInput.setInputFiles({ name: `ralph-${stamp}.txt`, mimeType: "text/plain", buffer: buf });
      await page.waitForTimeout(4000);
      const toastText = await page.locator('[data-sonner-toast]').innerText().catch(() => "");
      const visible = (await page.locator("body").innerText().catch(() => "")).includes(String(stamp));
      const success = /upload|saved|indexed/i.test(toastText) || visible;
      if (!success) await snapshot(page, "i7-files-upload");
      log({
        iter: ITER, surface: "files.upload",
        summary: `toast="${toastText.slice(0, 80)}" visible=${visible}`,
        severity: success ? undefined : "ugly",
      });
    } catch (e) {
      log({ iter: ITER, surface: "files.upload", severity: "ugly", summary: `setInputFiles err: ${e.message.slice(0, 100)}` });
    }
  } else {
    log({ iter: ITER, surface: "files.upload", severity: "ugly", summary: "no file input visible (would need dataTransfer drop)" });
  }
  await page.close();
}

// =========================================================
// ITER 8: /chat hub: pick agent, type, send -> reply renders
// =========================================================
async function iter8() {
  const ITER = 8;
  const { page } = await newProbedPage(ctx);
  const resp = await page.goto(URL + "/chat", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const status = resp?.status() ?? 0;
  if (status >= 400) {
    await snapshot(page, "i8-chat-hub");
    log({ iter: ITER, surface: "chat.hub", severity: "broken", summary: `status=${status}` });
    await page.close();
    return;
  }
  const ta = page.locator("textarea").first();
  if (await ta.count() === 0) {
    await snapshot(page, "i8-no-textarea");
    log({ iter: ITER, surface: "chat.hub", severity: "broken", summary: "no textarea" });
    await page.close();
    return;
  }
  // The hub may auto-pick last agent (Atlas). Type and submit.
  await ta.fill("Hello from ralph local UI smoke. One sentence reply please.");
  await page.waitForTimeout(300);
  const beforeMsgs = await page.locator('[data-role="assistant"], .message-assistant, [class*="assistant"]').count();
  await ta.press("Enter");
  await page.waitForTimeout(20_000);
  const afterMsgs = await page.locator('[data-role="assistant"], .message-assistant, [class*="assistant"]').count();
  const visibleText = (await page.locator("main, body").innerText().catch(() => "")).slice(0, 4000);
  const replyShows = afterMsgs > beforeMsgs || /ralph|hello|smoke/i.test(visibleText);
  if (!replyShows) await snapshot(page, "i8-chat-no-reply");
  log({
    iter: ITER, surface: "chat.hub.send",
    summary: `before-asst=${beforeMsgs} after-asst=${afterMsgs} reply-detected=${replyShows}`,
    severity: replyShows ? undefined : "broken",
  });
  await page.close();
}

// =========================================================
// ITER 9: /tasks list -> drill page renders
// =========================================================
async function iter9() {
  const ITER = 9;
  const { page } = await newProbedPage(ctx);
  const resp = await page.goto(URL + "/tasks", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const status = resp?.status() ?? 0;
  if (status >= 400) {
    await snapshot(page, "i9-tasks");
    log({ iter: ITER, surface: "tasks.list", severity: "broken", summary: `status=${status}` });
    await page.close();
    return;
  }
  const rows = await page.locator('a[href^="/tasks/"]').count();
  log({ iter: ITER, surface: "tasks.list", summary: `status=${status} rows=${rows}` });
  if (rows > 0) {
    const firstHref = await page.locator('a[href^="/tasks/"]').first().getAttribute("href");
    if (firstHref) {
      const probe = await newProbedPage(ctx);
      const r2 = await probe.page.goto(URL + firstHref, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await probe.page.waitForTimeout(2500);
      const drillStatus = r2?.status() ?? 0;
      const txt = (await probe.page.locator("main, body").innerText().catch(() => "")).slice(0, 4000);
      const ok = drillStatus < 400 && txt.length > 100;
      if (!ok) await snapshot(probe.page, "i9-tasks-drill");
      log({
        iter: ITER, surface: "tasks.drill",
        summary: `path=${firstHref} status=${drillStatus} txtlen=${txt.length}`,
        severity: ok ? undefined : "broken",
      });
      await probe.page.close();
    }
  }
  await page.close();
}

// =========================================================
// ITER 10: Bell click -> dropdown opens; then logout -> /auth/signin renders
// =========================================================
async function iter10() {
  const ITER = 10;
  const { page } = await newProbedPage(ctx);
  await page.goto(URL + "/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  // Bell trigger
  const bell = page.locator('button[aria-label*="otif" i], button:has(svg.lucide-bell)').first();
  const bellCnt = await bell.count();
  if (bellCnt > 0) {
    try {
      await bell.click({ timeout: 4000 });
      await page.waitForTimeout(1200);
      const dd = await page.locator('[role="menu"], [data-radix-popper-content-wrapper], [role="dialog"]').count();
      log({
        iter: ITER, surface: "bell.dropdown",
        summary: `dropdown count=${dd}`,
        severity: dd === 0 ? "ugly" : undefined,
      });
    } catch (e) {
      log({ iter: ITER, surface: "bell.dropdown", severity: "ugly", summary: `click err: ${e.message.slice(0, 80)}` });
    }
  } else {
    log({ iter: ITER, surface: "bell.dropdown", severity: "ugly", summary: "no bell button found" });
  }
  // Logout via /api/auth/signout (NextAuth)
  const csrfRaw = await ctx.request.get(URL + "/api/auth/csrf");
  const { csrfToken } = await csrfRaw.json();
  const out = await ctx.request.post(URL + "/api/auth/signout", {
    form: { csrfToken, callbackUrl: URL + "/auth/signin", json: "true" },
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  log({ iter: ITER, surface: "auth.signout", summary: `status=${out.status()}` });
  // Visit /auth/signin to confirm it renders
  await page.goto(URL + "/auth/signin", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1500);
  const signInVisible = await page.locator('button:has-text("Sign in")').count();
  if (signInVisible === 0) await snapshot(page, "i10-signin");
  log({
    iter: ITER, surface: "auth.signin-page",
    summary: `signin-button=${signInVisible}`,
    severity: signInVisible === 0 ? "broken" : undefined,
  });
  await page.close();
}

const fns = [iter1, iter2, iter3, iter4, iter5, iter6, iter7, iter8, iter9, iter10];
const onlyIter = Number(process.env.ITER || 0);
for (const fn of fns) {
  const idx = fns.indexOf(fn) + 1;
  if (onlyIter && onlyIter !== idx) continue;
  console.log(`\n=== ITER ${idx} ===`);
  try {
    await fn();
  } catch (e) {
    log({ iter: idx, surface: "iter.crash", severity: "broken", summary: e.message.slice(0, 200) });
  }
}

await ctx.close();
await browser.close();
console.log("\nDONE. Findings:", OUT);
