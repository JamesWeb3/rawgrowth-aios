import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { getAllowedDepartments } from "@/lib/auth/dept-acl";
import { listApprovals } from "@/lib/approvals/queries";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "pending";
  const allowed = ["pending", "approved", "rejected", "all"] as const;
  const status = (allowed as readonly string[]).includes(statusParam)
    ? (statusParam as (typeof allowed)[number])
    : "pending";

  try {
    const approvals = await listApprovals(ctx.activeOrgId, status);

    // Per-dept ACL: drop any approval whose agent isn't in the user's
    // allowed department set. One join lookup; small N (limit=50) so a
    // single .in() query covers the whole list.
    const allowedDepts = await getAllowedDepartments({
      userId: ctx.userId,
      organizationId: ctx.activeOrgId,
      isAdmin: ctx.isAdmin,
    });
    if (allowedDepts === null) {
      return NextResponse.json({ approvals });
    }
    const agentIds = approvals
      .map((a) => a.agent_id)
      .filter((id): id is string => typeof id === "string");
    if (agentIds.length === 0) {
      return NextResponse.json({ approvals });
    }
    const { data: agents } = await supabaseAdmin()
      .from("rgaios_agents")
      .select("id, department")
      .in("id", agentIds);
    const deptById = new Map<string, string | null>();
    for (const a of (agents ?? []) as Array<{
      id: string;
      department: string | null;
    }>) {
      deptById.set(a.id, a.department);
    }
    const scoped = approvals.filter((a) => {
      if (!a.agent_id) return false;
      const dept = deptById.get(a.agent_id);
      return dept ? allowedDepts.includes(dept) : false;
    });
    return NextResponse.json({ approvals: scoped });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
