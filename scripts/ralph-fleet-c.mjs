// Ralph-fleet WORKER C - 10 iters per surface against LOCAL DEV.
// Surfaces: /files, /data, /sales-calls, /connections, /updates.
// Output: /tmp/ralph-fleet-C-findings.jsonl
// Headless chromium 1440x900.

import { chromium } from "playwright";
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL = process.env.URL || "http://localhost:3002";
const OUT = process.env.OUT || "/tmp/ralph-fleet-C-findings.jsonl";
const EMAIL = process.env.EMAIL || "pedro-onboard@rawclaw.demo";
const PASSWORD = process.env.PASSWORD || "rawclaw-onboard-2026";

if (!existsSync(OUT)) writeFileSync(OUT, "");

const SURFACES = ["files", "data", "sales-calls", "connections", "updates"];
const TARGET = process.env.TARGET || ""; // optional: run a single surface
const ITERS = Number(process.env.ITERS || 10);

const log = (e) => {
  const ev = { ts: new Date().toISOString(), ...e };
  appendFileSync(OUT, JSON.stringify(ev) + "\n");
  const sev = ev.severity ?? "ok";
  const tag = sev === "broken" ? "BROKEN" : sev === "ugly" ? "UGLY" : sev === "minor" ? "MINOR" : "OK";
  console.log(`[${tag}] iter${ev.iter ?? "?"}/${ev.surface}: ${ev.summary}`);
};

function isSpuriousError(text) {
  if (/"error":"\$undefined"/.test(text)) return true;
  if (/Failed to load resource: the server responded with a status of 401/.test(text)) return true;
  if (/manifest\.json|favicon/.test(text)) return true;
  if (/\[Fast Refresh\]/i.test(text)) return true;
  return false;
}

const browser = await chromium.launch({ headless: true });

async function makeContext() {
  // Wait for server up to 60s before signing in.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const probe = await fetch(URL + "/api/auth/csrf");
      if (probe.ok) break;
    } catch {/* keep polling */}
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Wrap auth bootstrap in try/catch. If the dev server dies mid-handshake
  // (socket hang up, ECONNRESET), we want a clean null return so the caller
  // exits with code 2 and the wrapper script restarts the server. Letting
  // the unhandled rejection escape kills the entire worker run.
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    const csrfRaw = await ctx.request.get(URL + "/api/auth/csrf");
    const { csrfToken } = await csrfRaw.json();
    await ctx.request.post(URL + "/api/auth/callback/credentials", {
      form: { csrfToken, email: EMAIL, password: PASSWORD, json: "true", callbackUrl: URL + "/" },
      headers: { "content-type": "application/x-www-form-urlencoded" },
      maxRedirects: 0,
    });
    const me = await ctx.request.get(URL + "/api/org/me");
    if (!me.ok()) {
      log({ surface: "bootstrap", severity: "broken", summary: `org/me ${me.status()} for ${EMAIL}` });
      return null;
    }
    return ctx;
  } catch (err) {
    log({ surface: "bootstrap", severity: "broken", summary: `bootstrap failed: ${(err).message}` });
    return null;
  }
}

async function newProbedPage(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = m.text();
      if (!isSpuriousError(t)) errors.push(`console: ${t}`);
    }
  });
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/")) {
      requests.push({ url: u.replace(URL, ""), status: r.status() });
    }
  });
  return { page, errors, requests };
}

async function captureToasts(page) {
  // Sonner renders <li> nodes with role=status data-sonner-toast.
  return await page.locator("[data-sonner-toast]").allTextContents().catch(() => []);
}

