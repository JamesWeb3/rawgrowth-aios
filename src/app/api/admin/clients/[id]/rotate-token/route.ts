import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { rotateMcpToken } from "@/lib/clients/queries";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id } = await params;
    const token = await rotateMcpToken(id);
    return NextResponse.json({ mcp_token: token });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
