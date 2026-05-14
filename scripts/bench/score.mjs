// Rawclaw agent benchmark - scorer.
//
// Takes a raw results file written by run.mjs and produces the
// benchmark scorecard. Three scoring legs, all from the 2026
// agentic-eval methodology (see README.md):
//
//   1. Deterministic checks   - per run, per task: did the harness call
//      the right tool, with the right args, delegate to the right
//      agent, in the right order; did the reply contain / exclude what
//      it should; did a recall task answer with zero new commands. Each
//      run is pass/fail. Per task we report pass-rate (fraction of k
//      runs that pass) AND pass^k (1.0 only if ALL k runs pass) - the
//      tau-bench reliability metric.
//
//   2. Trajectory correctness - a finer breakdown of leg 1: rightTool,
//      rightArgs, rightDelegate, rightOrder, each scored 0..1 averaged
//      over the k runs. The 2026 eval consensus is that the signal is
//      in the intermediate steps, not just the final answer.
//
//   3. LLM-as-judge           - for rubric + hybrid tasks, a judge model
//      rubric-scores each run's reply 0..10 against the fixture's
//      rubric string. Uses the @anthropic-ai/sdk already in the repo.
//      Needs ANTHROPIC_API_KEY; without it, rubric scoring is skipped
//      and the scorecard says so.
//
// System metrics (latency, command count, errored / recovered rate)
// are aggregated straight from run.mjs's per-run metrics block.
//
// Output: a summary table to stdout + a full
// scripts/bench/results/<timestamp>.scored.json next to the input.
//
// ── Environment ──
//   ANTHROPIC_API_KEY   enables the LLM-as-judge. Read from env or the
//                       repo .env. Without it, hybrid tasks are graded
//                       on their deterministic leg only and rubric-only
//                       tasks are reported as "unjudged".
//   BENCH_JUDGE_MODEL   judge model id. Default claude-sonnet-4-5.
//
// Usage:
//   node scripts/bench/score.mjs scripts/bench/results/<timestamp>.json
//   node scripts/bench/score.mjs            (scores the newest results file)

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { BANNED_WORDS } from "./fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const resultsDir = join(here, "results");

// ── env loading (gen-types.mjs pattern, shared with run.mjs) ──
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

const JUDGE_MODEL = env("BENCH_JUDGE_MODEL", "claude-sonnet-4-5");
const ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", null);

// ── locate the results file: argv[2], or the newest *.json that is not
//    already a *.scored.json ──
function pickResultsFile() {
  const arg = process.argv[2];
  if (arg) {
    if (!existsSync(arg)) {
      console.error(`Results file not found: ${arg}`);
      process.exit(1);
    }
    return arg;
  }
  if (!existsSync(resultsDir)) {
    console.error(`No results dir yet - run scripts/bench/run.mjs first.`);
    process.exit(1);
  }
  const candidates = readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".scored.json"))
    .map((f) => join(resultsDir, f))
    .sort();
  if (candidates.length === 0) {
    console.error(`No raw results in ${resultsDir} - run run.mjs first.`);
    process.exit(1);
  }
  return candidates[candidates.length - 1];
}

// ── helpers ──
const lc = (s) => String(s ?? "").toLowerCase();

/** All command-arg text + summaries for one run, lowercased. */
function commandHaystack(commands) {
  return commands
    .map((c) =>
      [c.type, c.tool, c.action, c.delegateTo, c.summary, c.argsText]
        .filter(Boolean)
        .join(" "),
    )
    .join(" \n ")
    .toLowerCase();
}

/** Full reply + delegated outputs + result previews, lowercased - the
 *  text the operator (and a follow-up turn) actually sees / can use. */
function replyHaystack(trajectory) {
  if (!trajectory) return "";
  const parts = [trajectory.reply ?? ""];
  for (const c of trajectory.commands ?? []) {
    if (c.delegatedOutput) parts.push(c.delegatedOutput);
    if (c.resultPreview) parts.push(c.resultPreview);
  }
  return parts.join(" \n ").toLowerCase();
}

