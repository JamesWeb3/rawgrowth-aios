import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { listMembers, listPendingInvites } from "@/lib/members/queries";

export const runtime = "nodejs";

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [members, invites] = await Promise.all([
      listMembers(ctx.activeOrgId),
      listPendingInvites(ctx.activeOrgId),
    ]);
    return NextResponse.json({ members, invites });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
