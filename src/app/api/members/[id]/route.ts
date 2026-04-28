import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * DELETE /api/members/[id]
 *
 * Owner-only. Removes a member from the organization.
 * Safety rules:
 *   - Caller must be an owner
 *   - Caller cannot remove themselves
 *   - Must leave at least one owner in the org (don't orphan the tenancy)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.userId || !ctx.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  const { data: caller } = await db
    .from("rgaios_users")
    .select("role")
    .eq("id", ctx.userId)
    .eq("organization_id", ctx.activeOrgId)
    .maybeSingle();

  if (!caller || caller.role !== "owner") {
    return NextResponse.json(
      { error: "Only owners can remove members" },
      { status: 403 },
    );
  }

  if (id === ctx.userId) {
    return NextResponse.json(
      { error: "You can't remove yourself" },
      { status: 400 },
    );
  }

  const { data: target } = await db
    .from("rgaios_users")
    .select("id, role, email")
    .eq("id", id)
    .eq("organization_id", ctx.activeOrgId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Keep at least one owner in the org.
  if (target.role === "owner") {
    const { count } = await db
      .from("rgaios_users")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.activeOrgId)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last owner  -  promote someone else first" },
        { status: 400 },
      );
    }
  }

  const { error } = await db
    .from("rgaios_users")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.activeOrgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: ctx.activeOrgId,
    kind: "member_removed",
    actor_type: "user",
    actor_id: ctx.userId,
    detail: { email: target.email, role: target.role },
  });

  return NextResponse.json({ ok: true });
}
