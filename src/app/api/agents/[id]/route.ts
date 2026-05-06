import { NextResponse, type NextRequest } from "next/server";
import {
  deleteAgent,
  listAgentsForOrg,
  updateAgent,
} from "@/lib/agents/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { wouldCreateCycle } from "@/lib/tree";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const orgId = await currentOrganizationId();
    // Tolerate empty / malformed JSON bodies. The router can race against an
    // aborted client (page navigation cancels the in-flight PATCH), in which
    // case `req.json()` throws "Unexpected end of JSON input". Treat that
    // as a 400 instead of bubbling up as a 500.
    let raw: Record<string, unknown>;
    try {
      raw = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid or empty body" }, { status: 400 });
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

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
    const msg = (err as Error).message ?? "";
    // PostgREST single-row coerce error means the agent didn't exist
    // (or wasn't visible to this org). Map to 404 instead of 500.
    if (msg.includes("Cannot coerce the result to a single JSON object")) {
      return NextResponse.json(
        { error: "agent not found" },
        { status: 404 },
      );
    }
    console.error("[agents PATCH] error", msg);
    return NextResponse.json(
      { error: "internal error" },
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
    if (!isUuid(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    await deleteAgent(await currentOrganizationId(), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[agents DELETE] error", (err as Error).message);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 },
    );
  }
}
