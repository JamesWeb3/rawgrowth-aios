import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { deleteBinding, updateBinding } from "@/lib/slack/bindings";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const organizationId = await currentOrganizationId();
    const patch = (await req.json()) as Record<string, unknown>;
    const binding = await updateBinding(id, organizationId, patch);
    return NextResponse.json({ ok: true, binding });
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
    const organizationId = await currentOrganizationId();
    await deleteBinding(id, organizationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
