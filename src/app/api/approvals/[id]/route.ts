import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";
import { decideApproval } from "@/lib/approvals/queries";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    decision?: "approved" | "rejected";
  };
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 },
    );
  }

  // Per-dept ACL: a marketing-only invitee can't approve/reject a
  // sales agent's pending action even if they guess the approval id.
  const { data: row } = await supabaseAdmin()
    .from("rgaios_approvals")
    .select("agent_id, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.organization_id !== ctx.activeOrgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (row.agent_id) {
    const { data: agent } = await supabaseAdmin()
      .from("rgaios_agents")
      .select("department")
      .eq("id", row.agent_id)
      .maybeSingle();
    const dept = (agent as { department: string | null } | null)?.department ?? null;
    const allowed = await isDepartmentAllowed(
      {
        userId: ctx.userId,
        organizationId: ctx.activeOrgId,
        isAdmin: ctx.isAdmin,
      },
      dept,
    );
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await decideApproval({
      organizationId: ctx.activeOrgId,
      approvalId: id,
      decision: body.decision,
      reviewerId: ctx.userId,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
