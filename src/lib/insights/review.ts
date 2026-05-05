import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";

/**
 * Autoresearch REVIEW phase. After every spawned task for an insight
 * has finished (succeeded | failed), Atlas reviews the batch:
 *
 *   1. Pull each rgaios_routine that was created tagged to this insight
 *      via the task_created audit row (detail->>insight_id matches).
 *   2. Pull the latest rgaios_routine_runs row per routine for status +
 *      output excerpt.
 *   3. Send Atlas one chatReply call asking for a per-task 1-5 score +
 *      one-line feedback + a single PASS or REFINE verdict.
 *   4. Persist the parsed scores + verdict as audit_log
 *      kind='insight_reviewed'.
 *   5. If REFINE: append a refinement checklist to suggested_action
 *      (status stays 'executing', loop_count + 1) so the operator sees
 *      what the next iteration is going after.
 *
 * The caller (checkAndRetryOpen) decides whether to retryInsight on
 * REFINE; this function only writes the verdict + checklist.
 *
 * Best-effort: any crash returns null so the loop can keep going. The
 * insight stays in its current state.
 */

export type TaskScore = {
  routine_id: string;
  score: number;
  feedback: string;
};

export type ReviewResult = {
  insight_id: string;
  scores: TaskScore[];
  verdict: "PASS" | "REFINE";
  raw_reply: string;
};

type RoutineRow = {
  id: string;
  title: string;
  assignee_agent_id: string | null;
};

type RunRow = {
  id: string;
  routine_id: string;
  status: string;
  output: { reply?: string } | null;
  error: string | null;
  created_at: string;
};

type AuditRow = {
  detail: Record<string, unknown> | null;
};

type InsightRow = {
  id: string;
  title: string;
  metric: string;
  loop_count: number;
  suggested_action: string | null;
  generated_by_agent_id: string | null;
};

type AgentRow = {
  id: string;
  name: string;
  role: string | null;
};

function findCeoAgent(
  agents: AgentRow[],
  fallbackId: string | null,
): { id: string; name: string } | null {
  const ceo = agents.find((a) => (a.role ?? "").toLowerCase() === "ceo");
  if (ceo) return { id: ceo.id, name: ceo.name };
  if (fallbackId) {
    const fb = agents.find((a) => a.id === fallbackId);
    if (fb) return { id: fb.id, name: fb.name };
  }
  return null;
}

/**
 * Parse Atlas's reply into per-task scores + verdict. Tolerant on
 * format - we ask for "1. <title> - 4/5 - <feedback>" but accept a
 * range of variants.
 */
function parseReview(
  reply: string,
  routines: RoutineRow[],
): { scores: TaskScore[]; verdict: "PASS" | "REFINE" } {
  const scores: TaskScore[] = [];
  const lines = reply.split(/\r?\n/);

  // Build a title -> routine_id index for fuzzy matching
  const titleIndex = routines.map((r) => ({
    id: r.id,
    title: r.title.toLowerCase(),
  }));

  let cursor = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Match patterns like "1. Title - 4/5 - feedback" or "Task 2: 3/5 - feedback"
    const scoreMatch = line.match(/(\d)\s*\/\s*5/);
    if (!scoreMatch) continue;
    const score = Math.max(1, Math.min(5, Number(scoreMatch[1])));

    // Try to match a routine by substring of the line
    let routineId: string | null = null;
    const lower = line.toLowerCase();
    for (const t of titleIndex) {
      if (t.title && lower.includes(t.title.slice(0, 20))) {
        routineId = t.id;
        break;
      }
    }
    // Fallback: assume the model emits scores in routine order
    if (!routineId && cursor < routines.length) {
      routineId = routines[cursor].id;
    }
    cursor += 1;
    if (!routineId) continue;

    // Skip if we already scored this routine (de-dupe)
    if (scores.some((s) => s.routine_id === routineId)) continue;

    // Feedback = everything after the score on this line
    const after = line.slice(line.indexOf(scoreMatch[0]) + scoreMatch[0].length);
    const feedback = after.replace(/^[\s\-:.,]+/, "").trim().slice(0, 280);
    scores.push({ routine_id: routineId, score, feedback });
  }

  // Verdict: explicit PASS / REFINE token wins, else inferred from scores.
  const upper = reply.toUpperCase();
  let verdict: "PASS" | "REFINE";
  if (/\bVERDICT\s*[:\-]?\s*PASS\b/.test(upper) || /\bPASS\b\s*$/m.test(upper)) {
    verdict = "PASS";
  } else if (/\bVERDICT\s*[:\-]?\s*REFINE\b/.test(upper) || /\bREFINE\b\s*$/m.test(upper)) {
    verdict = "REFINE";
  } else if (scores.length > 0) {
    const avg = scores.reduce((a, s) => a + s.score, 0) / scores.length;
    verdict = avg >= 3.5 ? "PASS" : "REFINE";
  } else {
    verdict = "REFINE";
  }
  return { scores, verdict };
}

