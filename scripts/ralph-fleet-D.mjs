// ralph-fleet WORKER D
// Audits /agents surfaces only:
//   1. /agents list page (cards + counts)
//   2. /agents/<atlas-id>?tab=chat (3 messages, reload, persistence)
//   3. /agents hire flow (quick-hire copywriter, verify card grew)
//   4. Six tabs (chat / vision / memory / files / tasks / settings)
//   5. File drop into Files tab (small md upload)
// Mem-tight: single chromium instance, 3 iterations.
// Auto-restart dev server if it dies.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const URL = "http://localhost:3002";
const FINDINGS = process.env.OUT || "/tmp/ralph-fleet-D-findings.jsonl";
const ITERATIONS = parseInt(process.env.ITERATIONS || "3", 10);
const ACCOUNTS = [
  { email: "pedro-onboard@rawclaw.demo", password: "rawclaw-onboard-2026" },
];

const log = (...a) => console.log("[ralph-D]", ...a);
const append = (rec) => fs.appendFileSync(FINDINGS, JSON.stringify(rec) + "\n");

async function ping() {
  try {
    const r = await fetch(URL + "/api/auth/csrf", {
      signal: AbortSignal.timeout(4000),
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await ping()) return true;
  log("server down - restarting");
  fs.writeFileSync("/tmp/rawclaw-dev.log", "");
  const child = spawn(
    "node",
    ["node_modules/.bin/next", "dev", "-p", "3002"],
    {
      cwd: "/home/pedroafonso/rawclaw-research/rawclaw",
      env: {
        ...process.env,
        NODE_OPTIONS: "--max-old-space-size=1100",
        TURBOPACK_ROOT: "/home/pedroafonso/rawclaw-research/rawclaw",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      detached: true,
      stdio: [
        "ignore",
        fs.openSync("/tmp/rawclaw-dev.log", "a"),
        fs.openSync("/tmp/rawclaw-dev.log", "a"),
      ],
    },
  );
  child.unref();
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await ping()) {
      log(`server back after ${i + 1}s`);
      return true;
    }
  }
  log("server failed to come back");
  return false;
}

async function login(ctx, account) {
  const csrf = await ctx.request.get(URL + "/api/auth/csrf");
  const { csrfToken } = await csrf.json();
  const r = await ctx.request.post(URL + "/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: account.email,
      password: account.password,
      json: "true",
      callbackUrl: URL + "/",
    },
    headers: { "content-type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  return r.status();
}

function makeRecorders(page) {
  const httpEvents = [];
  const consoleErrors = [];
  page.on("response", (resp) => {
    const u = resp.url();
    if (!u.startsWith(URL)) return;
    httpEvents.push({
      status: resp.status(),
      method: resp.request().method(),
      url: u.replace(URL, "").slice(0, 140),
    });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on("pageerror", (err) =>
    consoleErrors.push(
      "pageerror: " + (err?.message ?? String(err)).slice(0, 500),
    ),
  );
  return { httpEvents, consoleErrors };
}

function http5xx(events) {
  return events
    .filter((e) => e.status >= 500)
    .map((e) => `${e.status} ${e.method} ${e.url}`);
}

function http4xxNonAuth(events) {
  // 401/403 from auth probes are normal pre-login. Only flag 4xx after
  // login on non-auth paths.
  return events
    .filter((e) => e.status >= 400 && e.status < 500)
    .filter((e) => !/\/api\/auth\//.test(e.url))
    .filter((e) => e.status !== 404 || /\/api\//.test(e.url))
    .map((e) => `${e.status} ${e.method} ${e.url}`);
}

async function snap(page, label) {
  try {
    await page.screenshot({
      path: `/tmp/ralph-D-${label}.png`,
      fullPage: false,
    });
  } catch {}
}

function dropConsoleNoise(arr) {
  return arr.filter(
    (e) =>
      !/Failed to load resource|favicon|webpack-hmr|Hot Module Replacement|hydrat/i.test(
        e,
      ),
  );
}

// ---- SURFACE 1: /agents list page ----
async function probeAgentsList(browser, iter) {
  const findings = {
    surface: "agents_list",
    iter,
    score: "ok",
    issues: [],
    note: "",
  };
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const status = await login(ctx, ACCOUNTS[0]);
    if (status !== 302 && status !== 200) {
      findings.score = "broken";
      findings.issues.push(`login HTTP ${status}`);
      return findings;
    }
    const page = await ctx.newPage();
    const rec = makeRecorders(page);
    await page.goto(URL + "/agents", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);

    // Card link is `a[href^="/agents/"]`. Count distinct ids.
    const links = page.locator('a[href^="/agents/"]');
    const linkCount = await links.count();
    const ids = new Set();
    for (let i = 0; i < linkCount; i++) {
      const href = await links.nth(i).getAttribute("href");
      if (!href) continue;
      const m = href.match(/^\/agents\/([0-9a-f-]{36})/);
      if (m) ids.add(m[1]);
    }
    findings.note = `cards=${ids.size} links=${linkCount}`;
    if (ids.size === 0) {
      findings.score = "broken";
      findings.issues.push("no agent cards rendered");
      await snap(page, `agents-list-empty-iter${iter}`);
    }

    // Hover the first card to make sure no error toasts pop on hover.
    if (linkCount > 0) {
      await links.first().hover().catch(() => {});
      await page.waitForTimeout(400);
    }

    const errs5xx = http5xx(rec.httpEvents);
    if (errs5xx.length) {
      findings.score = "broken";
      findings.issues.push(...errs5xx);
      await snap(page, `agents-list-iter${iter}`);
    }
    const fatal = dropConsoleNoise(rec.consoleErrors);
    if (fatal.length) {
      findings.issues.push("console: " + fatal.slice(0, 2).join(" | "));
      if (findings.score === "ok") findings.score = "minor";
    }
    return findings;
  } catch (e) {
    findings.score = "broken";
    findings.issues.push(
      "exception: " + (e?.message ?? String(e)).slice(0, 300),
    );
    return findings;
  } finally {
    await ctx.close();
  }
}

// ---- SURFACE 2: /agents/<atlas-id>?tab=chat ----
async function probeAtlasChat(browser, iter) {
  const findings = {
    surface: "atlas_chat",
    iter,
    score: "ok",
    issues: [],
    note: "",
  };
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const ls = await login(ctx, ACCOUNTS[0]);
    if (ls !== 302 && ls !== 200) {
      findings.score = "broken";
      findings.issues.push(`login HTTP ${ls}`);
      return findings;
    }
    const al = await ctx.request.get(URL + "/api/agents", {
      failOnStatusCode: false,
    });
    if (al.status() !== 200) {
      findings.score = "broken";
      findings.issues.push(`/api/agents HTTP ${al.status()}`);
      return findings;
    }
    const aj = await al.json();
    const atlas = (aj.agents || []).find((a) => a.role === "ceo");
    if (!atlas) {
      findings.score = "broken";
      findings.issues.push("no CEO agent in org");
      return findings;
    }
    const page = await ctx.newPage();
    const rec = makeRecorders(page);
    await page.goto(`${URL}/agents/${atlas.id}?tab=chat`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);

    const input = page.getByPlaceholder("Talk to this agent...").first();
    await input.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    if ((await input.count()) === 0) {
      findings.score = "broken";
      findings.issues.push("no Talk to this agent input");
      await snap(page, `atlas-chat-no-input-iter${iter}`);
      return findings;
    }
    const tag = `probeD-iter${iter}-${Date.now().toString(36)}`;
    for (let i = 0; i < 3; i++) {
      await input.fill(`${tag} turn ${i + 1}`);
      await input.press("Enter");
      await page.waitForTimeout(7000);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const bodyText = await page.locator("body").innerText();
    const matches = bodyText.match(new RegExp(tag, "g"));
    const count = matches ? matches.length : 0;
    if (count < 3) {
      findings.score = "minor";
      findings.issues.push(`only ${count}/3 user turns persisted after reload`);
    }
    const errs5xx = http5xx(rec.httpEvents);
    if (errs5xx.length) {
      findings.score = "broken";
      findings.issues.push(...errs5xx);
      await snap(page, `atlas-chat-iter${iter}`);
    }
    const errs4xx = http4xxNonAuth(rec.httpEvents);
    if (errs4xx.length && findings.score === "ok") {
      findings.score = "minor";
      findings.issues.push("4xx: " + errs4xx.slice(0, 2).join(" | "));
    }
    const fatal = dropConsoleNoise(rec.consoleErrors);
    if (fatal.length && findings.score === "ok") {
      findings.score = "minor";
      findings.issues.push("console: " + fatal[0]);
    }
    findings.note = `atlas=${atlas.id.slice(0, 8)} persisted=${count}/3`;
    return findings;
  } catch (e) {
    findings.score = "broken";
    findings.issues.push(
      "exception: " + (e?.message ?? String(e)).slice(0, 300),
    );
    return findings;
  } finally {
    await ctx.close();
  }
}

// ---- SURFACE 3: hire flow + card growth ----
async function probeHire(browser, iter) {
  const findings = {
    surface: "hire",
    iter,
    score: "ok",
    issues: [],
    note: "",
  };
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const ls = await login(ctx, ACCOUNTS[0]);
    if (ls !== 302 && ls !== 200) {
      findings.score = "broken";
      findings.issues.push(`login HTTP ${ls}`);
      return findings;
    }
    // Count agents before hire via API for ground truth.
    const before = await (
      await ctx.request.get(URL + "/api/agents", { failOnStatusCode: false })
    ).json();
    const beforeCount = (before.agents ?? []).length;

    const page = await ctx.newPage();
    const rec = makeRecorders(page);
    await page.goto(URL + "/agents", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);

    // Click "+ Hire agent" — sheet trigger button, has + Plus icon.
    const trigger = page
      .getByRole("button", { name: /hire agent/i })
      .first();
    if ((await trigger.count()) === 0) {
      findings.score = "broken";
      findings.issues.push("no '+ Hire agent' trigger");
      await snap(page, `hire-no-trigger-iter${iter}`);
      return findings;
    }
    await trigger.click();
    await page.waitForTimeout(800);

    // Fill the quick-hire role input. Placeholder is "copywriter".
    const roleInput = page.getByPlaceholder("copywriter").first();
    await roleInput
      .waitFor({ state: "visible", timeout: 6000 })
      .catch(() => {});
    if ((await roleInput.count()) === 0) {
      findings.score = "broken";
      findings.issues.push("no quick-hire role input");
      await snap(page, `hire-no-role-input-iter${iter}`);
      return findings;
    }
    const roleText = `WorkerD-${iter}-${Date.now().toString(36).slice(-4)}`;
    await roleInput.fill(roleText);
    // Submit via Enter — handled by the onKeyDown handler in agent-sheet.
    await roleInput.press("Enter");
    await page.waitForTimeout(5000);

    const after = await (
      await ctx.request.get(URL + "/api/agents", { failOnStatusCode: false })
    ).json();
    const afterCount = (after.agents ?? []).length;
    findings.note = `before=${beforeCount} after=${afterCount}`;
    if (afterCount <= beforeCount) {
      findings.score = "broken";
      findings.issues.push(
        `agent count did not grow ${beforeCount}->${afterCount}`,
      );
      await snap(page, `hire-no-growth-iter${iter}`);
    }
    const errs5xx = http5xx(rec.httpEvents);
    if (errs5xx.length) {
      findings.score = "broken";
      findings.issues.push(...errs5xx);
    }
    const errs4xx = http4xxNonAuth(rec.httpEvents).filter(
      (e) => !/POST \/api\/agents/.test(e), // create may 422 if dup; not 5xx-fatal
    );
    if (errs4xx.length && findings.score === "ok") {
      findings.score = "minor";
      findings.issues.push("4xx: " + errs4xx.slice(0, 2).join(" | "));
    }
    return findings;
  } catch (e) {
    findings.score = "broken";
    findings.issues.push(
      "exception: " + (e?.message ?? String(e)).slice(0, 300),
    );
    return findings;
  } finally {
    await ctx.close();
  }
}

// ---- SURFACE 4: 6-tab cycle on Atlas ----
async function probeTabs(browser, iter) {
  const findings = {
    surface: "tabs",
    iter,
    score: "ok",
    issues: [],
    note: "",
  };
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const ls = await login(ctx, ACCOUNTS[0]);
    if (ls !== 302 && ls !== 200) {
      findings.score = "broken";
      findings.issues.push(`login HTTP ${ls}`);
      return findings;
    }
    const al = await ctx.request.get(URL + "/api/agents", {
      failOnStatusCode: false,
    });
    const aj = await al.json();
    const atlas = (aj.agents || []).find((a) => a.role === "ceo");
    if (!atlas) {
      findings.score = "broken";
      findings.issues.push("no CEO agent");
      return findings;
    }
    const page = await ctx.newPage();
    const rec = makeRecorders(page);
    await page.goto(`${URL}/agents/${atlas.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);

    const TABS = ["chat", "vision", "memory", "files", "tasks", "settings"];
    const renderResults = [];
    for (const t of TABS) {
      // Tab nav buttons render their label in title-case (Chat / Vision / ...)
      const labelRe = new RegExp("^" + t.charAt(0).toUpperCase() + t.slice(1) + "$", "i");
      const btn = page.getByRole("button", { name: labelRe }).first();
      const has = (await btn.count()) > 0;
      if (!has) {
        renderResults.push(`${t}:miss`);
        continue;
      }
      await btn.click();
      await page.waitForTimeout(700);
      // Each tab body should render at least some text. Use a panel
      // sentinel: chat shows the placeholder, others have their headings.
      // Atlas chat tab can render >20k chars when the thread is long;
      // grabbing only the first 20k strips the bottom-bar hint and
      // breaks the chat sentinel. Take last 6k + first 6k so we cover
      // both empty-state copy at the top and the always-visible footer.
      const fullBody = await page.locator("body").innerText();
      const bodyText =
        fullBody.length > 12000
          ? fullBody.slice(0, 6000) + "\n...\n" + fullBody.slice(-6000)
          : fullBody;
      // Heuristic per tab: presence of a known string. Records pass/fail.
      // Chat: empty state shows "Ask <name> anything"; populated thread
      //   shows the bottom hint "Drag-drop a file to add it..." which
      //   stays in the DOM regardless of message count.
      // Tasks: agents with assigned routines render "via schedule|manual"
      //   per row; agents with none show "No routines assigned". Either
      //   string proves the tab rendered.
      const sentinel = {
        chat: /Ask .* anything|Drag-drop a file to add it|Press\s+Enter to send/i,
        vision: /What .* sees|Job description|Org place/i,
        memory: /No memory yet|audit-log|memory/i,
        files: /Drop files here|No files attached|Uploading/i,
        tasks: /No routines assigned|Routine run|scheduled|via\s+(schedule|manual|chat_task)|SUCCEEDED|FAILED/,
        settings: /Identity|System prompt|Runtime|Model/i,
      }[t];
      const ok = sentinel ? sentinel.test(bodyText) : true;
      renderResults.push(`${t}:${ok ? "ok" : "blank"}`);
      if (!ok) {
        findings.score = "minor";
        findings.issues.push(`${t} tab missing sentinel text`);
        await snap(page, `tab-${t}-iter${iter}`);
      }
    }
    findings.note = renderResults.join(" ");
    const errs5xx = http5xx(rec.httpEvents);
    if (errs5xx.length) {
      findings.score = "broken";
      findings.issues.push(...errs5xx);
    }
    const fatal = dropConsoleNoise(rec.consoleErrors);
    if (fatal.length && findings.score === "ok") {
      findings.score = "minor";
      findings.issues.push("console: " + fatal[0]);
    }
    return findings;
  } catch (e) {
    findings.score = "broken";
    findings.issues.push(
      "exception: " + (e?.message ?? String(e)).slice(0, 300),
    );
    return findings;
  } finally {
    await ctx.close();
  }
}

// ---- SURFACE 5: Files tab upload via input ----
async function probeFileUpload(browser, iter) {
  const findings = {
    surface: "file_upload",
    iter,
    score: "ok",
    issues: [],
    note: "",
  };
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  // Build a tiny markdown file on disk for the upload input.
  const tmp = path.join(os.tmpdir(), `ralph-D-iter${iter}-${Date.now()}.md`);
  fs.writeFileSync(
    tmp,
    `# probe iter ${iter}\nThis is a tiny test doc dropped by ralph-D.\n` +
      `Tag: probeD-file-iter${iter}\n`,
  );
  try {
    const ls = await login(ctx, ACCOUNTS[0]);
    if (ls !== 302 && ls !== 200) {
      findings.score = "broken";
      findings.issues.push(`login HTTP ${ls}`);
      return findings;
    }
    const al = await ctx.request.get(URL + "/api/agents", {
      failOnStatusCode: false,
    });
    const aj = await al.json();
    const atlas = (aj.agents || []).find((a) => a.role === "ceo");
    if (!atlas) {
      findings.score = "broken";
      findings.issues.push("no CEO agent");
      return findings;
    }
    const page = await ctx.newPage();
    const rec = makeRecorders(page);
    await page.goto(`${URL}/agents/${atlas.id}?tab=files`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);

    // The Files tab has a hidden <input type="file" multiple ...>. Set
    // its files directly — Playwright sends the multipart upload via the
    // component's onChange handler, exercising the real upload pipeline.
    const fileInput = page.locator('input[type="file"]').first();
    if ((await fileInput.count()) === 0) {
      findings.score = "broken";
      findings.issues.push("no file input in Files tab");
      await snap(page, `files-no-input-iter${iter}`);
      return findings;
    }
    await fileInput.setInputFiles(tmp);
    await page.waitForTimeout(8000); // upload + chunk + embed pipeline

    const body = await page.locator("body").innerText();
    const flashOK =
      /file\(s\)\s*\.\s*\d+\s*chunks/i.test(body) ||
      /chunks indexed/i.test(body);
    const filenameAppeared = body.includes(path.basename(tmp));
    findings.note = `flashOK=${flashOK} filenameAppeared=${filenameAppeared}`;
    if (!flashOK && !filenameAppeared) {
      findings.score = "broken";
      findings.issues.push("upload pipeline left no visible result");
      await snap(page, `files-upload-no-result-iter${iter}`);
    } else if (!filenameAppeared) {
      findings.score = "minor";
      findings.issues.push("filename not visible after upload");
    }

    const errs5xx = http5xx(rec.httpEvents);
    if (errs5xx.length) {
      findings.score = "broken";
      findings.issues.push(...errs5xx);
    }
    const uploadEvts = rec.httpEvents.filter((e) =>
      /\/api\/agent-files\/upload/.test(e.url),
    );
    findings.note += ` upload=${uploadEvts.map((e) => e.status).join(",")}`;
    const fatal = dropConsoleNoise(rec.consoleErrors);
    if (fatal.length && findings.score === "ok") {
      findings.score = "minor";
      findings.issues.push("console: " + fatal[0]);
    }
    return findings;
  } catch (e) {
    findings.score = "broken";
    findings.issues.push(
      "exception: " + (e?.message ?? String(e)).slice(0, 300),
    );
    return findings;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    await ctx.close();
  }
}

const SURFACES = [
  { name: "agents_list", fn: probeAgentsList },
  { name: "atlas_chat", fn: probeAtlasChat },
  { name: "hire", fn: probeHire },
  { name: "tabs", fn: probeTabs },
  { name: "file_upload", fn: probeFileUpload },
];

async function main() {
  fs.writeFileSync(FINDINGS, "");
  const tally = {};
  // Single browser instance for the whole run to keep memory bounded.
  const browser = await chromium.launch({ headless: true });
  try {
    for (const surf of SURFACES) {
      tally[surf.name] = { ok: 0, minor: 0, ugly: 0, broken: 0, issues: [] };
      // Settling pause between surfaces lets dev-server GC + any
      // lingering streaming connections close before we hammer the next
      // route. Mem on this box is tight (~5.5 GB total + heavy swap),
      // and Turbopack compiles each new route on first hit.
      await new Promise((r) => setTimeout(r, 2500));
      for (let i = 1; i <= ITERATIONS; i++) {
        if (!(await ping())) {
          log(`server died before ${surf.name} iter ${i}`);
          if (!(await ensureServer())) {
            log("could not restart - aborting");
            break;
          }
          // After a restart, give the freshly-spawned next process a
          // grace window before we slam it with a probe — otherwise the
          // first probe page.goto races the server's csrf 200 with the
          // rest of the auth pipeline still booting.
          await new Promise((r) => setTimeout(r, 3000));
        }
        log(`>>> ${surf.name} iter ${i}/${ITERATIONS}`);
        const t0 = Date.now();
        let f;
        try {
          f = await surf.fn(browser, i);
        } catch (e) {
          f = {
            surface: surf.name,
            iter: i,
            score: "broken",
            issues: [
              "outer exception: " + (e?.message ?? String(e)).slice(0, 200),
            ],
            note: "",
          };
        }
        f.ms = Date.now() - t0;
        append(f);
        tally[surf.name][f.score]++;
        if (f.issues.length) {
          for (const iss of f.issues) tally[surf.name].issues.push(iss);
        }
        log(
          `    score=${f.score} ms=${f.ms} issues=${f.issues.length} note=${f.note}`,
        );
      }
    }
  } finally {
    try {
      await browser.close();
    } catch {}
  }
  log("=== TALLY ===");
  for (const [k, v] of Object.entries(tally)) {
    log(
      `${k}: ok=${v.ok} minor=${v.minor} ugly=${v.ugly} broken=${v.broken}`,
    );
    const uniq = [...new Set(v.issues)].slice(0, 5);
    for (const u of uniq) log(`  - ${u}`);
  }
  fs.writeFileSync(
    "/tmp/ralph-fleet-D-summary.json",
    JSON.stringify(tally, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
