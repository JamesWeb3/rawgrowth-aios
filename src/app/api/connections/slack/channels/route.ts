import { NextResponse } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getConnection } from "@/lib/connections/queries";
import { tryDecryptSecret } from "@/lib/crypto";
import { listChannels } from "@/lib/slack/client";

export const runtime = "nodejs";

/**
 * GET /api/connections/slack/channels
 * Returns channels the installed bot is a member of (+ any public
 * channel it can see). Used by the bindings UI to populate the
 * channel picker.
 */
export async function GET() {
  try {
    const organizationId = await currentOrganizationId();
    const conn = await getConnection(organizationId, "slack");
    const meta = (conn?.metadata ?? {}) as { bot_token?: string };
    const token = tryDecryptSecret(meta.bot_token);
    if (!token) {
      return NextResponse.json(
        { error: "Slack workspace not installed" },
        { status: 400 },
      );
    }
    const channels = await listChannels(token);
    return NextResponse.json({
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        is_private: c.is_private,
        is_member: c.is_member,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
