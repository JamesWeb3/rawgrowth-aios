# Rawclaw agent benchmark

A repeatable, measured benchmark for the Rawclaw v3 agents' intelligence
and agentic-task performance. It replaces the ad-hoc Playwright
spot-checks of the 4 trial objectives with a frozen task suite, run
through the **real Rawclaw harness**, scored on reliability and
trajectory correctness.

This is net-new code under `scripts/bench/`. It touches no existing
source file.

## Why this exists

The 4 objectives (Gmail, Apify, Scan orchestration, dept-head work) were
checked by hand. There was no number to point at, no way to tell whether
a commit made the agents smarter or dumber, and no measure of
*reliability* - whether an agent that works once works five times.

This benchmark gives a score per commit. Re-run it after a change to the
preamble, the command-extraction path, or the executor, and the
scorecard tells you whether the agents got better.

## The files

| File | What it does |
|---|---|
| `fixtures.mjs` | The frozen task suite. 18 real-work tasks across the 4 objectives plus "my Instagram" handle resolution. Each task carries machine-checkable `expect` rules and an LLM-judge `rubric`. Exported as `FIXTURES`; also exports the 11 `BANNED_WORDS`. |
| `run.mjs` | The HTTP runner. Logs into a running Rawclaw app, resolves each task's `agentRole` to a live agent, POSTs to `/api/agents/[id]/chat` k times per task, parses the chat route's event stream, and writes raw results to `results/<timestamp>.json`. Does not score. |
| `run-playwright.mjs` | The browser runner. Same task suite, same results shape, but drives the **real chat UI** in its own headless Chromium instead of POSTing raw HTTP. Writes raw results to `results/<timestamp>.pw.json`. Does not score. See below. |
| `score.mjs` | The scorer. Reads a raw results file (from either runner), runs the deterministic checks, computes pass-rate + pass^k + trajectory correctness, calls the LLM-as-judge on the rubric tasks, prints a summary table, and writes `results/<timestamp>.scored.json`. |
| `README.md` | This file. |

## How to run it

The runner drives a **running Rawclaw app** over HTTP - it does not boot
one. Start the dev server (or point at any deployed instance) first.

```sh
# 1. in one terminal: a running Rawclaw app with a seeded org
npm run dev            # serves http://localhost:3002

# 2. in another terminal: run the suite, then score it
node scripts/bench/run.mjs
node scripts/bench/score.mjs
```

`run.mjs` prints the path of the raw results file it wrote.
`score.mjs` with no argument scores the newest raw file; pass a path to
score a specific one:

```sh
node scripts/bench/score.mjs scripts/bench/results/2026-05-14T12-00-00-000Z.json
```

Run a subset while iterating:

```sh
BENCH_K=2 BENCH_ONLY=gmail-pull-recent,kasia-3-hooks node scripts/bench/run.mjs
BENCH_OBJECTIVE=orchestration node scripts/bench/run.mjs
```

## The Playwright runner

`run-playwright.mjs` is a second runner over the **same** `fixtures.mjs`
suite. Instead of POSTing to the chat API and parsing the stream, it
drives the real browser UI end to end: it spawns its own headless
Chromium (the `playwright` library, `chromium.launch()` - not a shared
or MCP browser), opens the actual `/auth/signin` page, navigates to each
fixture's agent chat page, types the prompt into the chat input,
submits, waits for the streamed reply to settle, then reads the
trajectory back out of the rendered DOM: the visible reply text, the
"Reasoning" thinking-trace nodes, and the orchestration timeline cards
(tool calls, delegations, routine creations, in execution order). It
also captures a full-page screenshot of every finished turn.

It catches bugs the HTTP path cannot: a command the server emitted but
the page failed to render, a reply that streamed but never settled, a
stuck thinking frame, a timeline card that renders the wrong type. GAIA's
finding that the harness is part of what you measure applies to the UI
too - the chat page, the streaming render, and the timeline DOM are part
of the product.

