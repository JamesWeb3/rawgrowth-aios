import { NextResponse, type NextRequest } from "next/server";
import { createAgent, listAgentsForOrg } from "@/lib/agents/queries";
import { DEFAULT_AGENT_RUNTIME } from "@/lib/agents/constants";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";

export async function GET() {
  try {
    const agents = await listAgentsForOrg((await currentOrganizationId()));
    return NextResponse.json({ agents });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const agent = await createAgent((await currentOrganizationId()), {
      name: String(body.name ?? "").trim(),
      title: String(body.title ?? "").trim(),
      role: body.role,
      reportsTo: body.reportsTo ?? null,
      description: String(body.description ?? "").trim(),
      runtime: body.runtime ?? DEFAULT_AGENT_RUNTIME,
      budgetMonthlyUsd: Number(body.budgetMonthlyUsd ?? 500),
      writePolicy:
        body.writePolicy &&
        typeof body.writePolicy === "object" &&
        !Array.isArray(body.writePolicy)
          ? body.writePolicy
          : undefined,
      department: body.department ?? null,
      isDepartmentHead: body.isDepartmentHead ?? false,
    });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
