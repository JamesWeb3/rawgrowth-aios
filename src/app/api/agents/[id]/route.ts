import { NextResponse, type NextRequest } from "next/server";
import {
  deleteAgent,
  listAgentsForOrg,
  updateAgent,
} from "@/lib/agents/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { wouldCreateCycle } from "@/lib/tree";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const orgId = await currentOrganizationId();
    const raw = (await req.json()) as Record<string, unknown>;

    // Accept either snake_case (postgres-style) or camelCase (frontend-style)
    // on the wire so the agent-tree drag handler, the MCP tool, and the
    // form-bound editor can all PATCH the same endpoint without translating.
    const SNAKE_TO_CAMEL: Record<string, string> = {
      reports_to: "reportsTo",
      budget_monthly_usd: "budgetMonthlyUsd",
      write_policy: "writePolicy",
      spent_monthly_usd: "spentMonthlyUsd",
    };
    const patch: Record<string, unknown> = { ...raw };
    for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
      if (snake in raw && !(camel in raw)) {
        patch[camel] = raw[snake];
        delete patch[snake];
      }
    }

    // If we're touching the parent edge, do a tenant-scoped verification:
    // the agent itself must be in this org, the prospective parent must
    // also be in this org (no cross-tenant sneak), and the assignment must
    // not create a cycle. We list once and reuse for all checks.
    if ("reportsTo" in patch) {
      const newParent = patch.reportsTo as string | null;
      const agents = await listAgentsForOrg(orgId);

      const self = agents.find((a) => a.id === id);
      if (!self) {
        return NextResponse.json(
          { error: "agent not found in this organization" },
          { status: 404 },
        );
      }

      if (newParent !== null) {
        const parent = agents.find((a) => a.id === newParent);
        if (!parent) {
          return NextResponse.json(
            { error: "parent not found in this organization" },
            { status: 400 },
          );
        }

        const tree = agents.map((a) => ({
          id: a.id,
          parentId: a.reportsTo,
        }));
        if (wouldCreateCycle(tree, id, newParent)) {
          return NextResponse.json(
            { error: "cycle detected" },
            { status: 400 },
          );
        }
      }
    }

    const agent = await updateAgent(orgId, id, patch);
    return NextResponse.json({ agent });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await deleteAgent(await currentOrganizationId(), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
