import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * POST /api/insights/[id]/open-chat
 *
 * "Open chat" button on each insight card. Seeds the insight's
 * "Question for you" into the Atlas (CEO) chat thread as the next
 * assistant turn so the operator can reply directly instead of
 * re-typing context.
 *
 * Serialization: only ONE insight at a time can be in chat_state='sent'
 * (an unanswered question waiting for a user reply). Newer clicks land
 * in chat_state='queued'; the next answered turn promotes the oldest
 * queued insight to 'sent'.
 *
 * Returns:
 *   { ok: true, agentId, queued: boolean, position?: number }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const { data: insight } = await db
    .from("rgaios_insights")
    .select("id, organization_id, title, suggested_action, reason, chat_state")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!insight) {
    return NextResponse.json({ error: "insight not found" }, { status: 404 });
  }

  type InsightRow = {
    id: string;
    organization_id: string;
    title: string;
    suggested_action: string | null;
    reason: string | null;
    chat_state: string;
  };
  const ins = insight as unknown as InsightRow;

  // Atlas (CEO) is the agent that owns cross-dept insight chat.
  const { data: ceo } = await db
    .from("rgaios_agents")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("role", "ceo")
    .maybeSingle();

  if (!ceo) {
    return NextResponse.json({ error: "atlas agent not found" }, { status: 404 });
  }
  const ceoId = (ceo as unknown as { id: string }).id;

  // If this insight already has a sent question awaiting reply, just
  // open the chat - don't reseed.
  if (ins.chat_state === "sent") {
    return NextResponse.json({ ok: true, agentId: ceoId, queued: false });
  }

  // Check for an active sent question on any other insight in the org.
  const { data: active } = await db
    .from("rgaios_insights")
    .select("id")
    .eq("organization_id", orgId)
    .eq("chat_state", "sent")
    .neq("id", id)
    .limit(1)
    .maybeSingle();

  if (active) {
    const { count } = await db
      .from("rgaios_insights")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("chat_state", "queued");
    await db
      .from("rgaios_insights")
      .update({
        chat_state: "queued",
        chat_state_updated_at: new Date().toISOString(),
      } as never)
      .eq("id", id);
    return NextResponse.json({
      ok: true,
      agentId: ceoId,
      queued: true,
      position: (count ?? 0) + 1,
    });
  }

  // No active question - try to claim the 'sent' slot atomically. The
  // partial unique index rgaios_insights_one_sent_per_org_idx
  // (migration 0061) guarantees at most one 'sent' row per org, so a
  // racing second click lands here, gets a 23505 violation, and
  // downgrades to 'queued' instead. Without the catch, two concurrent
  // POSTs both pass the active-check above and stack two unanswered
  // questions in Atlas chat.
  const stamp = new Date().toISOString();
  const claim = await db
    .from("rgaios_insights")
    .update({
      chat_state: "sent",
      chat_state_updated_at: stamp,
    } as never)
    .eq("id", id)
    .select("id");
  if (claim.error) {
    if (claim.error.code === "23505") {
      // Lost the race - someone else just became 'sent'. Mark this one
      // queued so the operator gets it after the active question is
      // answered.
      const { count } = await db
        .from("rgaios_insights")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("chat_state", "queued");
      await db
        .from("rgaios_insights")
        .update({
          chat_state: "queued",
          chat_state_updated_at: stamp,
        } as never)
        .eq("id", id);
      return NextResponse.json({
        ok: true,
        agentId: ceoId,
        queued: true,
        position: (count ?? 0) + 1,
      });
    }
    return NextResponse.json({ error: claim.error.message }, { status: 500 });
  }

  // Won the race - seed the question into Atlas chat.
  const content = formatQuestion(ins);
  await db.from("rgaios_agent_chat_messages").insert({
    organization_id: orgId,
    agent_id: ceoId,
    user_id: null,
    role: "assistant",
    content,
    metadata: { source: "insight", insight_id: id },
  } as never);

  return NextResponse.json({ ok: true, agentId: ceoId, queued: false });
}

function formatQuestion(ins: {
  title: string;
  suggested_action: string | null;
  reason: string | null;
}): string {
  const parts = [`**${ins.title}**`];
  if (ins.reason) parts.push(ins.reason);
  if (ins.suggested_action) parts.push(ins.suggested_action);
  return parts.join("\n\n");
}
