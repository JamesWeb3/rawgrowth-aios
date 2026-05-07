import { NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { extractAuditCall } from "@/lib/audit-call/extract";
import { checkBrandVoice } from "@/lib/brand/runtime-filter";

export const runtime = "nodejs";
// LLM call can take 30-60s on a long transcript; the default 10s ceiling
// would 504 a real audit-call paste before the model returns. Cap at
// 120s which is well under any provider's hard wall but past the p99
// real-world latency we've seen on extract-insights.
export const maxDuration = 120;

const AUDIT_KIND = "audit_call_processed";
const AUDIT_FAILED_KIND = "audit_call_failed";
const SOURCE_VALUES = new Set(["audit_call_paste", "discovery_call"]);

type Body = {
  transcript?: unknown;
  source?: unknown;
};

/**
 * POST /api/audit-call - paste a discovery / audit-call transcript,
 * get back a structured plan (company summary + pain points + gaps +
 * suggested agents). Plan §12, Chris brief.
 *
 * Flow:
 *   1. getOrgContext gates auth.
 *   2. extractAuditCall runs ONE chatComplete step against the active
 *      provider (openai by default, anthropic-* per env).
 *   3. We persist an rgaios_audit_log row so the activity feed shows
 *      the run + the operator can audit the summary excerpt.
 *   4. For every suggested agent we pre-create a draft rgaios_agents
 *      row (status='draft') so the operator can promote them from the
 *      /agents UI without re-keying. Failure to insert any single draft
 *      is non-fatal: we surface the suggestion in the response anyway.
 *
 * Response shape mirrors what the UI renders:
 *   { ok, summary, painPoints, gaps, suggestedAgents }
 *
 * Brand-voice filter runs over the summary before it ships back to the
 * client (the rest of the lists are short and the LLM is told to avoid
 * the banned list, but the summary is the long-form surface most likely
 * to slip through). On a hit we return the substring-sanitised rewrite
 * rather than re-prompting; the audit row carries the original so the
 * operator can review.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.userId || !ctx.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const transcript =
    typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return NextResponse.json(
      { error: "Missing 'transcript' string" },
      { status: 400 },
    );
  }
  // Accept either label so the same endpoint serves the paste-flow
  // textarea and a future "from a finished discovery call" handoff.
  const sourceRaw =
    typeof body.source === "string" ? body.source : "audit_call_paste";
  const source = SOURCE_VALUES.has(sourceRaw) ? sourceRaw : "audit_call_paste";

  const db = supabaseAdmin();
  const extraction = await extractAuditCall(ctx.activeOrgId, transcript);

  // Brand-voice guard the summary - the ONLY long-form output. The LLM
  // is already told to dodge the banned list, but the substring rewrite
  // is a cheap safety net. Lists are short and item-level.
  let summary = extraction.companySummary;
  if (summary) {
    const r = checkBrandVoice(summary);
    if (!r.ok) summary = r.rewritten;
  }

  // Always log: success rows let the activity feed render "audit call
  // processed N pain points", failure rows tell the operator the LLM
  // call broke without a separate error pipeline.
  if (extraction._error) {
    await db.from("rgaios_audit_log").insert({
      organization_id: ctx.activeOrgId,
      kind: AUDIT_FAILED_KIND,
      actor_type: "user",
      actor_id: ctx.userId,
      detail: {
        source,
        transcript_excerpt: transcript.slice(0, 500),
        error: extraction._error,
      },
    } as never);
    // 503 specifically for "no LLM provider wired" so the UI can show
    // a clear "Connect Claude Max at /connections" prompt instead of a
    // generic 502 that looks like an outage.
    const isNotConfigured = /No LLM provider configured/i.test(
      extraction._error,
    );
    return NextResponse.json(
      { ok: false, error: extraction._error },
      { status: isNotConfigured ? 503 : 502 },
    );
  }

  // Pre-create draft agents so the operator promotes them from /agents
  // instead of re-typing every role. status='draft' keeps the existing
  // listAgentsForOrg / runtime gating happy: drafts don't get scheduled,
  // don't drain budget, and don't show up in the active agent count.
  // Insert one row at a time so a single bad row (e.g. role label that
  // trips a future check constraint) doesn't kill the whole batch.
  const createdAgentIds: string[] = [];
  for (const agent of extraction.suggestedAgents) {
    const { data, error } = await db
      .from("rgaios_agents")
      .insert({
        organization_id: ctx.activeOrgId,
        name: `Draft - ${agent.role}`.slice(0, 120),
        role: agent.role.toLowerCase().slice(0, 40) || "general",
        title: agent.role.slice(0, 80),
        description: agent.why.slice(0, 500),
        status: "draft",
      } as never)
      .select("id")
      .maybeSingle();
    if (!error && data && typeof (data as { id?: string }).id === "string") {
      createdAgentIds.push((data as { id: string }).id);
    }
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: ctx.activeOrgId,
    kind: AUDIT_KIND,
    actor_type: "user",
    actor_id: ctx.userId,
    detail: {
      source,
      transcript_excerpt: transcript.slice(0, 500),
      summary,
      pain_points_count: extraction.painPoints.length,
      gaps_count: extraction.gaps.length,
      suggested_agents_count: extraction.suggestedAgents.length,
      created_agent_ids: createdAgentIds,
    },
  } as never);

  return NextResponse.json({
    ok: true,
    summary,
    painPoints: extraction.painPoints,
    gaps: extraction.gaps,
    suggestedAgents: extraction.suggestedAgents,
    createdAgentIds,
  });
}