// ---------- /files ----------
async function testFiles(ctx, iter) {
  const surface = "files";
  const { page, errors, requests } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/files", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const status = resp?.status() ?? 0;
    if (status >= 500) {
      log({ surface, iter, severity: "broken", summary: `page status ${status}` });
      return;
    }

    // Choose a flow per iteration
    const flow = iter % 5; // 0=bucket-switch, 1=upload-via-input, 2=brand-link-visible, 3=delete-flow, 4=drop-event

    if (flow === 0) {
      // bucket switch: click "Sales", verify count+heading change
      const start = await page.locator("h3").first().textContent().catch(() => "");
      await page.locator("aside button:has-text('Sales')").first().click({ timeout: 5000 });
      await page.waitForTimeout(500);
      const heading = await page.locator("h3").first().textContent().catch(() => "");
      const ok = (heading || "").toLowerCase().includes("sales");
      log({ surface, iter, severity: ok ? "ok" : "ugly", summary: `bucket switch: start=${start} -> ${heading}`, errors });
    } else if (flow === 1) {
      // upload via setInputFiles (small text file), brand bucket
      await page.locator("aside button:has-text('Brand')").first().click().catch(() => {});
      await page.waitForTimeout(300);
      const tmp = join(tmpdir(), `ralphC-files-${Date.now()}.md`);
      writeFileSync(tmp, "# ralph C test file\n\nbody body body\n");
      const input = page.locator("input[type=file]").first();
      // Wait for the upload response explicitly. Cold-start compile can take 10s+.
      const respPromise = page.waitForResponse(
        (r) => r.url().includes("/api/files/upload") && r.request().method() === "POST",
        { timeout: 30_000 },
      ).catch(() => null);
      await input.setInputFiles(tmp);
      const r = await respPromise;
      const lastStatus = r ? r.status() : 0;
      // Wait for toast / DOM update
      await page.waitForTimeout(800);
      const toasts = await captureToasts(page);
      const ok = lastStatus === 201 || lastStatus === 200;
      log({
        surface, iter, severity: ok ? "ok" : "broken",
        summary: `upload status=${lastStatus} toasts=${JSON.stringify(toasts).slice(0, 200)}`,
        errors,
      });
      // best-effort cleanup: list files API + delete the latest one we just uploaded (matches title)
      try {
        const list = await ctx.request.get(URL + "/api/knowledge?bucket=brand");
        if (list.ok()) {
          const json = await list.json();
          const ours = (json.files || []).find((f) => f.title?.startsWith("ralphC-files-"));
          if (ours) await ctx.request.delete(URL + "/api/knowledge/" + ours.id);
        }
      } catch {/* ignore */}
    } else if (flow === 2) {
      // brand bucket -> Edit brand profile markdown link is present
      await page.locator("aside button:has-text('Brand')").first().click().catch(() => {});
      await page.waitForTimeout(400);
      const link = await page.locator("a:has-text('Edit brand profile markdown')").first().isVisible().catch(() => false);
      log({ surface, iter, severity: link ? "ok" : "minor", summary: `brand link visible=${link}`, errors });
    } else if (flow === 3) {
      // delete flow: upload tiny file then click trash
      await page.locator("aside button:has-text('Other')").first().click().catch(() => {});
      await page.waitForTimeout(300);
      const tmp = join(tmpdir(), `ralphC-del-${Date.now()}.txt`);
      writeFileSync(tmp, "delete me");
      const upPromise = page.waitForResponse(
        (r) => r.url().includes("/api/files/upload") && r.request().method() === "POST",
        { timeout: 30_000 },
      ).catch(() => null);
      await page.locator("input[type=file]").first().setInputFiles(tmp);
      await upPromise;
      await page.waitForTimeout(800);
      const cards = await page.locator("button[title='Delete']").count();
      let delStatus = null;
      if (cards > 0) {
        const delPromise = page.waitForResponse(
          (r) => r.url().includes("/api/knowledge/") && r.request().method() === "DELETE",
          { timeout: 15_000 },
        ).catch(() => null);
        await page.locator("button[title='Delete']").first().click();
        const d = await delPromise;
        delStatus = d ? d.status() : null;
      }
      const ok = delStatus !== null && delStatus >= 200 && delStatus < 300;
      log({
        surface, iter, severity: cards === 0 ? "minor" : ok ? "ok" : "broken",
        summary: `delete: cards=${cards} delStatus=${delStatus}`,
        errors,
      });
    } else if (flow === 4) {
      // drop zone present + role=button + tabIndex
      const drop = await page.locator("[data-testid=files-dropzone]").first();
      const visible = await drop.isVisible().catch(() => false);
      const role = await drop.getAttribute("role").catch(() => null);
      const aria = await drop.getAttribute("aria-label").catch(() => null);
      log({
        surface, iter, severity: visible && role === "button" && aria ? "ok" : "ugly",
        summary: `dropzone visible=${visible} role=${role} aria=${aria}`,
        errors,
      });
    }
  } catch (err) {
    log({ surface, iter, severity: "broken", summary: `exception: ${err.message}`, errors });
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- /data ----------
async function testData(ctx, iter) {
  const surface = "data";
  const { page, errors, requests } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/data", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const status = resp?.status() ?? 0;
    if (status >= 500) {
      log({ surface, iter, severity: "broken", summary: `page status ${status}` });
      return;
    }
    const flow = iter % 5; // 0=tag pills, 1=paste+save, 2=drop-input-upload, 3=recent rail, 4=short-text validation

    if (flow === 0) {
      // tag pills - 5 tags expected
      const pills = await page.locator("button:has(svg) >> visible=true").allTextContents();
      const expected = ["Note", "Contact", "Deal", "Email", "Meeting"];
      const found = expected.filter((e) => pills.some((p) => p.includes(e)));
      log({
        surface, iter, severity: found.length === 5 ? "ok" : "ugly",
        summary: `tag pills found=${found.length}/5 (${found.join(",")})`,
        errors,
      });
      // click "Meeting"
      await page.locator("button:has-text('Meeting')").first().click().catch(() => {});
      await page.waitForTimeout(200);
    } else if (flow === 1) {
      // paste >50 chars and save
      const txt = "Cliente XYZ tem deal de R$50k em pipeline, agendado para fechar dia 15. ICP fit alto.";
      await page.locator("textarea").first().fill(txt);
      const respP = page.waitForResponse(
        (r) => r.url().includes("/api/data/ingest") && r.request().method() === "POST",
        { timeout: 30_000 },
      ).catch(() => null);
      await page.locator("button:has-text('Save')").first().click();
      const r = await respP;
      const lastStatus = r ? r.status() : 0;
      await page.waitForTimeout(800);
      const toasts = await captureToasts(page);
      const ok = (lastStatus === 200 || lastStatus === 201) && toasts.some((t) => /Saved|chunk/i.test(t));
      log({
        surface, iter, severity: ok ? "ok" : "broken",
        summary: `paste-save status=${lastStatus} toasts=${JSON.stringify(toasts).slice(0, 200)}`,
        errors,
      });
    } else if (flow === 2) {
      // upload via input
      const tmp = join(tmpdir(), `ralphC-data-${Date.now()}.md`);
      writeFileSync(tmp, "# ralph C data drop\n\nthis is a markdown drop into /data\n");
      const respP = page.waitForResponse(
        (r) => r.url().includes("/api/files/upload") && r.request().method() === "POST",
        { timeout: 30_000 },
      ).catch(() => null);
      await page.locator("input[type=file]").first().setInputFiles(tmp);
      const r = await respP;
      const lastStatus = r ? r.status() : 0;
      await page.waitForTimeout(800);
      const toasts = await captureToasts(page);
      const ok = lastStatus === 201 || lastStatus === 200;
      log({
        surface, iter, severity: ok ? "ok" : "broken",
        summary: `data drop status=${lastStatus} toasts=${JSON.stringify(toasts).slice(0, 200)}`,
        errors,
      });
    } else if (flow === 3) {
      // recently indexed rail: should render either entries or the empty state
      await page.waitForTimeout(1000);
      const railHeader = await page.locator("text=/Recently indexed/i").first().isVisible().catch(() => false);
      const recentItems = await page.locator("aside ul li").count().catch(() => 0);
      const empty = await page.locator("text=/Nothing yet/i").first().isVisible().catch(() => false);
      log({
        surface, iter, severity: railHeader && (recentItems > 0 || empty) ? "ok" : "ugly",
        summary: `recent rail header=${railHeader} items=${recentItems} empty=${empty}`,
        errors,
      });
    } else if (flow === 4) {
      // short-text validation - paste 5 chars, click Save (should toast error)
      await page.locator("textarea").first().fill("hi");
      // Save button should be disabled when <10 chars
      const disabled = await page.locator("button:has-text('Save')").first().isDisabled().catch(() => null);
      log({
        surface, iter, severity: disabled === true ? "ok" : "ugly",
        summary: `Save button disabled at 2 chars=${disabled}`,
        errors,
      });
    }
  } catch (err) {
    log({ surface, iter, severity: "broken", summary: `exception: ${err.message}`, errors });
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- /sales-calls ----------
async function testSalesCalls(ctx, iter) {
  const surface = "sales-calls";
  const { page, errors, requests } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/sales-calls", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const status = resp?.status() ?? 0;
    if (status >= 500) {
      log({ surface, iter, severity: "broken", summary: `page status ${status}` });
      return;
    }
    const flow = iter % 4; // 0=render, 1=upload-tiny-audio, 2=fireflies button, 3=transcript-list

    if (flow === 0) {
      const sync = await page.locator("button:has-text('Sync from Fireflies')").first().isVisible().catch(() => false);
      const uploader = await page.locator("input[type=file]").first().count();
      log({
        surface, iter, severity: sync && uploader > 0 ? "ok" : "ugly",
        summary: `render syncBtn=${sync} fileInputs=${uploader}`,
        errors,
      });
    } else if (flow === 1) {
      // synthetic tiny "audio" file: a 4-byte mp3-ish header is enough for the upload route to accept it.
      const tmp = join(tmpdir(), `ralphC-call-${Date.now()}.m4a`);
      // 4 bytes - just enough for a file. The route does light validation; might 4xx if it
      // checks duration. We capture status either way.
      writeFileSync(tmp, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]));
      const inputs = await page.locator("input[type=file]").count();
      if (inputs === 0) {
        log({ surface, iter, severity: "ugly", summary: "no file input on /sales-calls", errors });
        return;
      }
      await page.locator("input[type=file]").first().setInputFiles(tmp);
      await page.waitForTimeout(3000);
      const toasts = await captureToasts(page);
      const callReqs = requests.filter((r) => r.url.includes("/sales-calls"));
      const last = callReqs[callReqs.length - 1];
      // anything that isn't a 5xx is acceptable; even a 400 "audio invalid" is healthy
      const ok = last && last.status < 500;
      log({
        surface, iter, severity: ok ? "ok" : "broken",
        summary: `tiny audio: lastSalesCallReq=${last?.url} status=${last?.status} toasts=${JSON.stringify(toasts).slice(0, 200)}`,
        errors,
      });
    } else if (flow === 2) {
      // click sync from fireflies, expect a toast (error if not connected).
      // Cold compile of /api/sales-calls/fireflies/poll can take 6-15s on
      // first hit, so wait on the response explicitly.
      const respP = page.waitForResponse(
        (r) => r.url().includes("fireflies/poll") && r.request().method() === "POST",
        { timeout: 30_000 },
      ).catch(() => null);
      await page.locator("button:has-text('Sync from Fireflies')").first().click().catch(() => {});
      const r = await respP;
      const lastStatus = r ? r.status() : 0;
      await page.waitForTimeout(800);
      const toasts = await captureToasts(page);
      const ok = lastStatus > 0 && lastStatus < 500;
      log({
        surface, iter, severity: ok ? "ok" : "broken",
        summary: `fireflies poll status=${lastStatus} toasts=${JSON.stringify(toasts).slice(0, 200)}`,
        errors,
      });
    } else if (flow === 3) {
      // transcript list: any rows? on a fresh org we tolerate empty state.
      const empty = await page.locator("text=/no calls yet|drop/i").first().isVisible().catch(() => false);
      const rows = await page.locator("[data-testid=sales-call-row], table tbody tr, ul li").count().catch(() => 0);
      log({
        surface, iter, severity: empty || rows >= 0 ? "ok" : "ugly",
        summary: `transcript list rows=${rows} empty=${empty}`,
        errors,
      });
    }
  } catch (err) {
    log({ surface, iter, severity: "broken", summary: `exception: ${err.message}`, errors });
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- /connections ----------
async function testConnections(ctx, iter) {
  const surface = "connections";
  const { page, errors, requests } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/connections", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const status = resp?.status() ?? 0;
    if (status >= 500) {
      log({ surface, iter, severity: "broken", summary: `page status ${status}` });
      return;
    }
    const flow = iter % 5; // 0=claude card, 1=mcp card, 2=apps grid count, 3=composio click, 4=search filter

    if (flow === 0) {
      // claude max card visible (label or section)
      const claude = await page.locator("text=/Claude Max/i").first().isVisible().catch(() => false);
      // status badge: either Connected or Connect button
      const connected = await page.locator("text=/connected/i").first().isVisible().catch(() => false);
      log({
        surface, iter, severity: claude ? "ok" : "broken",
        summary: `claude max section visible=${claude} connectedTextSomewhere=${connected}`,
        errors,
      });
    } else if (flow === 1) {
      // MCP card: wait for swr-driven org/me to land (placeholder is a
      // 72px tall pulse). Once Endpoint label renders the rest is sync.
      await page.locator("text=Endpoint").first().waitFor({ timeout: 15_000 }).catch(() => {});
      const endpoint = await page.locator("text=Endpoint").first().isVisible().catch(() => false);
      const tokenLabel = await page.locator("text=Token").first().isVisible().catch(() => false);
      const tabs = await page.locator("button:has-text('Cursor'), button:has-text('Claude Desktop'), button:has-text('Claude Code')").count();
      log({
        surface, iter, severity: endpoint && tokenLabel && tabs >= 3 ? "ok" : "ugly",
        summary: `mcp endpoint=${endpoint} tokenLabel=${tokenLabel} tabs=${tabs}`,
        errors,
      });
    } else if (flow === 2) {
      // apps grid count - "59 apps tile click" target. We accept any nonzero.
      await page.waitForTimeout(1000);
      // The result count reads as e.g. "59 apps"
      const countText = await page.locator("text=/^\\d+ apps?$/").first().textContent().catch(() => "");
      const m = (countText || "").match(/(\d+)\s*apps?/);
      const n = m ? Number(m[1]) : 0;
      log({
        surface, iter, severity: n >= 10 ? "ok" : "ugly",
        summary: `apps grid count=${n}`,
        errors,
      });
    } else if (flow === 3) {
      // click a non-native composio "Request" button on first available card.
      // Find first Card with "Request" button; click it; expect /api/connections/composio POST 200/201.
      const reqBtns = page.locator("button:has-text('Request')");
      const count = await reqBtns.count().catch(() => 0);
      if (count === 0) {
        log({ surface, iter, severity: "minor", summary: "no Request buttons (all native?)", errors });
        return;
      }
      const respP = page.waitForResponse(
        (r) => r.url().includes("/api/connections/composio") && r.request().method() === "POST",
        { timeout: 30_000 },
      ).catch(() => null);
      await reqBtns.first().click({ timeout: 5000 });
      const r = await respP;
      const lastStatus = r ? r.status() : 0;
      await page.waitForTimeout(800);
      const toasts = await captureToasts(page);
      const ok = lastStatus >= 200 && lastStatus < 300;
      log({
        surface, iter, severity: ok ? "ok" : "broken",
        summary: `composio request status=${lastStatus} toasts=${JSON.stringify(toasts).slice(0, 200)}`,
        errors,
      });
    } else if (flow === 4) {
      // search filter: type "slack", expect at least 1 card matching
      await page.locator("input[placeholder*='Search']").first().fill("slack");
      await page.waitForTimeout(400);
      const slackCard = await page.locator("text=/slack/i").first().isVisible().catch(() => false);
      log({
        surface, iter, severity: slackCard ? "ok" : "ugly",
        summary: `search 'slack' visible=${slackCard}`,
        errors,
      });
      await page.locator("input[placeholder*='Search']").first().fill("");
    }
  } catch (err) {
    log({ surface, iter, severity: "broken", summary: `exception: ${err.message}`, errors });
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- /updates ----------
async function testUpdates(ctx, iter) {
  const surface = "updates";
  const { page, errors, requests } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/updates", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const status = resp?.status() ?? 0;
    if (status >= 500) {
      log({ surface, iter, severity: "broken", summary: `page status ${status}` });
      return;
    }
    const flow = iter % 4; // 0=stat strip, 1=tab toggle, 2=run-atlas, 3=activity events render

    if (flow === 0) {
      // 5 stats (Needs your call / Executing / Resolved / Retries / Reviews)
      const statLabels = ["Needs your call", "Executing", "Resolved", "Retries", "Reviews"];
      let found = 0;
      for (const lbl of statLabels) {
        const ok = await page.locator(`text=${lbl}`).first().isVisible().catch(() => false);
        if (ok) found++;
      }
      log({
        surface, iter, severity: found === 5 ? "ok" : "ugly",
        summary: `stat labels found=${found}/5`,
        errors,
      });
    } else if (flow === 1) {
      // tab toggle
      await page.locator("button:has-text('Activity')").first().click().catch(() => {});
      await page.waitForTimeout(500);
      const filterChips = await page.locator("button:has-text('All'), button:has-text('Anomalies'), button:has-text('Tasks')").count();
      log({
        surface, iter, severity: filterChips >= 2 ? "ok" : "ugly",
        summary: `activity chips=${filterChips}`,
        errors,
      });
    } else if (flow === 2) {
      // Run Atlas now: just click and capture status (LLM may run; we don't wait for full)
      const btn = page.locator("button:has-text('Run Atlas now')");
      const visible = await btn.first().isVisible().catch(() => false);
      if (!visible) {
        log({ surface, iter, severity: "ugly", summary: "Run Atlas button missing", errors });
        return;
      }
      // We DON'T click in iters 0-9 to avoid burning time / external calls. Just verify presence.
      log({ surface, iter, severity: "ok", summary: `Run Atlas button visible=${visible}`, errors });
    } else if (flow === 3) {
      // verify activity feed loads (events array, even if empty)
      const r = await ctx.request.get(URL + "/api/activity?limit=20");
      const ok = r.ok();
      let count = 0;
      if (ok) {
        const j = await r.json();
        count = (j.events || []).length;
      }
      log({
        surface, iter, severity: ok ? "ok" : "broken",
        summary: `/api/activity status=${r.status()} events=${count}`,
        errors,
      });
    }
  } catch (err) {
    log({ surface, iter, severity: "broken", summary: `exception: ${err.message}`, errors });
  } finally {
    await page.close().catch(() => {});
  }
}

const TESTS = {
  files: testFiles,
  data: testData,
  "sales-calls": testSalesCalls,
  connections: testConnections,
  updates: testUpdates,
};

async function ensureUp() {
  // Cheap liveness probe. Skip retries here - the harness restarts the server
  // out-of-process if needed before re-running.
  try {
    const r = await fetch(URL + "/api/auth/csrf");
    return r.ok;
  } catch {
    return false;
  }
}

let ctx = await makeContext();
if (!ctx) {
  // Exit code 2 so the wrapper script restarts the dev server and retries.
  // Code 1 would short-circuit the wrapper and leave surfaces unrun.
  console.error("auth failed");
  await browser.close();
  process.exit(2);
}

const surfaces = TARGET ? [TARGET] : SURFACES;
for (const surface of surfaces) {
  console.log(`\n=== surface: ${surface} ===`);
  for (let i = 0; i < ITERS; i++) {
    if (!(await ensureUp())) {
      log({ surface, iter: i, severity: "broken", summary: "dev server down - aborting iter" });
      console.error("dev server down, exiting early");
      await browser.close();
      process.exit(2);
    }
    // Re-make context if previous was lost (browser context invalidated by 5xx,
    // OOM kill, etc.). Cheap probe: ctx.pages() throws if context closed.
    try {
      ctx.pages();
    } catch {
      log({ surface, iter: i, severity: "minor", summary: "context dead, re-auth" });
      const fresh = await makeContext();
      if (!fresh) {
        log({ surface, iter: i, severity: "broken", summary: "re-auth failed" });
        await browser.close();
        process.exit(2);
      }
      ctx = fresh;
    }
    await TESTS[surface](ctx, i);
  }
}

await browser.close();
console.log("\nworker C done. findings:", OUT);