// ── leg 1 + 2: deterministic checks + trajectory correctness ──
// Returns { pass, checks: [...], trajectory: {rightTool,...} }.
function scoreRunDeterministic(expect, run) {
  const checks = [];
  const traj = run.trajectory;
  const commands = traj?.commands ?? [];
  const cmdHay = commandHaystack(commands);
  const replyText = traj?.reply ?? "";
  const replyHay = replyHaystack(traj);
  const thinkingText = (traj?.thinking ?? []).join(" ");

  // a run that never produced a clean stream fails everything
  if (!run.ok || !traj) {
    checks.push({
      name: "stream-completed",
      pass: false,
      detail: run.transportError ?? traj?.errorMessage ?? "no clean stream",
    });
    return {
      pass: false,
      checks,
      trajectory: {
        rightTool: 0,
        rightArgs: 0,
        rightDelegate: 0,
        rightOrder: 0,
      },
    };
  }
  checks.push({ name: "stream-completed", pass: true });

  let rightTool = 1;
  let rightArgs = 1;
  let rightDelegate = 1;
  let rightOrder = 1;

  // toolCalled: a command of this type must exist
  if (expect.toolCalled) {
    const has = commands.some((c) => c.type === expect.toolCalled);
    rightTool = has ? 1 : 0;
    checks.push({
      name: `command:${expect.toolCalled}`,
      pass: has,
      detail: has ? undefined : `no ${expect.toolCalled} in trajectory`,
    });
  }

  // toolName: the named composio/apify tool must appear in the args
  if (expect.toolName) {
    const want = lc(expect.toolName);
    const has = cmdHay.includes(want);
    rightTool = rightTool && has ? 1 : 0;
    checks.push({
      name: `tool:${expect.toolName}`,
      pass: has,
      detail: has ? undefined : `tool "${expect.toolName}" not in command args`,
    });
  }

  // args: every substring must appear somewhere in the command args
  if (Array.isArray(expect.args) && expect.args.length > 0) {
    const missing = expect.args.filter((a) => !cmdHay.includes(lc(a)));
    const has = missing.length === 0;
    rightArgs = has ? 1 : 0;
    checks.push({
      name: "args",
      pass: has,
      detail: has ? undefined : `missing args: ${missing.join(", ")}`,
    });
  }

  // delegateTo: an agent_invoke must name this target
  if (expect.delegateTo) {
    const want = lc(expect.delegateTo);
    const invokes = commands.filter((c) => c.type === "agent_invoke");
    const has = invokes.some(
      (c) =>
        lc(c.delegateTo).includes(want) ||
        lc(c.summary).includes(want) ||
        lc(c.argsText).includes(want),
    );
    rightDelegate = has ? 1 : 0;
    checks.push({
      name: `delegate:${expect.delegateTo}`,
      pass: has,
      detail: has ? undefined : `no agent_invoke targeting "${expect.delegateTo}"`,
    });
  }

  // order: the listed command types must appear in this relative order
  if (Array.isArray(expect.order) && expect.order.length > 0) {
    const seq = commands.map((c) => c.type);
    let idx = 0;
    for (const t of seq) {
      if (idx < expect.order.length && t === expect.order[idx]) idx++;
    }
    const has = idx === expect.order.length;
    rightOrder = has ? 1 : 0;
    checks.push({
      name: "order",
      pass: has,
      detail: has
        ? undefined
        : `expected order ${expect.order.join(" -> ")}, got ${seq.join(" -> ") || "(none)"}`,
    });
  }

  // noNewCommand: recall tasks must answer with zero command blocks
  if (expect.noNewCommand) {
    const has = commands.length === 0;
    checks.push({
      name: "no-new-command",
      pass: has,
      detail: has
        ? undefined
        : `recall task emitted ${commands.length} command(s)`,
    });
  }

  // replyIncludes: substrings the final reply must contain
  if (Array.isArray(expect.replyIncludes) && expect.replyIncludes.length > 0) {
    const missing = expect.replyIncludes.filter(
      (s) => !replyHay.includes(lc(s)),
    );
    checks.push({
      name: "reply-includes",
      pass: missing.length === 0,
      detail: missing.length === 0 ? undefined : `missing: ${missing.join(", ")}`,
    });
  }

  // replyExcludes: substrings the final reply must NOT contain
  if (Array.isArray(expect.replyExcludes) && expect.replyExcludes.length > 0) {
    const present = expect.replyExcludes.filter((s) =>
      lc(replyText).includes(lc(s)),
    );
    checks.push({
      name: "reply-excludes",
      pass: present.length === 0,
      detail: present.length === 0 ? undefined : `present: ${present.join(", ")}`,
    });
  }

  // banned brand-voice words - every reply, always
  const bannedHits = BANNED_WORDS.filter((w) => lc(replyText).includes(w));
  checks.push({
    name: "no-banned-words",
    pass: bannedHits.length === 0,
    detail: bannedHits.length === 0 ? undefined : `banned: ${bannedHits.join(", ")}`,
  });

  // minThinking: the reasoning trace must be at least this long
  if (typeof expect.minThinking === "number") {
    const has = thinkingText.trim().length >= expect.minThinking;
    checks.push({
      name: "thinking-trace",
      pass: has,
      detail: has
        ? undefined
        : `thinking ${thinkingText.trim().length} chars < ${expect.minThinking}`,
    });
  }

  // the reply must not be empty
  checks.push({
    name: "non-empty-reply",
    pass: replyText.trim().length > 0,
    detail: replyText.trim().length > 0 ? undefined : "empty reply",
  });

  const pass = checks.every((c) => c.pass);
  return {
    pass,
    checks,
    trajectory: { rightTool, rightArgs, rightDelegate, rightOrder },
  };
}

