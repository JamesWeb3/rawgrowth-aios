// Rawclaw agent benchmark - Playwright-driven runner.
//
// A browser-driven variant of scripts/bench/run.mjs. Where run.mjs
// drives the chat over raw HTTP (POST /api/agents/[id]/chat + parse the
// newline-delimited event stream), this runner drives the REAL browser
// UI end to end: it opens the actual login page, navigates to the
// fixture's agent chat page, types the prompt into the chat input,
// submits, waits for the streamed reply to finish, then reads the
// trajectory back out of the DOM - the visible reply, the thinking
// trace nodes, and the orchestration timeline (tool-call cards,
// delegation cards, routine cards) the dashboard renders.
//
// Why a second runner: the HTTP path measures the server. The browser
// path measures the same harness PLUS the chat page, the streaming
// render, and the orchestration-timeline DOM - so it catches UI bugs
// the HTTP path cannot (a command the server emitted but the page
// failed to render, a reply that streamed but never settled, a stuck
// thinking frame). It uses its OWN headless Chromium via the playwright
// library - no shared / MCP browser.
//
// It reads the SAME fixtures.mjs task suite and writes results in the
// SAME JSON shape run.mjs writes, so scripts/bench/score.mjs scores its
// output unchanged. Output lands at
// scripts/bench/results/<timestamp>.pw.json (the .pw. marks it as the
// browser run; it still ends in .json so score.mjs picks it up).
// Per run it also saves a screenshot to
// scripts/bench/results/screenshots/<task>-<run>.png.
//
// Nothing here scores - run score.mjs on the output file next.
//
// -- Environment (same contract as run.mjs: process.env wins, then a
//    key in the repo .env, then a hard default) --
//   BENCH_BASE_URL    base URL of a running Rawclaw app.
//                     Default http://localhost:3002 (the dev server).
//   BENCH_EMAIL       operator login email for the target org.
//                     Default pedro-onboard@rawclaw.demo.
//   BENCH_PASSWORD    that account's password.
//                     Default rawclaw-onboard-2026.
//   BENCH_K           runs per fixture. Default 5.
//   BENCH_TIMEOUT_MS  per-run timeout (login + nav + stream). Default
//                     180000.
//   BENCH_ONLY        comma-separated fixture ids to run a subset.
//   BENCH_OBJECTIVE   run only fixtures whose objective matches.
//   BENCH_GIT_COMMIT  optional - stamped into the results file.
//   BENCH_HEADFUL     set to "1" to watch the browser (default headless).
//
// Usage:
//   node scripts/bench/run-playwright.mjs
//   BENCH_K=2 BENCH_ONLY=gmail-pull-recent node scripts/bench/run-playwright.mjs
//
// Needs a running Rawclaw app AND a real browser. It does not boot the
// app - start `npm run dev` first.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { chromium } from "playwright";

import { FIXTURES } from "./fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const resultsDir = join(here, "results");
const shotsDir = join(resultsDir, "screenshots");

// -- env loading - the gen-types.mjs pattern shared with run.mjs:
//    process.env wins, then a key in the repo .env, then a default. --
function envFile() {
  const path = join(repoRoot, ".env");
  if (!existsSync(path)) return new Map();
  const map = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 0 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    const val = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    map.set(key, val);
  }
  return map;
}
const ENV = envFile();
function env(key, fallback) {
  if (process.env[key] != null && process.env[key] !== "") {
    return process.env[key];
  }
  if (ENV.has(key)) return ENV.get(key);
  return fallback;
}

