import { NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { seedTelegramConnectionForAgent } from "@/lib/connections/telegram-seed";

export const runtime = "nodejs";

/**
 * POST /api/connections/telegram/seed-agent
 * Body: { agentId: string, displayName: string }
 *
 * Creates a single pending_token Telegram connection row for one agent
 * Used by /departments/new right after a custom department's manager
 * is created so the user can paste a BotFather token from the dashboard
 * without re-running the brand-approval seed (which only matches the
 * three default managers: Marketing/Sales/Operations).
 *
 * Idempotent: if a row already exists for (org, agent, telegram), the
 * route returns 200 with seeded=false rather than erroring.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) {
      return NextResponse.json(
        { error: "no active organization" },
        { status: 401 },
      );
    }

    const body = (await req.json()) as {
      agentId?: unknown;
      displayName?: unknown;
    };
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim() : "";

    if (!agentId) {
      return NextResponse.json(
        { error: "agentId required" },
        { status: 400 },
      );
    }
    if (!displayName) {
      return NextResponse.json(
        { error: "displayName required" },
        { status: 400 },
      );
    }

    const result = await seedTelegramConnectionForAgent(
      ctx.activeOrgId,
      agentId,
      displayName,
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
