import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";
import { tryDecryptSecret } from "@/lib/crypto";
import { badUuidResponse } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * GET /api/connections/agent-telegram/[id]/token
 * Reveal the decrypted bot token so the operator can copy it for backup
 * or re-use elsewhere. Mirrors the org-level token reveal endpoint.
 * Each reveal is recorded in the audit log.
 *
 * AUTH (Marti client-acceptance.html PHASE-0, GAP #17 / P0 token-exfil):
 * Pre-fix this handler had ZERO auth check: any authenticated org member
 * (and via the service-role bypass, any caller who reached the route)
 * could fetch the decrypted bot token for any UUID by guessing the row
 * id. Two gates added, mirroring the pattern used by every other
 * admin-only reveal route (e.g. /api/admin/clients/[id]/rotate-token):
 *   1. getOrgContext() must return an isAdmin session - any non-admin
 *      caller is refused with 403 before we hit the DB.
 *   2. After loading the row, organization_id must equal the caller's
 *      activeOrgId - prevents a cross-tenant id-guess from leaking a
 *      token belonging to a different org via the service-role client.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const bad = badUuidResponse(id);
  if (bad) return bad;
  const organizationId = ctx.activeOrgId;
  if (!organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const db = supabaseAdmin();

  const { data } = await db
    .from("rgaios_agent_telegram_bots")
    .select("bot_token, agent_id, organization_id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Defence-in-depth cross-tenant guard: the eq() above already scopes
  // by org, but re-verify on the returned row so an admin impersonating
  // a different active org cannot read a row from their home org via a
  // stale id. Belt + braces, cheap, and documents the invariant.
  if (data.organization_id !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const token = tryDecryptSecret(data.bot_token);
  if (!token) {
    return NextResponse.json({ error: "decrypt failed" }, { status: 500 });
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: organizationId,
    kind: "secret_revealed",
    actor_type: "user",
    actor_id: ctx.userId,
    detail: { provider: "agent-telegram", bot_row_id: id, agent_id: data.agent_id },
  });

  return NextResponse.json({ token });
}
