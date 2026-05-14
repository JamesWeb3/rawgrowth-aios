// Rawclaw agent benchmark - runner.
//
// Drives the FIXTURES (scripts/bench/fixtures.mjs) through the REAL
// Rawclaw harness: it logs in, resolves each fixture's agentRole to a
// live agent id, and POSTs to /api/agents/[id]/chat - the same chat +
// command-extraction + two-pass executor path the dashboard uses. It
// does NOT call raw Claude: per the methodology, the harness itself is
// part of what we measure.
//
// Each fixture runs k times (BENCH_K, default 5) so score.mjs can
// report pass-rate AND pass^k (tau-bench reliability metric). For each
// run it captures:
//   - the final operator-visible reply,
//   - the trajectory: every thinking trace, command (tool_call /
//     agent_invoke / routine_create) with type + args + order, and the
//     commands_executed results,
//   - system metrics: latency, command-call count, errored / recovered.
//
// Raw results land in scripts/bench/results/<timestamp>.json. Nothing
// here scores - run score.mjs on that file next.
//
// ── Environment (read from process.env or the repo .env, gen-types
//    style) ──
//   BENCH_BASE_URL    base URL of a running Rawclaw app.
//                     Default http://localhost:3002 (the dev server).
//   BENCH_EMAIL       operator login email for the target org.
//                     Default pedro-onboard@rawclaw.demo (the seed
//                     account the other e2e scripts use).
//   BENCH_PASSWORD    that account's password.
//                     Default rawclaw-onboard-2026.
//   BENCH_K           runs per fixture. Default 5.
//   BENCH_TIMEOUT_MS  per-request timeout. Default 180000.
//   BENCH_ONLY        comma-separated fixture ids to run a subset.
//   BENCH_OBJECTIVE   run only fixtures whose objective matches.
//
// Usage:
//   node scripts/bench/run.mjs
//   BENCH_K=3 BENCH_ONLY=gmail-pull-recent node scripts/bench/run.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { FIXTURES } from "./fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const resultsDir = join(here, "results");

// ── env loading - the gen-types.mjs pattern: process.env wins, then
//    fall back to a key in the repo .env, then a hard default. ──
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