It writes results in the **same JSON shape** `run.mjs` writes, to
`results/<timestamp>.pw.json` (the `.pw.` marks it as the browser run; it
still ends in `.json` so `score.mjs` picks it up). `score.mjs` scores it
unchanged:

```sh
# 1. a running Rawclaw app with a seeded org (the runner does not boot one)
npm run dev

# 2. drive the suite through the real browser UI, then score it
node scripts/bench/run-playwright.mjs
node scripts/bench/score.mjs        # scores the newest results file
```

It needs **two** things running: a Rawclaw app to drive (same as
`run.mjs` - it does not boot one) AND a real browser. Chromium ships with
the repo's `@playwright/test` dev dependency; if the browser binary is
missing, run `npx playwright install chromium` once.

Per fixture, per run (`BENCH_K` times) it logs in fresh in its own
browser context, so a poisoned session never leaks between runs. It is
robust by design: login failure, page-load timeout, and a
stream-that-never-finishes (bounded by `BENCH_TIMEOUT_MS`) are each
caught, recorded as a failed run with a best-effort screenshot of the
failed state, and the suite continues.

It reads the **same** env-var contract as `run.mjs` (`BENCH_BASE_URL`,
`BENCH_EMAIL`, `BENCH_PASSWORD`, `BENCH_K`, `BENCH_ONLY`,
`BENCH_OBJECTIVE`, `BENCH_TIMEOUT_MS`, `BENCH_GIT_COMMIT`), plus one of
its own:

| Var | Default | Meaning |
|---|---|---|
| `BENCH_HEADFUL` | (unset) | Set to `1` to watch the browser run instead of headless. |

The same subset filters work:

```sh
BENCH_K=2 BENCH_ONLY=gmail-pull-recent node scripts/bench/run-playwright.mjs
BENCH_OBJECTIVE=orchestration node scripts/bench/run-playwright.mjs
```

### Screenshot output

Every run saves a full-page screenshot to
`results/screenshots/<task>-<run>.png` (run is the 0-based k index). The
directory is created on demand. Like the result files, the screenshots
are run artifacts - the `results/` tree keeps only its `.gitkeep`.

### Environment variables

Both scripts read `process.env` first, then a matching key in the repo
`.env`, then a default (the same precedence `scripts/gen-types.mjs`
uses).

| Var | Used by | Default | Meaning |
|---|---|---|---|
| `BENCH_BASE_URL` | run | `http://localhost:3002` | Base URL of the running Rawclaw app. |
| `BENCH_EMAIL` | run | `pedro-onboard@rawclaw.demo` | Operator login for the target org (the seed account the other e2e scripts use). |
| `BENCH_PASSWORD` | run | `rawclaw-onboard-2026` | That account's password. |
| `BENCH_K` | run | `5` | Runs per task. pass^k needs k > 1 to mean anything. |
| `BENCH_TIMEOUT_MS` | run | `180000` | Per-request timeout. The two-pass executor path can be slow. |
| `BENCH_ONLY` | run | (all) | Comma-separated task ids to run a subset. |
| `BENCH_OBJECTIVE` | run | (all) | Run only tasks for one objective: `gmail`, `apify`, `orchestration`, `dept-head`, `handle-resolution`. |
| `BENCH_GIT_COMMIT` | run | (none) | Optional - stamped into the results file so a score is tied to a commit. |
| `ANTHROPIC_API_KEY` | score | (none) | Enables the LLM-as-judge. Without it, rubric tasks are reported unjudged and hybrid tasks score on their deterministic leg only. |
| `BENCH_JUDGE_MODEL` | score | `claude-sonnet-4-5` | The judge model id. |

The runner needs an org with the agents seeded (Atlas plus a copywriter
/ marketing head) and, for a meaningful score, the org's Gmail + Apify
connections wired and a brand profile filled in. A bare org still runs -
tasks that need a missing connection just score low, which is itself a
signal.

## What gets measured

The methodology has three scoring legs plus system metrics, all from the
2026 agentic-eval literature.

### 1. Deterministic checks - pass-rate and pass^k

