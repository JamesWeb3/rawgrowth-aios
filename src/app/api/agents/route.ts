import { NextResponse, type NextRequest } from "next/server";
import { createAgent, listAgentsForOrg } from "@/lib/agents/queries";
import {
  DEFAULT_AGENT_RUNTIME,
  type AgentRole,
  type AgentRuntime,
} from "@/lib/agents/constants";
import type { Agent } from "@/lib/agents/dto";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { autoTrainAgent } from "@/lib/agents/auto-train";
import { getOrgContext } from "@/lib/auth/admin";
import {
  getAllowedDepartments,
  filterAgentsByDept,
} from "@/lib/auth/dept-acl";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId || !ctx.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const agents = await listAgentsForOrg(ctx.activeOrgId);
    // Per-dept ACL: non-admin invitees with allowed_departments set only
    // see agents in those depts. Admins + members with no restriction
    // see everything (allowed=null).
    const allowed = await getAllowedDepartments({
      userId: ctx.userId,
      organizationId: ctx.activeOrgId,
      isAdmin: ctx.isAdmin,
    });
    const scoped = filterAgentsByDept(agents, allowed);
    return NextResponse.json({ agents: scoped });
  } catch (err) {
    console.error("[agents GET] error", (err as Error).message);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const orgId = await currentOrganizationId();
    const roleLabel = typeof body.role === "string" ? (body.role as string).trim() : "";

    // Reject empty / whitespace-only name early so we don't pollute the
    // org with placeholder agents named "".
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }
    if (name.length > 200) {
      return NextResponse.json(
        { error: "name too long (max 200 chars)" },
        { status: 400 },
      );
    }
    // reportsTo points at an existing agent row, so it MUST be a valid
    // UUID or the FK insert below throws a verbose pg error. Validate
    // up front so we 400 instead of leaking the syntax error.
    if (
      body.reportsTo !== null &&
      body.reportsTo !== undefined &&
      (typeof body.reportsTo !== "string" || !isUuid(body.reportsTo))
    ) {
      return NextResponse.json(
        { error: "invalid reportsTo" },
        { status: 400 },
      );
    }

    // body is untyped parsed JSON. Narrow each enum-ish field at this
    // request boundary: the DTO unions are the app contract, the DB
    // columns are plain text. roleLabel above already pulled a trimmed
    // string from body.role; reuse it so role and the autoTrain label
    // stay in sync.
    const agent = await createAgent(orgId, {
      name,
      title: String(body.title ?? "").trim().slice(0, 200),
      role: (roleLabel || "general") as AgentRole,
      reportsTo: typeof body.reportsTo === "string" ? body.reportsTo : null,
      description: String(body.description ?? "").trim().slice(0, 5000),
      runtime:
        typeof body.runtime === "string"
          ? (body.runtime as AgentRuntime)
          : DEFAULT_AGENT_RUNTIME,
      budgetMonthlyUsd: Number(body.budgetMonthlyUsd ?? 500),
      writePolicy:
        body.writePolicy &&
        typeof body.writePolicy === "object" &&
        !Array.isArray(body.writePolicy)
          ? (body.writePolicy as Agent["writePolicy"])
          : undefined,
      department: (body.department as string | null | undefined) ?? null,
      isDepartmentHead: Boolean(body.isDepartmentHead ?? false),
    });

    // Plan §3 + §4. Apply role template (system_prompt + skills + starter
    // MDs). Best-effort - never fails the agent-create response.
    const trained = await autoTrainAgent({
      orgId,
      agentId: agent.id,
      roleLabel,
    });

    return NextResponse.json({ agent, trained }, { status: 201 });
  } catch (err) {
    console.error("[agents POST] error", (err as Error).message);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 },
    );
  }
}
