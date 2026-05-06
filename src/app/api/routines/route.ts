import { NextResponse, type NextRequest } from "next/server";
import { createRoutine, listRoutinesForOrg } from "@/lib/routines/queries";
import { getOrgContext } from "@/lib/auth/admin";
import { getAllowedDepartments } from "@/lib/auth/dept-acl";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { RoutineTrigger } from "@/lib/routines/constants";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId || !ctx.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const routines = await listRoutinesForOrg(ctx.activeOrgId);

    // Per-dept ACL: scope to routines whose assignee agent's department
    // is in the user's allowed set. Routines with no assignee fall
    // through to admin-only (restricted invitee won't see them).
    const allowedDepts = await getAllowedDepartments({
      userId: ctx.userId,
      organizationId: ctx.activeOrgId,
      isAdmin: ctx.isAdmin,
    });
    if (allowedDepts === null) {
      return NextResponse.json({ routines });
    }
    const agentIds = routines
      .map((r) => r.assigneeAgentId)
      .filter((id): id is string => typeof id === "string");
    const deptById = new Map<string, string | null>();
    if (agentIds.length > 0) {
      const { data: agents } = await supabaseAdmin()
        .from("rgaios_agents")
        .select("id, department")
        .in("id", agentIds);
      for (const a of (agents ?? []) as Array<{
        id: string;
        department: string | null;
      }>) {
        deptById.set(a.id, a.department);
      }
    }
    const scoped = routines.filter((r) => {
      if (!r.assigneeAgentId) return false;
      const dept = deptById.get(r.assigneeAgentId);
      return dept ? allowedDepts.includes(dept) : false;
    });
    return NextResponse.json({ routines: scoped });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId || !ctx.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const assigneeAgentId =
      typeof body.assigneeAgentId === "string" ? body.assigneeAgentId : null;
    if (assigneeAgentId !== null && !isUuid(assigneeAgentId)) {
      return NextResponse.json(
        { error: "invalid assigneeAgentId" },
        { status: 400 },
      );
    }

    // ACL: a restricted invitee can only create routines assigned to
    // an agent in their allowed departments. Unassigned routines are
    // admin-only.
    const allowedDepts = await getAllowedDepartments({
      userId: ctx.userId,
      organizationId: ctx.activeOrgId,
      isAdmin: ctx.isAdmin,
    });
    if (allowedDepts !== null) {
      if (!assigneeAgentId) {
        return NextResponse.json(
          { error: "Forbidden: routines must be assigned to an agent in your dept" },
          { status: 403 },
        );
      }
      const { data: agent } = await supabaseAdmin()
        .from("rgaios_agents")
        .select("department, organization_id")
        .eq("id", assigneeAgentId)
        .maybeSingle();
      const dept = (agent as { department: string | null; organization_id: string } | null);
      if (!dept || dept.organization_id !== ctx.activeOrgId) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }
      if (!dept.department || !allowedDepts.includes(dept.department)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const routine = await createRoutine(ctx.activeOrgId, {
      title: String(body.title ?? "").trim(),
      description: String(body.description ?? "").trim(),
      assigneeAgentId,
      triggers: (body.triggers ?? []) as RoutineTrigger[],
    });
    return NextResponse.json({ routine }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