Every run of every task is graded pass/fail by `score.mjs` against the
task's `expect` block: was the right command type emitted, with the
right tool and args, to the right delegation target, in the right
order; did the reply contain / exclude what it should; did a recall task
answer with **zero** new command blocks; were there zero banned words;
was the thinking trace present.

Per task we report two numbers:

- **pass-rate** - the fraction of k runs that passed.
- **pass^k** - 1.0 only if **all** k runs passed.

pass^k is the headline. tau-bench's finding is that even top models sit
under 50% task success and under 25% pass^8 - peak capability is not the
problem, *reliability* is. An agent that triages the inbox correctly one
run in three is not usable, and pass-rate alone would hide that.

### 2. Trajectory correctness

A finer breakdown of leg 1, scored 0..1 averaged over the k runs:
`rightTool`, `rightArgs`, `rightDelegate`, `rightOrder`. The 2026 eval
consensus (TheAgentCompany, PlanBench) is that the signal is in the
intermediate steps, not just the final answer - an agent can stumble
into a right-looking reply with a wrong trajectory, and that will not
hold up. We grade the steps the harness actually took: the command
blocks it emitted, parsed out of the `commands_executed` stream event.

### 3. LLM-as-judge - rubric score 0..10

The deterministic checks cannot grade "are these 3 hooks actually good"
or "is this triage logic defensible". For `rubric` and `hybrid` tasks, a
judge model (`claude-sonnet-4-5` by default, via the `@anthropic-ai/sdk`
already in the repo) scores each run's reply 0..10 against the task's
written rubric. The judge sees the prompt, the rubric, the agent's
thinking trace, the tool/delegated results it had, and its final reply.
`hybrid` tasks must also pass their deterministic leg; `rubric` tasks are
judge-only.

### System metrics

Aggregated straight from the runner's per-run capture: average latency,
average command-call count, errored-rate, and failure-recovery rate (of
the runs that emitted an error event, how many still produced a usable
reply and closed the stream cleanly).

### Run through the real harness

The runner POSTs to `/api/agents/[id]/chat` - the same route the
dashboard uses. That means every result includes the harness: the
persona preamble, the RAG / company-corpus injection, the
`<thinking>`-block extraction, the `<command>` extraction, the
server-side tool / delegation execution, the two-pass "feed the results
back" reply, and the brand-voice filter. GAIA's result that the agent
harness alone is worth ~7 points is the reason: the benchmark has to
measure *this system*, not raw Claude.

## Output

`run.mjs` writes `results/<timestamp>.json` - the raw capture: every
run's reply, full event stream, trajectory (thinking traces, commands
with type / tool / args / delegate target / order, delegated outputs),
and system metrics.

`score.mjs` writes `results/<timestamp>.scored.json` - the scorecard:
per-task pass-rate / pass^k / trajectory / rubric / system metrics, a
by-objective rollup, and an overall block. It also prints a summary
table to stdout.

The `results/` directory is kept (it has a `.gitkeep`); the result files
themselves are run artifacts.

## Methodology citations

- **Sierra tau-bench / tau2-bench** - pass^k reliability metric;
  tool-agent task suites graded on consistency, not peak. The finding
  that top models are under 50% success and under 25% pass^8.
- **GAIA** (Princeton HAL leaderboard) - real-world assistant tasks;
  the result that the agent harness itself is worth ~7 points, so a
  benchmark must measure the harnessed system.
- **TheAgentCompany** (arXiv 2412.14161) - long-horizon, multi-step
  workplace tasks; trajectory / intermediate-step grading.
- **PlanBench** - planning and delegation correctness as a first-class
  metric, separate from final-answer correctness.

## Constraints this code respects

- It does not boot an app, run migrations, touch a database, or deploy.
  It is an HTTP client against a running instance.
- The runner makes network calls only when *you* run it. Importing the
  files does nothing.
- ESM `.mjs`, matching the other `scripts/*.mjs`. No em-dashes. The 11
  banned brand-voice words stay frozen and every benchmarked reply is
  checked against them.