const BASE_URL = env("BENCH_BASE_URL", "http://localhost:3002").replace(
  /\/$/,
  "",
);
const EMAIL = env("BENCH_EMAIL", "pedro-onboard@rawclaw.demo");
const PASSWORD = env("BENCH_PASSWORD", "rawclaw-onboard-2026");
const K = Math.max(1, parseInt(env("BENCH_K", "5"), 10) || 5);
const TIMEOUT_MS = parseInt(env("BENCH_TIMEOUT_MS", "180000"), 10) || 180_000;
const ONLY = env("BENCH_ONLY", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OBJECTIVE = env("BENCH_OBJECTIVE", "").trim();
const HEADFUL = env("BENCH_HEADFUL", "") === "1";

// -- login through the REAL sign-in page (the tests/smoke.spec.ts
//    pattern): /auth/signin, fill email + password, click "sign in",
//    wait for the post-login redirect off the sign-in page. Throws on
//    failure so the caller can record the run as failed. --
async function login(page) {
  await page.goto(`${BASE_URL}/auth/signin`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Land anywhere off the sign-in page. A failed credential keeps us on
  // /auth/signin, so this wait throwing IS the login-failure signal.
  await page.waitForURL(/\/(org|agents|onboarding|$)/, {
    timeout: 30_000,
  });
  if (/\/auth\/signin/.test(page.url())) {
    throw new Error("login failed: still on /auth/signin after submit");
  }
}

// -- resolve agentRole -> live agent id via the authed /api/agents
//    endpoint, reusing the page's cookie session (page.request shares
//    the browser context's cookie jar). Same fallback chain as run.mjs
//    so a fixture targeting "copywriter" still binds when the org
//    seeded the head as "marketer". --
const ROLE_FALLBACK = {
  copywriter: ["copywriter", "marketer", "marketing"],
  ceo: ["ceo"],
  marketer: ["marketer", "copywriter", "marketing"],
  sdr: ["sdr", "sales"],
};

function resolveAgent(agents, fixtureRole) {
  const wanted = (fixtureRole || "").toLowerCase();
  const exact = agents.find((a) => (a.role || "").toLowerCase() === wanted);
  if (exact) return exact;
  const chain = ROLE_FALLBACK[wanted] ?? [wanted];
  for (const cand of chain) {
    const byRole = agents.find((a) => (a.role || "").toLowerCase() === cand);
    if (byRole) return byRole;
    const byDept = agents.find((a) =>
      (a.department || "").toLowerCase().includes(cand),
    );
    if (byDept) return byDept;
  }
  return null;
}

async function loadAgents(page) {
  const res = await page.request.get(`${BASE_URL}/api/agents`);
  if (!res.ok()) throw new Error(`/api/agents status ${res.status()}`);
  const j = await res.json();
  if (!Array.isArray(j.agents)) {
    throw new Error("/api/agents: no agents array");
  }
  return j.agents;
}

// -- read the orchestration timeline out of the DOM --
// The chat page (src/components/agents/AgentChatTab.tsx) renders each
// turn as a connected timeline. The selectors below mirror the data-*
// attributes that component sets:
//   [data-onboarding="agent-chat"]      the chat container
//   [data-role="user"]                  a user bubble
//   [data-role="assistant"]             the assistant reply node
//   [data-role="system"][data-kind=*]   a timeline step node
//     data-kind="thinking"              a "Reasoning" trace node
//     data-kind="running"               a live "Running X" node
//     data-kind="commands"              an executed-command node, with
//       data-card="delegation"          an agent_invoke handoff card
//       data-card="tool"                a tool_call card
//       data-card="routine"             a routine_create card
//       data-card="generic"             any other command type
//     data-kind="tasks"                 a "Tasks created" node
//     data-kind="secret"                a secret-redacted warning node
//
// The page does NOT keep the raw command type string in the DOM, so we
// map the data-card value back to the command type score.mjs grades
// (agent_invoke / tool_call / routine_create). Tool name + delegate
// target are read out of the card's visible text - score.mjs matches
// them as loose lowercased substrings, so the visible label is enough.
const CARD_TO_TYPE = {
  delegation: "agent_invoke",
  tool: "tool_call",
  routine: "routine_create",
  generic: "command",
};

// Pull the full trajectory for the most-recent turn from the live DOM.
// Runs inside the page so it can walk the rendered nodes directly.
async function readTrajectoryFromDom(page) {
  return page.evaluate((cardToType) => {
    const root =
      document.querySelector('[data-onboarding="agent-chat"]') || document.body;
    const text = (el) => (el ? (el.textContent || "").trim() : "");

    // Thinking traces: every [data-kind="thinking"] node, in order. The
    // component renders the trace text in a <p> after the "Reasoning"
    // headline; fall back to the whole node text minus the headline.
    const thinking = [];
    for (const node of root.querySelectorAll(
      '[data-role="system"][data-kind="thinking"]',
    )) {
      const p = node.querySelector("p");
      const t = p ? text(p) : text(node).replace(/^Reasoning/i, "").trim();
      if (t) thinking.push(t);
    }

    // Live "Running X" nodes - the command_running events. Kept so the
    // metrics can note how many in-flight steps the UI showed.
    const commandRunning = [];
    for (const node of root.querySelectorAll(
      '[data-role="system"][data-kind="running"]',
    )) {
      commandRunning.push({ verb: text(node), label: text(node) });
    }

    // Executed commands: every [data-kind="commands"] node, in DOM
    // order (the timeline renders them in execution order). Each node
    // is one command. data-card tells us which kind. The card's visible
    // text carries the tool label / delegate target / summary - enough
    // for score.mjs's loose substring matching.
    const commands = [];
    for (const node of root.querySelectorAll(
      '[data-role="system"][data-kind="commands"]',
    )) {
      const card = node.getAttribute("data-card") || "generic";
      const type = cardToType[card] || "command";
      const nodeText = text(node);
      // "failed" badge => the card rendered an error state.
      const ok = !/\bfailed\b/i.test(nodeText);

      let tool = null;
      let action = null;
      let delegateTo = null;

      if (card === "tool") {
        // Headline label is the tool name (apify) or "app . action"
        // (composio). The StepHeadline label is the first medium-weight
        // span in the node.
        const labelSpan = node.querySelector(".font-medium");
        const label = labelSpan ? text(labelSpan) : "";
        if (label.includes("·")) {
          const [app, act] = label.split("·").map((s) => s.trim());
          tool = app || label;
          action = act || null;
        } else {
          tool = label || null;
        }
      } else if (card === "delegation") {
        // Headline reads "Delegated <from> -> <to>". The <to> agent is
        // the last non-muted span; simplest robust read is the text
        // after the arrow.
        const headline = text(node.querySelector(".min-h-7")) || nodeText;
        const m = headline.match(/Delegated\s+(.+?)\s*[→>-]+\s*(.+)/i);
        if (m) delegateTo = m[2].split(/\s{2,}/)[0].trim();
      }

      commands.push({
        type,
        ok,
        // The card's visible text is the summary; score.mjs greps it.
        summary: nodeText,
        tool,
        action,
        delegateTo,
        // argsText: the whole card text, so any expected arg substring
        // (a handle, a count) the UI rendered is matchable.
        argsText: nodeText.slice(0, 4000),
        resultPreview: null,
        delegatedOutput: null,
      });
    }

    // The assistant reply: the [data-role="assistant"] node's bubble.
    const assistantNodes = root.querySelectorAll('[data-role="assistant"]');
    const replyNode = assistantNodes[assistantNodes.length - 1] || null;
    const reply = replyNode ? text(replyNode) : "";

    // A rendered error banner (.text-destructive) means the UI errored.
    const errorBanner = document.querySelector(".text-destructive");
    const errorMessage = errorBanner ? text(errorBanner) : null;

    return {
      thinking,
      commandRunning,
      commands,
      reply,
      errored: Boolean(errorMessage),
      errorMessage,
      // The DOM has no explicit "done" marker. The caller proves the
      // stream finished by waiting for the input to re-enable; if it
      // got this far without timing out, the turn closed.
      sawDone: true,
      secretRedactions: [],
    };
  }, CARD_TO_TYPE);
}

// -- one run of one fixture --
// Logs in fresh, navigates to the fixture's agent chat page, optionally
// replays a prior thread (for followUpOf recall fixtures), types the
// prompt, submits, waits for the streamed reply to settle, then reads
// the trajectory from the DOM and captures a screenshot. Any failure
// (login, page-load timeout, stream-never-finishes) is caught and
// returned as a failed run - it never throws to the caller.
async function runOnce(browser, fixture, agentId, priorHistory, runIndex) {
  const t0 = Date.now();
  const shotPath = join(shotsDir, `${fixture.id}-${runIndex}.png`);
  let context = null;
  let page = null;

  try {
    context = await browser.newContext({ baseURL: BASE_URL });
    page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    // 1. log in through the real sign-in page.
    await login(page);

    // 2. navigate to the agent's chat page. Chat is the default tab on
    //    /agents/[id], so the URL lands straight on AgentChatTab.
    await page.goto(`${BASE_URL}/agents/${agentId}`, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUT_MS,
    });
    const chatRoot = page.locator('[data-onboarding="agent-chat"]');
    await chatRoot.waitFor({ state: "visible", timeout: 30_000 });

    // The chat input. AgentChatTab renders a textarea placeholder
    // "Talk to this agent..." and a send button aria-label="Send
    // message". The textarea is disabled while a turn streams, so
    // waiting for it to be editable is the "ready / stream-finished"
    // signal.
    const input = page.getByPlaceholder(/talk to this agent/i);
    const sendBtn = page.getByRole("button", { name: /send message/i });
    await input.waitFor({ state: "visible", timeout: 30_000 });

    // 3. replay any prior thread a followUpOf recall fixture needs, so
    //    the recall question has a real conversation to recall from.
    //    Each prior user turn is sent through the same UI path and we
    //    wait for its reply to settle before the next.
    for (const turn of priorHistory) {
      if (turn.role !== "user") continue;
      await input.waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForFunction(
        () => {
          const el = document.querySelector(
            'textarea[placeholder*="Talk to this agent"]',
          );
          return el && !el.disabled;
        },
        undefined,
        { timeout: TIMEOUT_MS },
      );
      await input.fill(turn.content);
      await sendBtn.click();
      // wait for the turn to stream and the input to re-enable.
      await page.waitForFunction(
        () => {
          const el = document.querySelector(
            'textarea[placeholder*="Talk to this agent"]',
          );
          return el && !el.disabled;
        },
        undefined,
        { timeout: TIMEOUT_MS },
      );
    }

    // 4. send the fixture prompt. Count assistant nodes before so we
    //    can confirm a new one landed.
    const beforeCount = await page
      .locator('[data-role="assistant"]')
      .count();

    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          'textarea[placeholder*="Talk to this agent"]',
        );
        return el && !el.disabled;
      },
      undefined,
      { timeout: TIMEOUT_MS },
    );
    await input.fill(fixture.prompt);
    await sendBtn.click();

    // 5. wait for the streamed reply to FINISH. The component disables
    //    the textarea for the whole turn (streaming || uploading) and
    //    re-enables it when the stream closes. That edge is the
    //    "stream finished" signal. A turn that never finishes hits
    //    TIMEOUT_MS here and is recorded as a failed run.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          'textarea[placeholder*="Talk to this agent"]',
        );
        if (!el || el.disabled) return false;
        // also require the streaming dots to be gone - the assistant
        // bubble shows an aria-label="Streaming reply" placeholder
        // until the first/again settled. Once input is enabled AND no
        // streaming indicator remains, the turn is done.
        return !document.querySelector('[aria-label="Streaming reply"]');
      },
      undefined,
      { timeout: TIMEOUT_MS },
    );

    // small settle so the final command cards + reply markdown have
    // painted before we read the DOM.
    await page.waitForTimeout(300);

    // 6. read the trajectory back out of the rendered DOM.
    const traj = await readTrajectoryFromDom(page);
    const latencyMs = Date.now() - t0;

    // confirm a fresh assistant node actually rendered. If not, the UI
    // dropped the reply even though the stream closed - that is a real
    // UI failure this runner exists to catch.
    const afterCount = await page
      .locator('[data-role="assistant"]')
      .count();
    const renderedReply = afterCount > beforeCount && traj.reply.trim().length > 0;

    // 7. screenshot the finished turn.
    try {
      await page.screenshot({ path: shotPath, fullPage: true });
    } catch {
      // a screenshot failure must not fail the run.
    }

    const ok = !traj.errored && traj.sawDone && renderedReply;

    return {
      ok,
      latencyMs,
      httpStatus: 200,
      transportError: ok
        ? null
        : traj.errored
          ? `ui error: ${traj.errorMessage}`
          : !renderedReply
            ? "no assistant reply rendered"
            : "stream did not complete",
      screenshot: shotPath,
      trajectory: {
        thinking: traj.thinking,
        commandRunning: traj.commandRunning,
        commands: traj.commands,
        reply: traj.reply,
        errored: traj.errored,
        errorMessage: traj.errorMessage,
        sawDone: traj.sawDone,
        secretRedactions: traj.secretRedactions,
      },
      // system metrics, the same block shape run.mjs writes so
      // score.mjs aggregates it unchanged.
      metrics: {
        latencyMs,
        commandCount: traj.commands.length,
        thinkingCount: traj.thinking.length,
        errored: traj.errored,
        // recovered: the UI showed an error but still rendered a
        // non-empty reply for the turn.
        recovered:
          traj.errored && traj.reply.trim().length > 0 && renderedReply,
      },
    };
  } catch (err) {
    // login failure, page-load timeout, stream-never-finishes - all
    // land here. Try a best-effort screenshot of the failed state,
    // then record this run as failed and let the suite continue.
    let shot = null;
    try {
      if (page) {
        await page.screenshot({ path: shotPath, fullPage: true });
        shot = shotPath;
      }
    } catch {
      // ignore - the page may already be gone.
    }
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      httpStatus: 0,
      transportError: String(err?.message ?? err),
      screenshot: shot,
      trajectory: null,
    };
  } finally {
    // each run gets a fresh context (fresh cookie jar / login) so a
    // poisoned session never leaks into the next run.
    try {
      if (context) await context.close();
    } catch {
      // ignore close errors.
    }
  }
}