export async function reviewSpawnedTasks(
  orgId: string,
  insightId: string,
): Promise<ReviewResult | null> {
  try {
    const db = supabaseAdmin();

    // 1. Pull insight (need title + loop_count + speaker for fallback)
    const { data: insightData } = await db
      .from("rgaios_insights")
      .select(
        "id, title, metric, loop_count, suggested_action, generated_by_agent_id",
      )
      .eq("organization_id", orgId)
      .eq("id", insightId)
      .maybeSingle();
    const ins = insightData as InsightRow | null;
    if (!ins) return null;

    // 2. Pull every task_created audit row tagged to this insight.
    // detail->>insight_id is the contract enforced by extractAndCreateTasks.
    const { data: auditRows } = await db
      .from("rgaios_audit_log")
      .select("detail")
      .eq("organization_id", orgId)
      .eq("kind", "task_created")
      .filter("detail->>insight_id", "eq", insightId);
    const routineIds = new Set<string>();
    for (const row of (auditRows ?? []) as AuditRow[]) {
      const rid = row.detail?.routine_id;
      if (typeof rid === "string") routineIds.add(rid);
    }
    if (routineIds.size === 0) return null;

    // 3. Pull routines + their latest runs in parallel
    const ids = [...routineIds];
    const [routinesRes, runsRes, agentsRes] = await Promise.all([
      db
        .from("rgaios_routines")
        .select("id, title, assignee_agent_id")
        .eq("organization_id", orgId)
        .in("id", ids),
      db
        .from("rgaios_routine_runs")
        .select("id, routine_id, status, output, error, created_at")
        .eq("organization_id", orgId)
        .in("routine_id", ids)
        .order("created_at", { ascending: false }),
      db
        .from("rgaios_agents")
        .select("id, name, role")
        .eq("organization_id", orgId),
    ]);
    const routines = (routinesRes.data ?? []) as RoutineRow[];
    if (routines.length === 0) return null;
    const allRuns = (runsRes.data ?? []) as RunRow[];
    const agents = (agentsRes.data ?? []) as AgentRow[];

    // Latest run per routine (allRuns is sorted desc on created_at)
    const latest = new Map<string, RunRow>();
    for (const r of allRuns) {
      if (!latest.has(r.routine_id)) latest.set(r.routine_id, r);
    }

    // 4. Pick the reviewer agent: prefer Atlas (role=ceo). If the org
    // has no CEO row, fall back to the agent that generated the insight.
    const reviewer = findCeoAgent(agents, ins.generated_by_agent_id);
    if (!reviewer) return null;

    const { data: org } = await db
      .from("rgaios_organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    const orgName = (org as { name: string } | null)?.name ?? null;

    // 5. Build the user message: list each task + its output excerpt
    const taskBlocks = routines
      .map((r, idx) => {
        const run = latest.get(r.id);
        const status = run?.status ?? "unknown";
        const out =
          run?.output?.reply?.trim().slice(0, 500) ??
          run?.error?.slice(0, 200) ??
          "(no output captured)";
        return `${idx + 1}. "${r.title}" [${status}]\n${out}`;
      })
      .join("\n\n");

    const userMessage = `I gave you these ${routines.length} tasks for the anomaly "${ins.title}". Each agent ran, here is their output. For EACH task, score 1-5 on whether it actually delivered + write one line of feedback. End with a single PASS or REFINE verdict.

Tasks:

${taskBlocks}

Format:
1. <task title> - <score>/5 - <one-line feedback>
2. <task title> - <score>/5 - <one-line feedback>
...

VERDICT: PASS or REFINE (REFINE if any task <3 OR average <3.5).`;

    let preamble = "";
    try {
      preamble = await buildAgentChatPreamble({
        orgId,
        agentId: reviewer.id,
        orgName,
        queryText: userMessage,
      });
    } catch {
      // preamble is best-effort - continue without it
    }

    const r = await chatReply({
      organizationId: orgId,
      organizationName: orgName,
      chatId: 0,
      userMessage,
      publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      agentId: reviewer.id,
      historyOverride: [],
      extraPreamble: preamble,
      noHandoff: true,
      maxTokens: 800,
    });
    if (!r.ok) return null;

    const { scores, verdict } = parseReview(r.reply, routines);

    // 6. Persist as audit_log kind='insight_reviewed'
    try {
      await db.from("rgaios_audit_log").insert({
        organization_id: orgId,
        kind: "insight_reviewed",
        actor_type: "agent",
        actor_id: reviewer.id,
        detail: {
          insight_id: insightId,
          scores,
          verdict,
          loop_count: ins.loop_count,
          reply_excerpt: r.reply.slice(0, 800),
        },
      } as never);
    } catch {}

    // 7. If REFINE, append refinement checklist to the insight + bump
    // loop_count. Status stays 'executing' so the loop continues.
    if (verdict === "REFINE") {
      const checklist = scores
        .filter((s) => s.score < 3)
        .map((s) => {
          const r = routines.find((rt) => rt.id === s.routine_id);
          return `- ${r?.title ?? s.routine_id.slice(0, 8)}: ${s.feedback}`;
        })
        .join("\n");
      const refinementBlock = `\n\n**Refinement (loop ${ins.loop_count + 1}):**\n${checklist || "- review found gaps; re-running plan with new angle"}`;
      const merged = (ins.suggested_action ?? "") + refinementBlock;
      try {
        await db
          .from("rgaios_insights")
          .update({
            suggested_action: merged.slice(0, 8000),
            loop_count: ins.loop_count + 1,
            last_attempt_at: new Date().toISOString(),
          } as never)
          .eq("id", insightId);
      } catch {}
    }

    return {
      insight_id: insightId,
      scores,
      verdict,
      raw_reply: r.reply,
    };
  } catch (err) {
    console.warn(
      `[insights/review] reviewSpawnedTasks crashed: ${(err as Error).message}`,
    );
    return null;
  }
}
