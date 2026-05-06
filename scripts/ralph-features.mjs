// Ralph-loop comprehensive feature smoke - 12 iterations against PROD.
// Avoids LLM endpoints in tight loops. One poke per LLM endpoint max.
// Findings -> /tmp/ralph-features-findings.jsonl (one event per line).

import { chromium } from "playwright";
import { writeFileSync, appendFileSync, existsSync } from "node:fs";

const URL = process.env.URL || "https://rawclaw-rose.vercel.app";
const OUT = "/tmp/ralph-features-findings.jsonl";
const EMAIL = "pedro-onboard@rawclaw.demo";
const PASSWORD = "rawclaw-onboard-2026";
const ITER = Number(process.env.ITER || 0); // 0 = all 12

if (!existsSync(OUT)) writeFileSync(OUT, "");

const log = (e) => {
  const ev = { ts: new Date().toISOString(), ...e };
  appendFileSync(OUT, JSON.stringify(ev) + "\n");
  const sev = ev.severity ?? "ok";
  const tag = sev === "broken" ? "BROKEN" : sev === "ugly" ? "UGLY" : sev === "minor" ? "MINOR" : "OK";
  console.log(`[${tag}] iter${ev.iter ?? "?"}/${ev.surface}: ${ev.summary}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });

// ---- Login (cookie jar shared with playwright APIRequest) ----
async function login() {
  const csrfRaw = await ctx.request.get(URL + "/api/auth/csrf");
  const { csrfToken } = await csrfRaw.json();
  const r = await ctx.request.post(URL + "/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      json: "true",
      callbackUrl: URL + "/",
    },
    headers: { "content-type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
  });
  // session check
  const me = await ctx.request.get(URL + "/api/org/me");
  if (!me.ok()) {
    log({ iter: 0, surface: "login", severity: "broken", summary: `org/me ${me.status()}` });
    return false;
  }
  const meJson = await me.json();
  log({ iter: 0, surface: "login", summary: `OK org=${meJson.activeOrgId ?? meJson.orgId ?? "?"}` });
  return true;
}

if (!await login()) {
  await browser.close();
  process.exit(1);
}

// ---- Helpers ----
async function pageGet(path, opts = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  let resp;
  try {
    resp = await page.goto(URL + path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (e) {
    log({ iter: opts.iter, surface: opts.surface ?? path, severity: "broken", summary: `goto failed: ${e.message}` });
    await page.close();
    return null;
  }
  await page.waitForTimeout(opts.wait ?? 1500);
  return { page, resp, errors };
}

function isSpuriousError(text) {
  // Filter known false positives
  if (/"error":"\$undefined"/.test(text)) return true;
  if (/Failed to load resource: the server responded with a status of 401/.test(text)) return true;
  return false;
}

// ============================================================
// ITER 1: Auth (login already verified) + Logout + Sidebar nav
// ============================================================
async function iter1() {
  const ITER = 1;
  // Verify session cookie
  const cookies = await ctx.cookies();
  const sess = cookies.find((c) => /authjs|next-auth/i.test(c.name) && /session/i.test(c.name));
  if (!sess) {
    log({ iter: ITER, surface: "auth.session-cookie", severity: "broken", summary: "no session cookie set" });
  } else {
    log({ iter: ITER, surface: "auth.session-cookie", summary: `cookie=${sess.name}` });
  }

  // Sidebar nav: visit each link from /
  const r = await pageGet("/", { iter: ITER, surface: "home", wait: 2500 });
  if (!r) return;
  // shadcn Sidebar renders as a <div data-slot="sidebar-wrapper">, not <aside>.
  // Grab every internal anchor on the page (deduped below).
  const navLinks = await r.page.$$eval('a[href]', (els) =>
    els.map((e) => e.getAttribute("href"))
      .filter((h) => h && h.startsWith("/") && !h.startsWith("/api") && !h.startsWith("/auth")));
  const unique = [...new Set(navLinks)];
  log({ iter: ITER, surface: "sidebar.discover", summary: `found ${unique.length} links: ${unique.slice(0, 12).join(",")}` });
  await r.page.close();

  for (const path of unique.slice(0, 14)) {
    const pr = await pageGet(path, { iter: ITER, surface: `nav${path}`, wait: 1000 });
    if (!pr) continue;
    const status = pr.resp?.status() ?? 0;
    const title = await pr.page.title().catch(() => "?");
    const realErrors = pr.errors.filter((e) => !isSpuriousError(e));
    if (status >= 400) {
      log({ iter: ITER, surface: `nav${path}`, severity: "broken", summary: `${status} title=${title}` });
    } else if (realErrors.length > 0) {
      log({ iter: ITER, surface: `nav${path}`, severity: "ugly", summary: `console errors: ${realErrors[0].slice(0, 120)}` });
    } else {
      log({ iter: ITER, surface: `nav${path}`, summary: `${status} ${title.slice(0, 50)}` });
    }
    await pr.page.close();
  }
}

// ============================================================
// ITER 2: /onboarding gate + /agents list + per-agent panel
// ============================================================
async function iter2() {
  const ITER = 2;
  // /onboarding should render (gate behavior with no env key)
  const ob = await pageGet("/onboarding", { iter: ITER, surface: "onboarding.gate", wait: 2500 });
  if (ob) {
    const text = (await ob.page.locator("body").innerText().catch(() => "")).slice(0, 400);
    const status = ob.resp?.status();
    if (status >= 400) {
      log({ iter: ITER, surface: "onboarding.gate", severity: "broken", summary: `${status}` });
    } else {
      log({ iter: ITER, surface: "onboarding.gate", summary: `${status} text=${text.slice(0, 120).replace(/\s+/g, " ")}` });
    }
    await ob.page.close();
  }

  // /agents list
  const ag = await pageGet("/agents", { iter: ITER, surface: "agents.list", wait: 2500 });
  if (ag) {
    const cards = await ag.page.locator('a[href^="/agents/"]').count();
    log({ iter: ITER, surface: "agents.list", summary: `${cards} agent links`, severity: cards === 0 ? "broken" : undefined });
    if (cards > 0) {
      // Pick first agent and probe tabs
      const firstHref = await ag.page.locator('a[href^="/agents/"]').first().getAttribute("href");
      if (firstHref) {
        const ap = await pageGet(firstHref, { iter: ITER, surface: `agent${firstHref}`, wait: 2500 });
        if (ap) {
          // AgentPanelClient renders tabs as plain <button> with the
          // label as text. Real tab list: chat, vision, memory, files,
          // tasks, settings (no "overview"). Match by name=button.
          const tabs = ["chat", "vision", "memory", "files", "tasks", "settings"];
          for (const tab of tabs) {
            const tabBtn = ap.page.getByRole("button", { name: new RegExp(`^${tab}$`, "i") });
            const cnt = await tabBtn.count().catch(() => 0);
            if (cnt > 0) {
              try {
                await tabBtn.first().click({ timeout: 4000 });
                await ap.page.waitForTimeout(800);
                log({ iter: ITER, surface: `agent.tab.${tab}`, summary: "clickable" });
              } catch (e) {
                log({ iter: ITER, surface: `agent.tab.${tab}`, severity: "ugly", summary: `click failed: ${e.message.slice(0, 80)}` });
              }
            } else {
              log({ iter: ITER, surface: `agent.tab.${tab}`, severity: "ugly", summary: "tab missing" });
            }
          }
          await ap.page.close();
        }
      }
    }
    await ag.page.close();
  }

  // Hire sheet: button on /agents
  const hire = await pageGet("/agents", { iter: ITER, surface: "agents.hire-button", wait: 2000 });
  if (hire) {
    const hireBtn = hire.page.locator('button:has-text("Hire"), a:has-text("Hire")');
    const hireCnt = await hireBtn.count();
    log({ iter: ITER, surface: "agents.hire-button", summary: `count=${hireCnt}`, severity: hireCnt === 0 ? "ugly" : undefined });
    if (hireCnt > 0) {
      try {
        await hireBtn.first().click({ timeout: 3000 });
        await hire.page.waitForTimeout(1500);
        const sheetOpen = await hire.page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').count();
        log({ iter: ITER, surface: "agents.hire-sheet", summary: `dialog count=${sheetOpen}`, severity: sheetOpen === 0 ? "ugly" : undefined });
      } catch (e) {
        log({ iter: ITER, surface: "agents.hire-sheet", severity: "ugly", summary: `click failed: ${e.message.slice(0, 80)}` });
      }
    }
    await hire.page.close();
  }
}

// ============================================================
// ITER 3: /chat hub + /tasks
// ============================================================
async function iter3() {
  const ITER = 3;
  // /chat
  const c = await pageGet("/chat", { iter: ITER, surface: "chat.hub", wait: 2500 });
  if (c) {
    const status = c.resp?.status() ?? 0;
    const ta = await c.page.locator("textarea").count();
    const sendBtn = c.page.locator('button:has-text("Send"), button[type="submit"]');
    const sendCnt = await sendBtn.count();
    let sendDisabled = false;
    if (sendCnt > 0) {
      sendDisabled = await sendBtn.first().isDisabled().catch(() => false);
    }
    log({
      iter: ITER, surface: "chat.hub",
      summary: `status=${status} textareas=${ta} send-buttons=${sendCnt} disabled-when-empty=${sendDisabled}`,
      severity: status >= 400 || ta === 0 ? "broken" : sendCnt > 0 && !sendDisabled ? "ugly" : undefined,
    });
    // Sub-agent picker - look for a select / combobox / button with role=combobox
    const picker = await c.page.locator('[role="combobox"], button:has-text("Atlas")').count();
    log({ iter: ITER, surface: "chat.subagent-picker", summary: `picker count=${picker}`, severity: picker === 0 ? "ugly" : undefined });
    await c.page.close();
  }

  // /tasks
  const t = await pageGet("/tasks", { iter: ITER, surface: "tasks.list", wait: 2500 });
  if (t) {
    const status = t.resp?.status() ?? 0;
    const items = await t.page.locator('a[href^="/tasks/"], li, tr').count();
    const badges = await t.page.locator('[class*="badge"], [class*="status"]').count();
    log({
      iter: ITER, surface: "tasks.list",
      summary: `status=${status} items=${items} badges=${badges}`,
      severity: status >= 400 ? "broken" : undefined,
    });
    await t.page.close();
  }
}

// ============================================================
// ITER 4: /insights (no LLM) + /files dropzone
// ============================================================
async function iter4() {
  const ITER = 4;
  // GET /api/insights (no sweep)
  const apiInsights = await ctx.request.get(URL + "/api/insights");
  const apiBody = await apiInsights.text();
  if (!apiInsights.ok()) {
    log({ iter: ITER, surface: "api.insights.GET", severity: "broken", summary: `${apiInsights.status()}: ${apiBody.slice(0, 100)}` });
  } else {
    log({ iter: ITER, surface: "api.insights.GET", summary: `${apiInsights.status()} ${apiBody.slice(0, 100)}` });
  }

  // /dashboard - look for insights banner
  const d = await pageGet("/dashboard", { iter: ITER, surface: "dashboard.banner", wait: 3000 });
  if (d) {
    const status = d.resp?.status() ?? 0;
    const banner = await d.page.locator('button:has-text("Open chat")').count();
    log({ iter: ITER, surface: "dashboard.insights-banner", summary: `status=${status} open-chat-btn=${banner}` });
    await d.page.close();
  }

  // /files
  const f = await pageGet("/files", { iter: ITER, surface: "files.page", wait: 2500 });
  if (f) {
    const status = f.resp?.status() ?? 0;
    const drop = await f.page.locator('[data-testid="files-dropzone"], [class*="border-dashed"]').count();
    const brand = await f.page.locator('text=/brand profile/i').count();
    log({
      iter: ITER, surface: "files.page",
      summary: `status=${status} dropzone=${drop} brand-profile=${brand}`,
      severity: status >= 400 ? "broken" : drop === 0 ? "ugly" : undefined,
    });
    // Try /api/data/recent
    const recent = await ctx.request.get(URL + "/api/data/recent");
    log({ iter: ITER, surface: "api.data.recent", summary: `${recent.status()}`, severity: !recent.ok() ? "broken" : undefined });
    await f.page.close();
  }
}

// ============================================================
// ITER 5: /data + /sales-calls
// ============================================================
async function iter5() {
  const ITER = 5;
  const d = await pageGet("/data", { iter: ITER, surface: "data.page", wait: 2500 });
  if (d) {
    const status = d.resp?.status() ?? 0;
    const ta = await d.page.locator("textarea").count();
    const tags = await d.page.locator('button:has-text("crm"), button:has-text("note"), [class*="pill"]').count();
    log({
      iter: ITER, surface: "data.page",
      summary: `status=${status} textareas=${ta} tag-buttons=${tags}`,
      severity: status >= 400 ? "broken" : ta === 0 ? "ugly" : undefined,
    });
    await d.page.close();
  }

  const s = await pageGet("/sales-calls", { iter: ITER, surface: "sales-calls.page", wait: 2500 });
  if (s) {
    const status = s.resp?.status() ?? 0;
    const upload = await s.page.locator('input[type="file"], button:has-text("Upload")').count();
    log({
      iter: ITER, surface: "sales-calls.page",
      summary: `status=${status} upload-controls=${upload}`,
      severity: status >= 400 ? "broken" : undefined,
    });
    await s.page.close();
  }
}

// ============================================================
// ITER 6: /connections + /skills
// ============================================================
async function iter6() {
  const ITER = 6;
  const c = await pageGet("/connections", { iter: ITER, surface: "connections.page", wait: 2500 });
  if (c) {
    const status = c.resp?.status() ?? 0;
    const cards = await c.page.locator('text=/Claude/i').count();
    const slack = await c.page.locator('text=/Slack/i').count();
    const tg = await c.page.locator('text=/Telegram/i').count();
    const gmail = await c.page.locator('text=/Gmail/i').count();
    log({
      iter: ITER, surface: "connections.cards",
      summary: `status=${status} claude=${cards} slack=${slack} tg=${tg} gmail=${gmail}`,
      severity: status >= 400 ? "broken" : (cards === 0 || slack === 0 || tg === 0) ? "ugly" : undefined,
    });
    await c.page.close();
  }

  const s = await pageGet("/skills", { iter: ITER, surface: "skills.page", wait: 2500 });
  if (s) {
    const status = s.resp?.status() ?? 0;
    const tiles = await s.page.locator('a[href^="/skills/"], [class*="tile"], [class*="card"]').count();
    log({
      iter: ITER, surface: "skills.marketplace",
      summary: `status=${status} tiles=${tiles}`,
      severity: status >= 400 ? "broken" : tiles === 0 ? "ugly" : undefined,
    });
    await s.page.close();
  }
}

// ============================================================
// ITER 7: /company + /approvals
// ============================================================
async function iter7() {
  const ITER = 7;
  const c = await pageGet("/company", { iter: ITER, surface: "company.page", wait: 2500 });
  if (c) {
    const status = c.resp?.status() ?? 0;
    const auto = await c.page.locator('text=/autonomous/i').count();
    const acl = await c.page.locator('text=/department/i').count();
    log({
      iter: ITER, surface: "company.page",
      summary: `status=${status} autonomous-toggle=${auto} dept-acl=${acl}`,
      severity: status >= 400 ? "broken" : undefined,
    });
    await c.page.close();
  }

  const a = await pageGet("/approvals", { iter: ITER, surface: "approvals.page", wait: 2500 });
  if (a) {
    const status = a.resp?.status() ?? 0;
    const empty = await a.page.locator('text=/no approvals|empty|nothing/i').count();
    const buttons = await a.page.locator('button:has-text("Approve"), button:has-text("Reject")').count();
    log({
      iter: ITER, surface: "approvals.page",
      summary: `status=${status} empty-state=${empty} action-buttons=${buttons}`,
      severity: status >= 400 ? "broken" : undefined,
    });
    await a.page.close();
  }
}

// ============================================================
// ITER 8: /routines + /booking
// ============================================================
async function iter8() {
  const ITER = 8;
  const r = await pageGet("/routines", { iter: ITER, surface: "routines.page", wait: 2500 });
  if (r) {
    const status = r.resp?.status() ?? 0;
    const newBtn = r.page.locator('button:has-text("New"), button:has-text("Create"), button:has-text("Add")');
    const newCnt = await newBtn.count();
    log({
      iter: ITER, surface: "routines.page",
      summary: `status=${status} new-button=${newCnt}`,
      severity: status >= 400 ? "broken" : undefined,
    });
    if (newCnt > 0) {
      try {
        await newBtn.first().click({ timeout: 3000 });
        await r.page.waitForTimeout(1500);
        const dialog = await r.page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').count();
        const cron = await r.page.locator('text=/cron|every|hour|day/i').count();
        log({
          iter: ITER, surface: "routines.new-sheet",
          summary: `dialog=${dialog} cron-text=${cron}`,
          severity: dialog === 0 ? "ugly" : undefined,
        });
      } catch (e) {
        log({ iter: ITER, surface: "routines.new-sheet", severity: "ugly", summary: `click failed: ${e.message.slice(0, 80)}` });
      }
    }
    await r.page.close();
  }

  const b = await pageGet("/booking", { iter: ITER, surface: "booking.page", wait: 2500 });
  if (b) {
    const status = b.resp?.status() ?? 0;
    log({ iter: ITER, surface: "booking.page", summary: `status=${status}`, severity: status >= 400 ? "broken" : undefined });
    await b.page.close();
  }
}

// ============================================================
// ITER 9: /mini-saas + /updates
// ============================================================
async function iter9() {
  const ITER = 9;
  const m = await pageGet("/mini-saas", { iter: ITER, surface: "mini-saas.page", wait: 3000 });
  if (m) {
    const status = m.resp?.status() ?? 0;
    const newBtn = m.page.locator('button:has-text("New"), button:has-text("Create")');
    const newCnt = await newBtn.count();
    log({
      iter: ITER, surface: "mini-saas.page",
      summary: `status=${status} new-button=${newCnt}`,
      severity: status >= 400 ? "broken" : newCnt === 0 ? "ugly" : undefined,
    });
    if (newCnt > 0) {
      try {
        await newBtn.first().click({ timeout: 3000 });
        await m.page.waitForTimeout(2000);
        // search whole DOM (modal lives in tree, not portal in this case)
        const ta = await m.page.locator("textarea").count();
        const titleInp = await m.page.locator('input[type="text"], input:not([type])').count();
        const dialog = await m.page.locator('[role="dialog"], [aria-modal="true"]').count();
        log({
          iter: ITER, surface: "mini-saas.new-sheet",
          summary: `dialog=${dialog} textareas=${ta} text-inputs=${titleInp}`,
          severity: ta === 0 && titleInp === 0 ? "broken" : dialog === 0 ? "ugly" : undefined,
        });
      } catch (e) {
        log({ iter: ITER, surface: "mini-saas.new-sheet", severity: "ugly", summary: `click failed: ${e.message.slice(0, 80)}` });
      }
    }
    await m.page.close();
  }

  const u = await pageGet("/updates", { iter: ITER, surface: "updates.page", wait: 2500 });
  if (u) {
    const status = u.resp?.status() ?? 0;
    const items = await u.page.locator('article, [role="article"], li').count();
    const text = (await u.page.locator("body").innerText().catch(() => "")).slice(0, 200);
    log({
      iter: ITER, surface: "updates.page",
      summary: `status=${status} items=${items} text-snippet=${text.replace(/\s+/g, " ").slice(0, 80)}`,
      severity: status >= 400 ? "broken" : undefined,
    });
    await u.page.close();
  }
}

// ============================================================
// ITER 10: /admin/provisioning + Notification bell
// ============================================================
async function iter10() {
  const ITER = 10;
  const a = await pageGet("/admin/provisioning", { iter: ITER, surface: "admin.provisioning", wait: 2500 });
  if (a) {
    const status = a.resp?.status() ?? 0;
    const text = (await a.page.locator("body").innerText().catch(() => "")).slice(0, 200);
    const hasTable = await a.page.locator("table").count();
    const isDenied = /denied|forbidden|admin only|unauthorized/i.test(text);
    log({
      iter: ITER, surface: "admin.provisioning",
      summary: `status=${status} table=${hasTable} denied=${isDenied}`,
      severity: status >= 500 ? "broken" : undefined,
    });
    await a.page.close();
  }

  // Notification bell - go home, click bell
  const h = await pageGet("/", { iter: ITER, surface: "notif.bell", wait: 2500 });
  if (h) {
    // CSS attr selector "i" flag is a Playwright extension that only works
    // in `:nth-match` etc, not in raw [attr*=v i]. Use case-insensitive
    // regex via getByRole / getByLabel instead.
    const bell = h.page.getByRole("button", { name: /notif/i });
    let bellCnt = await bell.count();
    if (bellCnt === 0) {
      bellCnt = await h.page.locator('button:has(svg.lucide-bell), [data-testid*="bell"]').count();
    }
    log({ iter: ITER, surface: "notif.bell.discover", summary: `count=${bellCnt}`, severity: bellCnt === 0 ? "ugly" : undefined });
    if (bellCnt > 0) {
      try {
        await bell.first().click({ timeout: 3000 });
        await h.page.waitForTimeout(1500);
        const dropdown = await h.page.locator('[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper]').count();
        log({ iter: ITER, surface: "notif.bell.dropdown", summary: `dropdown=${dropdown}`, severity: dropdown === 0 ? "ugly" : undefined });
      } catch (e) {
        log({ iter: ITER, surface: "notif.bell.dropdown", severity: "ugly", summary: `click failed: ${e.message.slice(0, 80)}` });
      }
    }
    await h.page.close();
  }
}

// ============================================================
// ITER 11: API: data ingest valid+invalid, files upload, agents GET, notifications/agents
// ============================================================
async function iter11() {
  const ITER = 11;
  // Invalid (too short)
  const r1 = await ctx.request.post(URL + "/api/data/ingest", {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ source: "note", label: "tiny", text: "hi" }),
  });
  const r1body = await r1.text();
  log({
    iter: ITER, surface: "api.data.ingest.invalid",
    summary: `${r1.status()} ${r1body.slice(0, 80)}`,
    severity: r1.status() !== 400 ? "broken" : undefined,
  });

  // Valid
  const r2 = await ctx.request.post(URL + "/api/data/ingest", {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({
      source: "note",
      label: "ralph-smoke-iter11",
      text: "Ralph loop iter11 smoke - verifying ingest path returns ok with chunk count.",
    }),
  });
  const r2body = await r2.text();
  log({
    iter: ITER, surface: "api.data.ingest.valid",
    summary: `${r2.status()} ${r2body.slice(0, 120)}`,
    severity: !r2.ok() ? "broken" : undefined,
  });

  // /api/files/upload with text file (multipart)
  const fd = new FormData();
  fd.append(
    "file",
    new Blob(["ralph loop iter11 - verify upload path"], { type: "text/plain" }),
    "ralph-iter11.txt",
  );
  const r3 = await ctx.request.post(URL + "/api/files/upload", { multipart: { file: { name: "ralph-iter11.txt", mimeType: "text/plain", buffer: Buffer.from("ralph loop iter11 verify upload") } } });
  const r3body = await r3.text();
  log({
    iter: ITER, surface: "api.files.upload",
    summary: `${r3.status()} ${r3body.slice(0, 120)}`,
    severity: !r3.ok() && r3.status() !== 400 ? "broken" : undefined,
  });

  // /api/agents
  const r4 = await ctx.request.get(URL + "/api/agents");
  const r4j = await r4.json().catch(() => ({}));
  const agentCnt = (r4j.agents ?? []).length;
  log({
    iter: ITER, surface: "api.agents.GET",
    summary: `${r4.status()} agents=${agentCnt}`,
    severity: !r4.ok() ? "broken" : agentCnt === 0 ? "ugly" : undefined,
  });

  // /api/notifications/agents
  const r5 = await ctx.request.get(URL + "/api/notifications/agents");
  const r5j = await r5.json().catch(() => ({}));
  log({
    iter: ITER, surface: "api.notifications.agents",
    summary: `${r5.status()} keys=${Object.keys(r5j).join(",").slice(0, 80)}`,
    severity: !r5.ok() ? "broken" : undefined,
  });
}

// ============================================================
// ITER 12: Cron auth, bad UUIDs, cross-tenant, LLM endpoint reachability (single poke each)
// ============================================================
async function iter12() {
  const ITER = 12;
  // Cron without auth -> 401
  const r1 = await ctx.request.get(URL + "/api/cron/atlas-coordinate", { headers: { /* deliberately no bearer */ } });
  log({
    iter: ITER, surface: "api.cron.no-auth",
    summary: `${r1.status()}`,
    severity: r1.status() !== 401 ? "broken" : undefined,
  });

  // Bad UUID -> 400 (or 404)
  const badId = "not-a-uuid-blob";
  const r2 = await ctx.request.post(URL + `/api/insights/${badId}/open-chat`, {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({}),
  });
  log({
    iter: ITER, surface: "api.insights.bad-uuid.open-chat",
    summary: `${r2.status()}`,
    severity: r2.status() === 500 ? "broken" : undefined,
  });

  // PATCH /api/insights/:bad-uuid
  const r3 = await ctx.request.patch(URL + `/api/insights/${badId}`, {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ status: "acknowledged" }),
  });
  log({
    iter: ITER, surface: "api.insights.bad-uuid.PATCH",
    summary: `${r3.status()}`,
    severity: r3.status() === 500 ? "broken" : undefined,
  });

  // PATCH /api/agents/:bad-uuid
  const r4 = await ctx.request.patch(URL + `/api/agents/${badId}`, {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ description: "bad" }),
  });
  log({
    iter: ITER, surface: "api.agents.bad-uuid.PATCH",
    summary: `${r4.status()}`,
    severity: r4.status() === 500 ? "broken" : undefined,
  });

  // Cross-tenant: random valid-looking UUID
  const fakeOrgId = "00000000-0000-4000-8000-000000000001";
  const r5 = await ctx.request.patch(URL + `/api/agents/${fakeOrgId}`, {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ description: "x" }),
  });
  log({
    iter: ITER, surface: "api.agents.cross-tenant.PATCH",
    summary: `${r5.status()}`,
    severity: r5.status() === 200 ? "broken" : undefined,
  });

  const r6 = await ctx.request.patch(URL + `/api/insights/${fakeOrgId}`, {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ status: "acknowledged" }),
  });
  log({
    iter: ITER, surface: "api.insights.cross-tenant.PATCH",
    summary: `${r6.status()}`,
    severity: r6.status() === 200 ? "broken" : undefined,
  });

  // LLM reachability - SINGLE poke each (not in loop). Just check status code is reachable, not a 500.
  // 1. /api/onboarding/chat - should return some auth-context-relevant code (200/400/401/403). Avoid retry.
  const llm1 = await ctx.request.post(URL + "/api/onboarding/chat", {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
    timeout: 8000,
  }).catch((e) => ({ status: () => 0, text: () => Promise.resolve(e.message) }));
  log({
    iter: ITER, surface: "api.llm.onboarding.chat.reach",
    summary: `${llm1.status()}`,
    severity: llm1.status() === 500 ? "ugly" : undefined,
  });

  // 2. /api/insights?sweep=true - DON'T trigger, just verify routing. Use POST to a wrong method probably 405.
  // Skip per instructions.
  log({ iter: ITER, surface: "api.llm.insights.sweep.skipped", summary: "skipped per rate-limit policy" });
}

// ---- Run iterations ----
const iters = [iter1, iter2, iter3, iter4, iter5, iter6, iter7, iter8, iter9, iter10, iter11, iter12];

if (ITER > 0 && ITER <= iters.length) {
  await iters[ITER - 1]();
} else {
  for (let i = 0; i < iters.length; i++) {
    console.log(`\n=== ITER ${i + 1} ===`);
    try {
      await iters[i]();
    } catch (e) {
      log({ iter: i + 1, surface: "iter.crash", severity: "broken", summary: e.message.slice(0, 200) });
    }
  }
}

await browser.close();
console.log("\n=== DONE ===");
