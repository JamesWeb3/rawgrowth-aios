// Rawclaw agent benchmark - fixed task suite.
//
// 18 real-work tasks mirroring what Marti's agents actually do across
// the 4 trial objectives. The suite is the "fixed task set" leg of the
// benchmark methodology (see README.md): a frozen, version-controlled
// list so a score on one commit is comparable to a score on the next.
//
// Each fixture is one task. Shape:
//
//   id          stable slug, used in result filenames + the score table.
//   objective   which of the 4 trial objectives it exercises.
//   agentRole   which agent role the runner should target (resolved to a
//               live agent id by run.mjs against /api/agents). "ceo" is
//               Atlas; dept heads use their seed role string.
//   prompt      the operator message POSTed to /api/agents/[id]/chat.
//   followUpOf  (optional) id of a task whose thread this one continues -
//               run.mjs keeps the same message history so recall tasks
//               can ask "what did the 2nd email say?" without re-fetching.
//   kind        "deterministic" - graded purely by the checks below.
//               "rubric"        - graded by the LLM-as-judge in score.mjs.
//               "hybrid"        - both: deterministic gate + rubric score.
//   expect      machine-checkable expectations. score.mjs reads these:
//                 toolCalled       a command of this type must appear in
//                                  the trajectory (tool_call|agent_invoke|
//                                  routine_create).
//                 toolName         for tool_call: the composio/apify tool.
//                 args             substrings that must appear in the
//                                  command args (loose contains match).
//                 delegateTo       for agent_invoke: the target agent the
//                                  command must name.
//                 order            ordered list of command types that
//                                  must appear in the trajectory in this
//                                  relative order (trajectory metric).
//                 replyIncludes    substrings the final reply must contain.
//                 replyExcludes    substrings the final reply must NOT
//                                  contain (banned words, raw XML, etc).
//                 noNewCommand     true => the agent must answer from
//                                  recall, emitting zero command blocks.
//                 minThinking      the thinking trace must be >= N chars.
//   rubric      the 0-10 scoring guide handed to the LLM judge for rubric
//               and hybrid tasks. Empty string for pure deterministic.
//
// Grounding: tau-bench / tau2-bench (Sierra), GAIA (Princeton HAL),
// TheAgentCompany (arXiv 2412.14161), PlanBench. See README.md.

/** The 11 frozen banned brand-voice words - every reply is checked. */
export const BANNED_WORDS = [
  "game-changer",
  "unlock",
  "leverage",
  "utilize",
  "deep dive",
  "revolutionary",
  "cutting-edge",
  "synergy",
  "streamline",
  "empower",
  "certainly",
];

/** @typedef {"gmail"|"apify"|"orchestration"|"dept-head"|"handle-resolution"} Objective */

/**
 * @typedef {Object} Fixture
 * @property {string} id
 * @property {Objective} objective
 * @property {string} agentRole
 * @property {string} prompt
 * @property {string} [followUpOf]
 * @property {"deterministic"|"rubric"|"hybrid"} kind
 * @property {Object} expect
 * @property {string} rubric
 */

