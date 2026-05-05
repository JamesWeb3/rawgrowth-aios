import { NextResponse } from "next/server";
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

  // Lazy-trigger atlas-coordinate. Best-effort fire-and-forget.
  void (async () => {
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
      // Fire async; don't await the response so the user's bell load
      // returns instantly.
      void fetch(`${base}/api/cron/atlas-coordinate`, {
        headers: { authorization: `Bearer ${secret}` },
      }).catch(() => undefined);
    } catch {
      // best-effort - never let coord trigger break the bell
    }
  })();
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
