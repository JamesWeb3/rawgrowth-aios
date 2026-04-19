import { NextResponse, type NextRequest } from "next/server";
import { deleteAgent, updateAgent } from "@/lib/agents/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const patch = await req.json();
    const agent = await updateAgent((await currentOrganizationId()), id, patch);
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
    await deleteAgent((await currentOrganizationId()), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
