import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";

/**
 * GET /api/connections/telegram/stats
 *
 * Returns recent activity for this org's Telegram connection so the
 * Connections page can show "is the bot actually working" at a glance:
 *   • bot_id, bot_username (safe to expose — public-ish identifiers)
 *   • last_inbound_at  — last time anyone messaged the bot
 *   • last_outbound_at — last time an agent replied
 *   • messages_today   — count of inbound messages since UTC midnight
 *   • pending          — count of inbox messages with no reply yet
 *
 * Returns connected:false if no Telegram connection exists.
 */
export async function GET() {
  try {
    const organizationId = await currentOrganizationId();
    const db = supabaseAdmin();

    const { data: conn } = await db
      .from("rgaios_connections")
      .select("metadata, display_name, connected_at")
      .eq("organization_id", organizationId)
      .eq("provider_config_key", "telegram")
      .maybeSingle();

    if (!conn) {
      return NextResponse.json({ connected: false });
    }

    const meta = (conn.metadata ?? {}) as { bot_id?: number };

    // Most recent inbound (any message)
    const { data: lastIn } = await db
      .from("rgaios_telegram_messages")
      .select("received_at")
      .eq("organization_id", organizationId)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Most recent reply (responded_at not null)
    const { data: lastOut } = await db
      .from("rgaios_telegram_messages")
      .select("responded_at")
      .eq("organization_id", organizationId)
      .not("responded_at", "is", null)
      .order("responded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Today's count (UTC midnight)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count: messagesToday } = await db
      .from("rgaios_telegram_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("received_at", todayStart.toISOString());

    // Pending = inboxed but no reply yet
    const { count: pending } = await db
      .from("rgaios_telegram_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("responded_at", null);

    return NextResponse.json({
      connected: true,
      bot_id: meta.bot_id ?? null,
      bot_username: conn.display_name ?? null,
      connected_at: conn.connected_at,
      last_inbound_at: (lastIn as { received_at?: string } | null)?.received_at ?? null,
      last_outbound_at: lastOut?.responded_at ?? null,
      messages_today: messagesToday ?? 0,
      pending: pending ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