// ── cookie jar (e2e-curl.mjs pattern) ──
const COOKIE_JAR = new Map();
function setCookies(setCookieHeader) {
  if (!setCookieHeader) return;
  const lines = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader];
  for (const c of lines) {
    const m = c.match(/^([^=;]+)=([^;]*)/);
    if (m) COOKIE_JAR.set(m[1].trim(), m[2].trim());
  }
}
function cookieHeader() {
  return Array.from(COOKIE_JAR.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function fetchTimed(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const r = await fetch(BASE_URL + path, {
      ...opts,
      headers: { ...(opts.headers ?? {}), cookie: cookieHeader() },
      redirect: "manual",
      signal: ctrl.signal,
    });
    const sc = r.headers.getSetCookie?.() ?? r.headers.get("set-cookie");
    setCookies(sc);
    return r;
  } finally {
    clearTimeout(timer);
  }
}

// ── login: NextAuth credentials flow, same as e2e-curl.mjs ──
async function login() {
  const csrfRes = await fetchTimed("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();
  if (!csrfToken) throw new Error("no csrfToken from /api/auth/csrf");
  const form = new URLSearchParams({
    csrfToken,
    email: EMAIL,
    password: PASSWORD,
    json: "true",
    callbackUrl: BASE_URL + "/",
  });
  const r = await fetchTimed("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (r.status !== 302 && r.status !== 200) {
    throw new Error(`login failed: status ${r.status}`);
  }
  if (COOKIE_JAR.size === 0) throw new Error("login set no cookies");
}

// ── resolve agentRole -> live agent id via /api/agents ──
// Atlas is role "ceo". Dept heads use their seed role string. We match
// role exactly first, then fall back to a department-name contains so a
// fixture targeting "copywriter" still binds if the org seeded the head
// as "marketer" / a Marketing department head.
async function loadAgents() {
  const r = await fetchTimed("/api/agents");
  if (!r.ok) throw new Error(`/api/agents status ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j.agents)) throw new Error("/api/agents: no agents array");
  return j.agents;
}

const ROLE_FALLBACK = {
  // fixture role -> ordered list of acceptable live roles / dept hints
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

// ── parse the chat route's newline-delimited JSON event stream ──
// Events (see src/app/api/agents/[id]/chat/route.ts POST):
//   {type:"secret_redacted"} {type:"thinking",brief} {type:"command_running"}
//   {type:"text",delta} {type:"tasks_created"} {type:"commands_executed"}
//   {type:"error",message} {type:"done"}
async function readEventStream(res) {
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // partial / non-JSON line - skip, the next chunk completes it
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      events.push(JSON.parse(tail));
    } catch {
      /* ignore trailing partial */
    }
  }
  return events;
}

// ── turn the raw event list into a trajectory + metrics record ──
// The trajectory is the ordered list of commands the harness executed
// this turn plus the thinking traces. score.mjs reads `commands` for the
// trajectory metrics (right tool / right args / right delegate / order).
function buildTrajectory(events) {
  const thinking = [];
  const commandRunning = [];
  const commands = [];
  const textDeltas = [];
  let errored = false;
  let errorMessage = null;
  let sawDone = false;
  const secretRedactions = [];

  for (const ev of events) {
    if (ev.type === "thinking" && ev.brief) {
      thinking.push(String(ev.brief));
    } else if (ev.type === "command_running") {
      commandRunning.push({ verb: ev.verb ?? "", label: ev.label ?? "" });
    } else if (ev.type === "commands_executed") {
      const results = Array.isArray(ev.results) ? ev.results : [];
      for (const r of results) {
        const detail = r.detail ?? {};
        commands.push({
          type: r.type ?? "command",
          ok: r.ok !== false,
          summary: r.summary ?? "",
          // The harness exposes the structured payload the orchestration
          // cards render. We keep the bits score.mjs needs to grade the
          // trajectory: which composio/apify tool, which delegate, the
          // result preview, and the delegated agent's real output.
          tool: detail.tool ?? detail.app ?? null,
          action: detail.action ?? null,
          delegateTo: detail.agent ?? detail.assignee_name ?? null,
          argsText: JSON.stringify(detail).slice(0, 4000),
          resultPreview:
            typeof detail.result_preview === "string"
              ? detail.result_preview.slice(0, 4000)
              : null,
          delegatedOutput:
            typeof detail.delegated_output === "string"
              ? detail.delegated_output.slice(0, 4000)
              : null,
        });
      }
    } else if (ev.type === "text" && typeof ev.delta === "string") {
      textDeltas.push(ev.delta);
    } else if (ev.type === "error") {
      errored = true;
      errorMessage = ev.message ?? "error";
    } else if (ev.type === "done") {
      sawDone = true;
    } else if (ev.type === "secret_redacted") {
      secretRedactions.push(...(ev.hits ?? []));
    }
  }

  return {
    thinking,
    commandRunning,
    commands,
    reply: textDeltas.join(""),
    errored,
    errorMessage,
    sawDone,
    secretRedactions,
  };
}

// ── one run of one fixture ──
async function runOnce(fixture, agentId, priorHistory) {
  // followUpOf fixtures carry the prior thread so recall tasks can ask
  // "what did the 2nd email say?" without a fresh fetch. The chat route
  // treats the last user turn as new and everything before as history.
  const messages = [
    ...priorHistory,
    { role: "user", content: fixture.prompt },
  ];

  const t0 = Date.now();
  let res;
  try {
    res = await fetchTimed(`/api/agents/${agentId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      httpStatus: 0,
      transportError: String(err?.message ?? err),
      trajectory: null,
    };
  }

  if (res.status !== 200) {
    let bodyText = "";
    try {
      bodyText = (await res.text()).slice(0, 500);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      httpStatus: res.status,
      transportError: `non-200: ${bodyText}`,
      trajectory: null,
    };
  }

  const events = await readEventStream(res);
  const traj = buildTrajectory(events);
  const latencyMs = Date.now() - t0;

  return {
    ok: !traj.errored && traj.sawDone,
    latencyMs,
    httpStatus: 200,
    transportError: null,
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
    // system metrics, per the spec's "System metrics" leg
    metrics: {
      latencyMs,
      commandCount: traj.commands.length,
      thinkingCount: traj.thinking.length,
      errored: traj.errored,
      // recovered: the harness emitted an error event but still produced
      // a non-empty reply and closed the stream cleanly.
      recovered: traj.errored && traj.reply.trim().length > 0 && traj.sawDone,
    },
    rawEvents: events,
  };
}

// ── build the history a followUp fixture needs from a base run ──
// We seed it with the base fixture's prompt + the reply that base run
// actually produced, so the follow-up's recall question has something
// real to recall. Run i of the follow-up pairs with run i of its base.
function historyFor(fixture, baseRunsById) {
  if (!fixture.followUpOf) return [];
  const baseRuns = baseRunsById.get(fixture.followUpOf);
  if (!baseRuns || baseRuns.length === 0) return [];
  return baseRuns;
}

async function main() {
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  // pick the fixture subset
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

  // followUp fixtures need their base fixture in the run set - pull any
  // missing bases in so the recall thread is real.
  const byId = new Map(FIXTURES.map((f) => [f.id, f]));
  const need = new Set(selected.map((f) => f.id));
  for (const f of selected) {
    if (f.followUpOf && !need.has(f.followUpOf)) {
      need.add(f.followUpOf);
      selected = [byId.get(f.followUpOf), ...selected];
    }
  }
  // run bases before their followers
  selected = [...need]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.followUpOf && a.followUpOf === b.id) return 1;
      if (b.followUpOf && b.followUpOf === a.id) return -1;
      return 0;
    });

  console.log(
    `Rawclaw agent benchmark - runner\n` +
      `  base URL : ${BASE_URL}\n` +
      `  operator : ${EMAIL}\n` +
      `  fixtures : ${selected.length}\n` +
      `  k        : ${K}\n`,
  );

  console.log("Logging in...");
  await login();
  console.log(`  ok, ${COOKIE_JAR.size} cookies\n`);

  const agents = await loadAgents();
  console.log(`Loaded ${agents.length} agents from /api/agents.\n`);

  // resolve every fixture's target agent up front so a missing role
  // fails loudly before we burn k LLM calls.
  const agentByFixture = new Map();
  for (const f of selected) {
    const agent = resolveAgent(agents, f.agentRole);
    if (!agent) {
      console.error(
        `Fixture ${f.id}: no live agent for role "${f.agentRole}". ` +
          `Available roles: ${[...new Set(agents.map((a) => a.role))].join(", ")}`,
      );
      process.exit(1);
    }
    agentByFixture.set(f.id, agent);
  }

  // baseRunsById[fixtureId] = array of message-history arrays, one per
  // run index, captured from that fixture's runs for its followers.
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
        run = await runOnce(fixture, agent.id, priorHistory);
      } catch (err) {
        run = {
          ok: false,
          latencyMs: 0,
          httpStatus: 0,
          transportError: String(err?.message ?? err),
          trajectory: null,
        };
      }
      runs.push(run);
      process.stdout.write(run.ok ? "." : "x");

      // capture this run's thread (prompt + actual reply) so a follow-up
      // fixture's run i has a real prior conversation to recall from.
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

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(resultsDir, `${stamp}.json`);
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
    `\nDone. ${okRuns}/${totalRuns} runs completed without a transport/stream error.\n` +
      `Raw results: ${outPath}\n` +
      `Score them:  node scripts/bench/score.mjs ${outPath}`,
  );
}

main().catch((err) => {
  console.error("\nbenchmark run failed:", err?.stack ?? err);
  process.exit(1);
});
