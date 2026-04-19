import { NextResponse, type NextRequest } from "next/server";
import { createRoutine, listRoutinesForOrg } from "@/lib/routines/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";
import type { RoutineTrigger } from "@/lib/routines/constants";

export const runtime = "nodejs";

export async function GET() {
  try {
    const routines = await listRoutinesForOrg((await currentOrganizationId()));
    return NextResponse.json({ routines });
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
    const routine = await createRoutine((await currentOrganizationId()), {
      title: String(body.title ?? "").trim(),
      description: String(body.description ?? "").trim(),
      assigneeAgentId: body.assigneeAgentId ?? null,
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
