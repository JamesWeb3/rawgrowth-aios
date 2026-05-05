import { NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  AUTONOMOUS_AUDIT_KIND,
  clampIter,
  getAutonomousSettings,
  normalizeMode,
  type AutonomousMode,
} from "@/lib/organizations/autonomous";

export const runtime = "nodejs";

/**
 * GET  /api/company/autonomous - return current settings + audit hint
 * POST /api/company/autonomous { mode, maxLoopIterations } - owner/admin only
 *
 * Auth model mirrors /api/members/[id]: caller must be owner OR admin
 * for the active org. Admin impersonation (rgaios admin → client org)
 * passes through because ctx.isAdmin is true on the operator side.
 */

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = await getAutonomousSettings(ctx.activeOrgId);
  return NextResponse.json({ ok: true, settings });
}

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.userId || !ctx.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  if (!ctx.isAdmin) {
    const { data: caller } = await db
      .from("rgaios_users")
      .select("role")
      .eq("id", ctx.userId)
      .eq("organization_id", ctx.activeOrgId)
      .maybeSingle();
    const role = (caller as { role?: string } | null)?.role ?? null;
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json(
        { error: "Only owners or admins can change autonomous mode" },
        { status: 403 },
      );
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const raw = (body ?? {}) as { mode?: unknown; maxLoopIterations?: unknown };
  const mode: AutonomousMode = normalizeMode(raw.mode);
  const maxLoopIterations = clampIter(raw.maxLoopIterations);

  const before = await getAutonomousSettings(ctx.activeOrgId);

  const { error } = await db
    .from("rgaios_organizations")
    .update({
      autonomous_mode: mode,
      max_loop_iterations: maxLoopIterations,
    } as never)
    .eq("id", ctx.activeOrgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: ctx.activeOrgId,
    kind: AUTONOMOUS_AUDIT_KIND,
    actor_type: "user",
    actor_id: ctx.userId,
    detail: {
      from: { mode: before.mode, maxLoopIterations: before.maxLoopIterations },
      to: { mode, maxLoopIterations },
    },
  } as never);

  const settings = await getAutonomousSettings(ctx.activeOrgId);
  return NextResponse.json({ ok: true, settings });
}
