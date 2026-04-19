import { NextResponse, type NextRequest } from "next/server";
import { nango } from "@/lib/nango/server";
import { deleteConnection, getConnection } from "@/lib/connections/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";

/**
 * DELETE /api/connections/[providerConfigKey]
 * Revokes the connection in Nango then removes our row.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ providerConfigKey: string }> },
) {
  try {
    const { providerConfigKey } = await params;
    const organizationId = currentOrganizationId();
    const existing = await getConnection(organizationId, providerConfigKey);
    if (!existing) {
      return NextResponse.json({ ok: true, already: "disconnected" });
    }

    // Best-effort revoke in Nango; local delete is authoritative.
    try {
      await nango().deleteConnection(
        providerConfigKey,
        existing.nango_connection_id,
      );
    } catch {
      /* ignore — connection might already be gone upstream */
    }

    await deleteConnection(organizationId, providerConfigKey);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
