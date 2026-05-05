import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/admin/provision-now
 *
 * Manual override for the provision-tick cron. Admins hit this when
 * a buyer just paid and they don't want to wait for the next 5-min
 * cron firing. Just internally calls the cron handler with the
 * server-side CRON_SECRET so all the same logic runs.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) {
    return NextResponse.json(
      { error: "admin only" },
      { status: 403 },
    );
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET env not set on server" },
      { status: 500 },
    );
  }

  const url = new URL("/api/cron/provision-tick", req.url);
  const r = await fetch(url, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const body = await r.json().catch(() => ({}));
  return NextResponse.json({ status: r.status, ...body });
}