// ── leg 3: LLM-as-judge ──
let anthropicClient = null;
async function getAnthropic() {
  if (!ANTHROPIC_API_KEY) return null;
  if (anthropicClient) return anthropicClient;
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default ?? mod.Anthropic;
  anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return anthropicClient;
}

const JUDGE_SYSTEM =
  "You are a strict evaluator scoring an AI agent's reply against a rubric. " +
  "You output ONLY a JSON object, no prose, of the shape " +
  '{"score": <integer 0-10>, "reason": "<one sentence>"}. ' +
  "Score exactly as the rubric describes. Do not be generous. If the reply " +
  "fabricated data, left raw <command> XML in, or dodged the task, score low.";

async function judgeRun(client, task, run) {
  const traj = run.trajectory;
  const reply = traj?.reply ?? "";
  const delegated = (traj?.commands ?? [])
    .map((c) => c.delegatedOutput || c.resultPreview)
    .filter(Boolean)
    .join("\n---\n")
    .slice(0, 4000);
  const thinking = (traj?.thinking ?? []).join(" | ").slice(0, 1000);

  const userBlock = [
    `OPERATOR PROMPT:\n${task.prompt}`,
    task.followUpOf
      ? `(this is a follow-up turn in a thread - prior context was available to the agent)`
      : null,
    `\nRUBRIC:\n${task.rubric}`,
    `\nAGENT THINKING TRACE:\n${thinking || "(none)"}`,
    delegated ? `\nTOOL / DELEGATED RESULTS THE AGENT HAD:\n${delegated}` : null,
    `\nAGENT FINAL REPLY:\n${reply || "(empty)"}`,
    `\nScore 0-10 per the rubric. Output only the JSON object.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 256,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: userBlock }],
    });
    const text = (res.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { score: null, reason: `judge gave no JSON: ${text.slice(0, 120)}` };
    const parsed = JSON.parse(m[0]);
    let score = Number(parsed.score);
    if (!Number.isFinite(score)) return { score: null, reason: "judge score NaN" };
    score = Math.max(0, Math.min(10, Math.round(score)));
    return { score, reason: String(parsed.reason ?? "").slice(0, 240) };
  } catch (err) {
    return { score: null, reason: `judge call failed: ${String(err?.message ?? err)}` };
  }
}

// ── aggregate ──
function mean(nums) {
  const xs = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function fmtPct(x) {
  return x == null ? "  -  " : `${(x * 100).toFixed(0)}%`.padStart(5);
}
function fmtNum(x, d = 1) {
  return x == null ? "  -  " : x.toFixed(d).padStart(5);
}

async function main() {
  const inPath = pickResultsFile();
  const raw = JSON.parse(readFileSync(inPath, "utf8"));
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  if (tasks.length === 0) {
    console.error("Results file has no tasks.");
    process.exit(1);
  }

  const client = await getAnthropic();
  const judgeOn = Boolean(client);

  console.log(
    `Rawclaw agent benchmark - scorer\n` +
      `  input    : ${inPath}\n` +
      `  k        : ${raw.meta?.k ?? "?"}\n` +
      `  judge    : ${judgeOn ? `on (${JUDGE_MODEL})` : "OFF (no ANTHROPIC_API_KEY) - rubric tasks unjudged"}\n`,
  );

  const scoredTasks = [];

  for (const task of tasks) {
    const runScores = [];
    for (const run of task.runs) {
      const det = scoreRunDeterministic(task.expect ?? {}, run);
      let judge = null;
      if (judgeOn && (task.kind === "rubric" || task.kind === "hybrid")) {
        judge = await judgeRun(client, task, run);
      }
      runScores.push({
        ok: run.ok,
        deterministicPass: det.pass,
        checks: det.checks,
        trajectory: det.trajectory,
        judge,
        metrics: run.metrics ?? null,
      });
    }

    const k = runScores.length;
    const detPasses = runScores.filter((r) => r.deterministicPass).length;
    const passRate = k > 0 ? detPasses / k : null;
    // pass^k: 1.0 only if EVERY run passed (tau-bench reliability metric)
    const passPowK = k > 0 && detPasses === k ? 1 : 0;

    const traj = {
      rightTool: mean(runScores.map((r) => r.trajectory.rightTool)),
      rightArgs: mean(runScores.map((r) => r.trajectory.rightArgs)),
      rightDelegate: mean(runScores.map((r) => r.trajectory.rightDelegate)),
      rightOrder: mean(runScores.map((r) => r.trajectory.rightOrder)),
    };

    const judgeScores = runScores
      .map((r) => r.judge?.score)
      .filter((s) => typeof s === "number");
    const rubricMean = judgeScores.length > 0 ? mean(judgeScores) : null;

    const metricsList = runScores.map((r) => r.metrics).filter(Boolean);
    const sysMetrics = {
      avgLatencyMs: mean(metricsList.map((m) => m.latencyMs)),
      avgCommandCount: mean(metricsList.map((m) => m.commandCount)),
      erroredRate: mean(metricsList.map((m) => (m.errored ? 1 : 0))),
      // failure-recovery rate: of the runs that errored, how many still
      // produced a usable reply and closed cleanly.
      recoveredRate: (() => {
        const errored = metricsList.filter((m) => m.errored);
        if (errored.length === 0) return null;
        return mean(errored.map((m) => (m.recovered ? 1 : 0)));
      })(),
    };

    scoredTasks.push({
      id: task.id,
      objective: task.objective,
      kind: task.kind,
      agent: task.agent,
      passRate,
      passPowK,
      detPasses,
      k,
      trajectory: traj,
      rubricMean,
      rubricScores: judgeScores,
      systemMetrics: sysMetrics,
      runs: runScores,
    });
  }

  // ── summary table ──
  console.log(
    "task                       obj            kind     pass  pass^k  tool  args  deleg order  rubric  lat(s)  cmds  err",
  );
  console.log("-".repeat(118));
  for (const t of scoredTasks) {
    const row = [
      t.id.padEnd(26),
      String(t.objective).padEnd(14),
      String(t.kind).padEnd(8),
      fmtPct(t.passRate),
      `  ${t.passPowK ? "yes" : "no "}`,
      fmtPct(t.trajectory.rightTool),
      fmtPct(t.trajectory.rightArgs),
      fmtPct(t.trajectory.rightDelegate),
      fmtPct(t.trajectory.rightOrder),
      t.rubricMean == null ? "   -  " : fmtNum(t.rubricMean).replace(/^ /, ""),
      fmtNum(
        t.systemMetrics.avgLatencyMs == null
          ? null
          : t.systemMetrics.avgLatencyMs / 1000,
      ),
      fmtNum(t.systemMetrics.avgCommandCount),
      fmtPct(t.systemMetrics.erroredRate),
    ].join(" ");
    console.log(row);
  }
  console.log("-".repeat(118));

  // ── aggregate scorecard ──
  const overallPassRate = mean(scoredTasks.map((t) => t.passRate));
  const overallPassPowK = mean(scoredTasks.map((t) => t.passPowK));
  const overallRubric = mean(
    scoredTasks.map((t) => t.rubricMean).filter((x) => x != null),
  );
  const overallTrajectory = {
    rightTool: mean(scoredTasks.map((t) => t.trajectory.rightTool)),
    rightArgs: mean(scoredTasks.map((t) => t.trajectory.rightArgs)),
    rightDelegate: mean(scoredTasks.map((t) => t.trajectory.rightDelegate)),
    rightOrder: mean(scoredTasks.map((t) => t.trajectory.rightOrder)),
  };
  const overallErrored = mean(
    scoredTasks.map((t) => t.systemMetrics.erroredRate),
  );

  // by-objective rollup
  const objectives = [...new Set(scoredTasks.map((t) => t.objective))];
  const byObjective = {};
  for (const obj of objectives) {
    const subset = scoredTasks.filter((t) => t.objective === obj);
    byObjective[obj] = {
      taskCount: subset.length,
      passRate: mean(subset.map((t) => t.passRate)),
      passPowK: mean(subset.map((t) => t.passPowK)),
      rubricMean: mean(
        subset.map((t) => t.rubricMean).filter((x) => x != null),
      ),
    };
  }

  console.log("\nBy objective:");
  for (const [obj, agg] of Object.entries(byObjective)) {
    console.log(
      `  ${obj.padEnd(20)} tasks=${agg.taskCount}  pass=${fmtPct(agg.passRate)}  ` +
        `pass^k=${fmtPct(agg.passPowK)}  rubric=${agg.rubricMean == null ? " - " : agg.rubricMean.toFixed(1)}`,
    );
  }

  console.log("\nOverall:");
  console.log(`  pass-rate        ${fmtPct(overallPassRate)}`);
  console.log(
    `  pass^k           ${fmtPct(overallPassPowK)}   (fraction of tasks where ALL k runs passed)`,
  );
  console.log(
    `  trajectory       tool=${fmtPct(overallTrajectory.rightTool)} args=${fmtPct(overallTrajectory.rightArgs)} ` +
      `delegate=${fmtPct(overallTrajectory.rightDelegate)} order=${fmtPct(overallTrajectory.rightOrder)}`,
  );
  console.log(
    `  rubric (0-10)    ${overallRubric == null ? "  -   (judge off)" : overallRubric.toFixed(2)}`,
  );
  console.log(`  errored-rate     ${fmtPct(overallErrored)}`);

  // ── write the scored file ──
  const outPath = inPath.replace(/\.json$/, ".scored.json");
  const scorecard = {
    meta: {
      ...(raw.meta ?? {}),
      scoredAt: new Date().toISOString(),
      judgeModel: judgeOn ? JUDGE_MODEL : null,
      judgeEnabled: judgeOn,
    },
    overall: {
      passRate: overallPassRate,
      passPowK: overallPassPowK,
      rubricMean: overallRubric,
      trajectory: overallTrajectory,
      erroredRate: overallErrored,
    },
    byObjective,
    tasks: scoredTasks,
  };
  writeFileSync(outPath, JSON.stringify(scorecard, null, 2));
  console.log(`\nScored file: ${outPath}`);
}

main().catch((err) => {
  console.error("\nscoring failed:", err?.stack ?? err);
  process.exit(1);
});
