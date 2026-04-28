import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { tryDecryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * GET /api/connections/agent-telegram/[id]/token
 * Reveal the decrypted bot token so the operator can copy it for backup
 * or re-use elsewhere. Mirrors the org-level token reveal endpoint.
 * Each reveal is recorded in the audit log.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const organizationId = await currentOrganizationId();
  const db = supabaseAdmin();

  const { data } = await db
    .from("rgaios_agent_telegram_bots")
    .select("bot_token, agent_id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const token = tryDecryptSecret(data.bot_token);
  if (!token) {
    return NextResponse.json({ error: "decrypt failed" }, { status: 500 });
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: organizationId,
    kind: "secret_revealed",
    actor_type: "user",
    actor_id: "session",
    detail: { provider: "agent-telegram", bot_row_id: id, agent_id: data.agent_id },
  });

  return NextResponse.json({ token });
}