/** @type {Fixture[]} */
export const FIXTURES = [
  // ─── Objective 1: Gmail (pull / list / triage / read body / recall) ───
  {
    id: "gmail-pull-recent",
    objective: "gmail",
    agentRole: "ceo",
    prompt:
      "Pull my 5 most recent emails and give me a one-line summary of each.",
    kind: "hybrid",
    expect: {
      toolCalled: "tool_call",
      toolName: "GMAIL_FETCH_EMAILS",
      args: ["5"],
      replyExcludes: ["<command", "pulling now", "on it"],
      minThinking: 20,
    },
    rubric:
      "Score 10 if the reply lists 5 distinct emails, each with a real sender and a one-line summary drawn from the fetched data. Score 5 if it fetched but only summarised some, or the summaries are generic. Score 0 if it never fetched, said 'pulling now' with no data, or fabricated emails. Penalise any raw <command> XML left in the reply.",
  },
  {
    id: "gmail-triage-unread",
    objective: "gmail",
    agentRole: "ceo",
    prompt:
      "Triage my unread inbox: which emails need a reply today, which can wait, which are noise? Group them.",
    kind: "hybrid",
    expect: {
      toolCalled: "tool_call",
      toolName: "GMAIL_FETCH_EMAILS",
      replyExcludes: ["<command", "synergy", "streamline"],
      minThinking: 20,
    },
    rubric:
      "Score 10 if the agent fetched the inbox and sorted real emails into reply-today / can-wait / noise with a brief reason per group. Score 5 if it fetched but the grouping is shallow or unjustified. Score 0 if it never fetched or invented an inbox. Reasoning quality is the main signal: the triage logic should be defensible.",
  },
  {
    id: "gmail-read-body",
    objective: "gmail",
    agentRole: "ceo",
    prompt:
      "Open the second email from that list and tell me exactly what it asks me to do.",
    followUpOf: "gmail-pull-recent",
    kind: "hybrid",
    expect: {
      replyExcludes: ["<command", "certainly"],
      minThinking: 15,
    },
    rubric:
      "Score 10 if the agent identifies the 2nd email from the prior turn and reports its actual ask, quoting or paraphrasing the real body. Score 5 if it reads an email but the wrong one, or is vague. Score 0 if it asks the operator which email, or fabricates content. It may re-fetch a single body or recall it - both acceptable as long as the answer is grounded in real content.",
  },
  {
    id: "gmail-recall-no-refetch",
    objective: "gmail",
    agentRole: "ceo",
    prompt:
      "Without pulling anything again, which of those 5 emails was from the oldest sender thread, and who sent it?",
    followUpOf: "gmail-pull-recent",
    kind: "hybrid",
    expect: {
      noNewCommand: true,
      replyExcludes: ["<command", "pulling now", "let me fetch"],
      minThinking: 15,
    },
    rubric:
      "Score 10 if the agent answers purely from the RECENT TOOL RESULTS recall context - names a sender and email from the earlier fetch, emits NO new command block. Score 3 if it answers correctly but re-fetched anyway (violated the instruction). Score 0 if it cannot answer or says it needs to pull again. This task measures memory of a prior fetch, the explicit recall requirement in the spec.",
  },
  {
    id: "gmail-draft-reply",
    objective: "gmail",
    agentRole: "ceo",
    prompt:
      "Draft a short reply to the most recent email. Keep it under 60 words, professional, no fluff.",
    followUpOf: "gmail-pull-recent",
    kind: "rubric",
    expect: {
      replyExcludes: ["game-changer", "leverage", "utilize", "empower"],
    },
    rubric:
      "Score 10 if the agent produces a concrete draft under ~60 words that responds to the actual content of the most recent email and stays professional. Score 5 if the draft is generic or ignores the email's content. Score 0 if no draft, or it asks what to write. Banned brand words cost points.",
  },

  // ─── Objective 2: Apify (list martifox.official posts) ───
  {
    id: "apify-list-posts",
    objective: "apify",
    agentRole: "ceo",
    prompt:
      "List the latest posts from the martifox.official Instagram account with their engagement numbers.",
    kind: "hybrid",
    expect: {
      toolCalled: "tool_call",
      toolName: "apify_run_actor",
      args: ["martifox.official"],
      replyExcludes: ["<command", "pulling now"],
      minThinking: 20,
    },
    rubric:
      "Score 10 if the agent ran an Apify actor scoped to martifox.official and the reply lists real posts with engagement (likes/comments). Score 5 if it ran the actor but the reply is thin or omits engagement. Score 0 if it never ran the actor, used the wrong handle, or fabricated posts.",
  },
  {
    id: "apify-top-post",
    objective: "apify",
    agentRole: "ceo",
    prompt:
      "From martifox.official's recent posts, which one performed best and what made it work?",
    kind: "hybrid",
    expect: {
      toolCalled: "tool_call",
      toolName: "apify_run_actor",
      args: ["martifox.official"],
      replyExcludes: ["<command"],
      minThinking: 20,
    },
    rubric:
      "Score 10 if the agent scrapes martifox.official, picks the top post by a real engagement metric, and gives a defensible reason it worked. Score 5 if it scrapes but the 'why' is generic. Score 0 if no scrape or fabricated data. The analytical reasoning is the rubric signal.",
  },
  {
    id: "apify-handle-strict",
    objective: "apify",
    agentRole: "ceo",
    prompt: "Get me martifox.official's last 3 posts.",
    kind: "deterministic",
    expect: {
      toolCalled: "tool_call",
      toolName: "apify_run_actor",
      args: ["martifox.official", "3"],
      replyExcludes: ["<command"],
    },
    rubric: "",
  },

  // ─── Objective 3: Scan orchestration (plan / delegate / supervise) ───
  {
    id: "orch-delegate-copy",
    objective: "orchestration",
    agentRole: "ceo",
    prompt:
      "I need 3 Instagram hooks for our new product line. Get the right person on it.",
    kind: "hybrid",
    expect: {
      toolCalled: "agent_invoke",
      delegateTo: "copywriter",
      replyExcludes: ["<command", "certainly"],
      minThinking: 20,
    },
    rubric:
      "Score 10 if Atlas routes this to the copywriter / marketing head via agent_invoke with a tight brief, then stitches the returned hooks into its reply. Score 5 if it delegates but the brief is vague or it does not surface the result. Score 0 if it writes the hooks itself (no routing) or asks the operator who to assign.",
  },
  {
    id: "orch-content-sprint",
    objective: "orchestration",
    agentRole: "ceo",
    prompt:
      "Plan a one-week content sprint for our Instagram: 5 posts. Break it into tasks, assign each to the right department head, and set it running.",
    kind: "hybrid",
    expect: {
      order: ["agent_invoke"],
      replyExcludes: ["<command"],
      minThinking: 30,
    },
    rubric:
      "Score 10 if Atlas produces a real 5-post plan, breaks it into named tasks, delegates each to the correct department head (copy to copywriter, scheduling to marketing, etc) via agent_invoke or routine_create, and the plan is coherent. Score 5 if the plan exists but delegation is partial or mis-routed. Score 0 if it just lists ideas with no delegation or planning structure. This is the core orchestration objective: plan + delegate + supervise.",
  },
  {
    id: "orch-supervise-status",
    objective: "orchestration",
    agentRole: "ceo",
    prompt:
      "What's the status of the content sprint? Anything stuck or waiting on me?",
    followUpOf: "orch-content-sprint",
    kind: "rubric",
    expect: {
      replyExcludes: ["<command", "synergy"],
    },
    rubric:
      "Score 10 if Atlas gives a grounded status read on the sprint it just planned - which tasks are moving, which are blocked, what (if anything) needs the operator - referencing the prior turn. Score 5 if the status is generic or ignores the planned sprint. Score 0 if it has no idea what sprint the operator means. Measures supervision / memory of its own delegations.",
  },
  {
    id: "orch-multi-dept",
    objective: "orchestration",
    agentRole: "ceo",
    prompt:
      "We're launching next month. I need a marketing angle AND a sales outreach list. Get both moving.",
    kind: "hybrid",
    expect: {
      toolCalled: "agent_invoke",
      replyExcludes: ["<command"],
      minThinking: 25,
    },
    rubric:
      "Score 10 if Atlas fans out to TWO department heads (marketing + sales/SDR) via agent_invoke, then synthesises both into a short briefing with named owners. Score 5 if it only delegates one half, or does not synthesise. Score 0 if it does the work itself or asks the operator to split it. Tests multi-department fan-out + synthesis.",
  },
  {
    id: "orch-no-overreach",
    objective: "orchestration",
    agentRole: "ceo",
    prompt: "What's 15% of 4,200?",
    kind: "deterministic",
    expect: {
      replyIncludes: ["630"],
      replyExcludes: ["<command", "agent_invoke"],
    },
    rubric: "",
  },

  // ─── Objective 4: Dept-head work (Kasia: 3 hooks from brand profile) ───
  {
    id: "kasia-3-hooks",
    objective: "dept-head",
    agentRole: "copywriter",
    prompt:
      "Write me 3 Instagram hooks for our brand. Pull the brand profile for voice and audience first.",
    kind: "hybrid",
    expect: {
      replyExcludes: [
        "<command",
        "game-changer",
        "unlock",
        "leverage",
        "utilize",
        "deep dive",
        "revolutionary",
        "cutting-edge",
        "synergy",
        "streamline",
        "empower",
        "certainly",
      ],
      minThinking: 20,
    },
    rubric:
      "Score 10 if Kasia delivers exactly 3 distinct Instagram hooks that clearly reflect the brand's voice and audience (grounded in the brand profile / company corpus context), each a usable opener, with a one-line note on the framework used. Score 5 if the hooks are generic or only loosely on-brand. Score 0 if fewer than 3 hooks, or it asks for the brand profile instead of using the injected context. Zero banned words is a hard requirement - any banned word caps the score at 4.",
  },
  {
    id: "kasia-hook-rationale",
    objective: "dept-head",
    agentRole: "copywriter",
    prompt:
      "Of those 3 hooks, which is strongest for a cold audience and why? Reference the awareness stage.",
    followUpOf: "kasia-3-hooks",
    kind: "rubric",
    expect: {
      replyExcludes: ["<command", "certainly"],
    },
    rubric:
      "Score 10 if Kasia picks one of the 3 hooks from the prior turn, justifies it for a cold / unaware audience, and correctly references Schwartz awareness stages. Score 5 if the pick is reasonable but the reasoning is thin or the awareness reference is wrong. Score 0 if it cannot recall the hooks or dodges the question. Measures reasoning depth + memory.",
  },
  {
    id: "kasia-rewrite-onbrand",
    objective: "dept-head",
    agentRole: "copywriter",
    prompt:
      "Rewrite this hook to be punchier and on-brand: 'Our cutting-edge platform will revolutionize how you work.'",
    kind: "hybrid",
    expect: {
      replyExcludes: [
        "cutting-edge",
        "revolutionary",
        "revolutionize",
        "game-changer",
        "<command",
      ],
      minThinking: 15,
    },
    rubric:
      "Score 10 if Kasia returns a punchier rewrite that strips the banned words (cutting-edge, revolutionize) and stays on-brand, ideally noting why the original was weak. Score 5 if the rewrite still feels generic or keeps a banned word. Score 0 if it leaves a banned word in or refuses. Hard gate: any banned word in the reply fails the deterministic check.",
  },

  // ─── Objective 5: "my Instagram" handle resolution ───
  {
    id: "handle-my-instagram",
    objective: "handle-resolution",
    agentRole: "ceo",
    prompt: "Pull the latest posts from my Instagram.",
    kind: "hybrid",
    expect: {
      toolCalled: "tool_call",
      toolName: "apify_run_actor",
      args: ["martifox.official"],
      replyExcludes: ["<command"],
      minThinking: 15,
    },
    rubric:
      "Score 10 if the agent resolves 'my Instagram' to the org's own handle (martifox.official) from context and scrapes it - no clarifying question needed. Score 5 if it asks the operator which handle but then proceeds correctly. Score 0 if it scrapes the wrong account or stalls. This is the handle-resolution objective: the agent should know whose Instagram 'my' means.",
  },
  {
    id: "handle-ambiguous-ask",
    objective: "handle-resolution",
    agentRole: "ceo",
    prompt: "How are we doing on Instagram lately?",
    kind: "rubric",
    expect: {
      replyExcludes: ["<command"],
    },
    rubric:
      "Score 10 if the agent understands 'we' = the org's own Instagram (martifox.official), pulls or references real recent performance, and gives a grounded read. Score 5 if it answers generically without resolving the handle. Score 0 if it asks 'which account' or talks about a different account. Tests implicit first-person handle resolution.",
  },
];

export default FIXTURES;