// -- build the history a followUp fixture needs from a base run --
// Same contract as run.mjs: run i of a follow-up pairs with run i of
// its base, replaying the base prompt + the reply that base run
// actually produced so the recall question has real content.
function historyFor(fixture, baseRunsById) {
  if (!fixture.followUpOf) return [];
  const baseRuns = baseRunsById.get(fixture.followUpOf);
  if (!baseRuns || baseRuns.length === 0) return [];
  return baseRuns;
}

async function main() {
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

  // pick the fixture subset - same selection logic as run.mjs.
  let selected = FIXTURES;
  if (ONLY.length > 0) {
    selected = selected.filter((f) => ONLY.includes(f.id));
  }
  if (OBJECTIVE) {
    selected = selected.filter((f) => f.objective === OBJECTIVE);
  }
  if (selected.length === 0) {
    console.error("No fixtures matched BENCH_ONLY / BENCH_OBJECTIVE.");
    process.exit(1);
  }

  // followUp fixtures need their base in the run set so the recall
  // thread is real - pull any missing bases in, run bases first.
  const byId = new Map(FIXTURES.map((f) => [f.id, f]));
  const need = new Set(selected.map((f) => f.id));
  for (const f of selected) {
    if (f.followUpOf && !need.has(f.followUpOf)) {
      need.add(f.followUpOf);
    }
  }
  selected = [...need]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.followUpOf && a.followUpOf === b.id) return 1;
      if (b.followUpOf && b.followUpOf === a.id) return -1;
      return 0;
    });

  console.log(
    `Rawclaw agent benchmark - Playwright runner\n` +
      `  base URL : ${BASE_URL}\n` +
      `  operator : ${EMAIL}\n` +
      `  fixtures : ${selected.length}\n` +
      `  k        : ${K}\n` +
      `  browser  : chromium (${HEADFUL ? "headful" : "headless"})\n`,
  );

  // spawn our OWN headless Chromium - not a shared / MCP browser.
  const browser = await chromium.launch({ headless: !HEADFUL });

  // resolve every fixture's target agent up front so a missing role
  // fails loudly before we burn k browser sessions. One throwaway
  // context just for the /api/agents lookup.
  let agentByFixture;
  try {
    const probeCtx = await browser.newContext({ baseURL: BASE_URL });
    const probePage = await probeCtx.newPage();
    probePage.setDefaultTimeout(TIMEOUT_MS);
    await login(probePage);
    const agents = await loadAgents(probePage);
    console.log(`Loaded ${agents.length} agents from /api/agents.\n`);
    agentByFixture = new Map();
    for (const f of selected) {
      const agent = resolveAgent(agents, f.agentRole);
      if (!agent) {
        console.error(
          `Fixture ${f.id}: no live agent for role "${f.agentRole}". ` +
            `Available roles: ${[...new Set(agents.map((a) => a.role))].join(", ")}`,
        );
        await probeCtx.close();
        await browser.close();
        process.exit(1);
      }
      agentByFixture.set(f.id, agent);
    }
    await probeCtx.close();
  } catch (err) {
    console.error(
      `\nSetup failed (login / agent resolve): ${err?.message ?? err}`,
    );
    await browser.close();
    process.exit(1);
  }

  // baseHistoryById[fixtureId] = array of message-history arrays, one
  // per run index, captured from that fixture's runs for its followers.
  const baseHistoryById = new Map();
  const taskResults = [];

  for (const fixture of selected) {
    const agent = agentByFixture.get(fixture.id);
    process.stdout.write(
      `[${fixture.id}] -> ${agent.name} (${agent.role}) x${K}  `,
    );
    const runs = [];
    const myHistoriesForFollowers = [];

    for (let i = 0; i < K; i++) {
      const priorHistory = historyFor(fixture, baseHistoryById)[i] ?? [];
      let run;
      try {
        run = await runOnce(browser, fixture, agent.id, priorHistory, i);
      } catch (err) {
        // runOnce already catches its own failures, but guard anyway so
        // one bad run can never crash the whole suite.
        run = {
          ok: false,
          latencyMs: 0,
          httpStatus: 0,
          transportError: String(err?.message ?? err),
          screenshot: null,
          trajectory: null,
        };
      }
      runs.push(run);
      process.stdout.write(run.ok ? "." : "x");

      // capture this run's thread (prior + prompt + actual reply) so a
      // follow-up fixture's run i has a real prior conversation.
      const replyText = run.trajectory?.reply ?? "";
      myHistoriesForFollowers.push([
        ...priorHistory,
        { role: "user", content: fixture.prompt },
        { role: "assistant", content: replyText },
      ]);
    }
    baseHistoryById.set(fixture.id, myHistoriesForFollowers);

    taskResults.push({
      id: fixture.id,
      objective: fixture.objective,
      kind: fixture.kind,
      agentRole: fixture.agentRole,
      agent: { id: agent.id, name: agent.name, role: agent.role },
      prompt: fixture.prompt,
      followUpOf: fixture.followUpOf ?? null,
      expect: fixture.expect,
      rubric: fixture.rubric,
      runs,
    });
    process.stdout.write("\n");
  }

  await browser.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // .pw.json - still ends in .json so score.mjs picks it up, the .pw.
  // marks it as the browser-driven run.
  const outPath = join(resultsDir, `${stamp}.pw.json`);
  const payload = {
    meta: {
      benchmark: "rawclaw-agentic-eval",
      version: 1,
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      operator: EMAIL,
      k: K,
      fixtureCount: selected.length,
      gitCommit: env("BENCH_GIT_COMMIT", null),
      runner: "playwright",
    },
    tasks: taskResults,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const totalRuns = taskResults.reduce((n, t) => n + t.runs.length, 0);
  const okRuns = taskResults.reduce(
    (n, t) => n + t.runs.filter((r) => r.ok).length,
    0,
  );
  console.log(
    `\nDone. ${okRuns}/${totalRuns} runs drove the UI to a finished reply.\n` +
      `Screenshots: ${shotsDir}\n` +
      `Raw results: ${outPath}\n` +
      `Score them:  node scripts/bench/score.mjs ${outPath}`,
  );
}

main().catch((err) => {
  console.error("\nPlaywright benchmark run failed:", err?.stack ?? err);
  process.exit(1);
});
