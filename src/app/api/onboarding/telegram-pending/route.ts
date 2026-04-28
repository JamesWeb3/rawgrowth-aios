import { NextResponse } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/onboarding/telegram-pending
 *
 * Returns the list of per-agent Telegram connection slots that are still
 * waiting on a BotFather token for the active organization. Used by the
 * inline `TelegramConnectorBlock` rendered mid-onboarding so the
 * customer can paste a token without leaving the chat.
 *
 * Shape:
 *   { agents: Array<{
 *       agentId: string;
 *       agentName: string;
 *       title: string | null;
 *       department: string | null;
 *       connectionId: string;
 *       status: "pending_token" | "connected";
 *       botUsername: string | null;
 *     }> }
 *
 * Both pending and already-connected slots are returned so the UI can
 * render a green check for ones the user finished earlier in the same
 * session without a refetch race.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("rgaios_connections")
    .select(
      `id, agent_id, status, display_name, metadata,
       rgaios_agents!inner ( id, name, title, department )`,
    )
    .eq("organization_id", orgId)
    .eq("provider_config_key", "telegram")
    .not("agent_id", "is", null)
    .in("status", ["pending_token", "connected"])
    .order("display_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    agent_id: string;
    status: "pending_token" | "connected";
    display_name: string | null;
    metadata: Record<string, unknown> | null;
    rgaios_agents: {
      id: string;
      name: string;
      title: string | null;
      department: string | null;
    } | null;
  };

  const agents = ((data ?? []) as unknown as Row[])
    .filter((r) => r.rgaios_agents)
    .map((r) => ({
      agentId: r.agent_id,
      agentName: r.rgaios_agents!.name,
      title: r.rgaios_agents!.title,
      department: r.rgaios_agents!.department,
      connectionId: r.id,
      status: r.status,
      botUsername:
        (r.metadata as { bot_username?: string | null } | null)?.bot_username ??
        null,
    }));

  return NextResponse.json({ agents });
}
