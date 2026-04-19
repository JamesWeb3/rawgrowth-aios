import { NextResponse, type NextRequest } from "next/server";
import {
  deleteRoutine,
  setRoutineStatus,
  updateRoutine,
} from "@/lib/routines/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";
import type { RoutineTrigger } from "@/lib/routines/constants";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Small convenience: if caller only wants to flip status, accept
    // { status: "active" | "paused" | "archived" } alone.
    if (
      body &&
      typeof body === "object" &&
      "status" in body &&
      Object.keys(body).length === 1
    ) {
      const r = await setRoutineStatus(
        (await currentOrganizationId()),
        id,
        body.status,
      );
      return NextResponse.json({ routine: r });
    }

    const routine = await updateRoutine((await currentOrganizationId()), id, {
      title: body.title,
      description: body.description,
      assigneeAgentId: body.assigneeAgentId,
      triggers: body.triggers as RoutineTrigger[] | undefined,
      status: body.status,
    });
    return NextResponse.json({ routine });
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
    await deleteRoutine((await currentOrganizationId()), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
