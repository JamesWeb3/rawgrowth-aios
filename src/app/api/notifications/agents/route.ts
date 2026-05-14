import { NextResponse, after, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/notifications/agents
 *
 * Returns recent proactive agent messages (kind=proactive_anomaly,
 * data_ask, atlas_coordinate) the operator hasn't dismissed yet.
 * Drives the bell badge in the top bar.
 *
 * Lazy 15-min coordinate trigger: SWR polls this endpoint every 5s,
 * which makes it a perfect heartbeat. If the last atlas_coordinate
 * for this org is older than 15 minutes, fire the cron route async
 * (no await) so the next poll picks up the new ticket snapshot.
 * Vercel Hobby caps native cron at daily, so this is the workaround
 * Pedro's "rode cron de 15 em 15... nn para porra" rule depends on.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = ctx.activeOrgId;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  // Lazy-trigger atlas-coordinate via after() so the work survives the
  // serverless response cutoff. void fetch was getting killed mid-flight
  // on Vercel because the function's execution context died once the
  // bell payload was sent.
  after(async () => {
    try {
      const { data: last } = await supabaseAdmin()
        .from("rgaios_agent_chat_messages")
        .select("id")
        .eq("organization_id", orgId)
        .filter("metadata->>kind", "eq", "atlas_coordinate")
        .gte("created_at", fifteenMinAgo)
        .limit(1)
        .maybeSingle();
      if (last) return;
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const secret = process.env.CRON_SECRET ?? "";
      if (!base || !secret) return;
      await fetch(`${base}/api/cron/atlas-coordinate`, {
        headers: { authorization: `Bearer ${secret}` },
      }).catch(() => undefined);
    } catch {
      // best-effort - never let coord trigger break the bell
    }
  });
  const { data } = await supabaseAdmin()
    .from("rgaios_agent_chat_messages")
    .select("id, agent_id, content, created_at, metadata")
    .eq("organization_id", orgId)
    .eq("role", "assistant")
    .gte("created_at", since)
    .or("metadata->>archived.is.null,metadata->>archived.eq.false")
    .filter(
      "metadata->>kind",
      "in",
      "(proactive_anomaly,data_ask,atlas_coordinate)",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  type Row = {
    id: string;
    agent_id: string;
    content: string;
    created_at: string;
    metadata: Record<string, unknown> | null;
  };
  const rows = (data ?? []) as Row[];

  const agentIds = Array.from(new Set(rows.map((r) => r.agent_id)));
  const nameById = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: agents } = await supabaseAdmin()
      .from("rgaios_agents")
      .select("id, name")
      .in("id", agentIds);
    for (const a of (agents ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(a.id, a.name);
    }
  }

  return NextResponse.json({
    notifications: rows.map((r) => ({
      id: r.id,
      agent_id: r.agent_id,
      agent_name: nameById.get(r.agent_id) ?? "Agent",
      content: r.content,
      created_at: r.created_at,
      kind: (r.metadata as { kind?: string } | null)?.kind ?? "message",
    })),
  });
}

/**
 * POST /api/notifications/agents
 *
 * Dismiss notifications. The bug this fixes: the GET handler already
 * filtered on `metadata->>archived` and the route doc said "the
 * operator hasn't dismissed yet" - but nothing ever SET archived, and
 * the bell UI had no dismiss control. So the badge was permanently
 * pinned to whatever proactive messages landed in the last 7 days
 * (up to 20), counting down never, and tapping a notification just
 * navigated away leaving it in the list. Operators learned to ignore
 * the bell entirely.
 *
 * Body:
 *   { id: "<uuid>" }  -> dismiss one notification
 *   { all: true }     -> dismiss every currently-visible notification
 *
 * "Dismiss" = soft archive: merge metadata.archived=true +
 * archived_at into the jsonb (same pattern as the chat "New chat"
 * archive in /api/agents/[id]/chat DELETE). Nothing is deleted; the
 * /updates page can still surface history.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;

  let body: { id?: string; all?: boolean };
  try {
    body = (await req.json()) as { id?: string; all?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.id && !body.all) {
    return NextResponse.json(
      { error: "Provide `id` or `all: true`" },
      { status: 400 },
    );
  }

  const db = supabaseAdmin();
  // Same kind filter + non-archived guard as GET so `all` only touches
  // rows the operator can actually see in the bell, and a stale `id`
  // for a row from another kind / org is a no-op rather than an error.
  let q = db
    .from("rgaios_agent_chat_messages")
    .select("id, metadata")
    .eq("organization_id", orgId)
    .eq("role", "assistant")
    .or("metadata->>archived.is.null,metadata->>archived.eq.false")
    .filter(
      "metadata->>kind",
      "in",
      "(proactive_anomaly,data_ask,atlas_coordinate)",
    );
  if (body.id) q = q.eq("id", body.id);
  const { data: rows, error: selErr } = await q;
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  const stamp = new Date().toISOString();
  const typedRows = (rows ?? []) as Array<{
    id: string;
    metadata: Record<string, unknown> | null;
  }>;
  // Parallel per-row updates - jsonb merge needs the existing metadata,
  // and Supabase has no atomic jsonb-merge in the JS client, so we
  // read-modify-write each row. Same approach as the chat archive path.
  const settled = await Promise.all(
    typedRows.map(async (r) => {
      const next = { ...(r.metadata ?? {}), archived: true, archived_at: stamp };
      const res = await db
        .from("rgaios_agent_chat_messages")
        .update({ metadata: next } as never)
        .eq("id", r.id);
      return { id: r.id, ok: !res.error, error: res.error?.message };
    }),
  );
  const failed = settled.filter((s) => !s.ok);
  if (failed.length > 0) {
    console.error(
      "[notifications] dismiss partial failure:",
      failed.map((f) => `${f.id}:${f.error}`).join(", "),
    );
    const dismissed = settled.length - failed.length;
    return NextResponse.json(
      { ok: false, dismissed, failed: failed.map((f) => f.id) },
      { status: dismissed > 0 ? 207 : 500 },
    );
  }
  return NextResponse.json({ ok: true, dismissed: typedRows.length });
}
