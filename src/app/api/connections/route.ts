import { NextResponse } from "next/server";
import { listConnectionsForOrg } from "@/lib/connections/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";

export async function GET() {
  try {
    const organizationId = currentOrganizationId();
    const rows = await listConnectionsForOrg(organizationId);
    return NextResponse.json({ connections: rows });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
