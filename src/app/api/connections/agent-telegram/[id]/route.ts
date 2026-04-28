import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { tryDecryptSecret } from "@/lib/crypto";
import { deleteWebhook } from "@/lib/telegram/client";

export const runtime = "nodejs";

/**
 * DELETE /api/connections/agent-telegram/[id]
 *
 * Disconnect a per-head Telegram bot:
 *   1. Best-effort deleteWebhook with Telegram so the bot stops getting
 *      delivery attempts (failure here doesn't block the row delete).
 *   2. Delete the row — chat history (rgaios_telegram_messages) cascades.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const organizationId = await currentOrganizationId();
  const db = supabaseAdmin();

  const { data: row } = await db
    .from("rgaios_agent_telegram_bots")
    .select("id, bot_token, agent_id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ ok: true, removed: false });
  }

  const token = tryDecryptSecret(row.bot_token);
  if (token) {
    try {
      await deleteWebhook(token);
    } catch {
      /* non-fatal — Telegram side may already be gone */
    }
  }

  const { error } = await db
    .from("rgaios_agent_telegram_bots")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: organizationId,
    kind: "connection_disconnected",
    actor_type: "user",
    actor_id: "session",
    detail: { provider: "agent-telegram", bot_row_id: id, agent_id: row.agent_id },
  });

  return NextResponse.json({ ok: true, removed: true });
}
