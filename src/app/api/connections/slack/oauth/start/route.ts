import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getConnection } from "@/lib/connections/queries";
import { buildInstallUrl, packState } from "@/lib/agent/slack-oauth";

export const runtime = "nodejs";

const PROVIDER_KEY = "slack";

/**
 * GET /api/connections/slack/oauth/start
 *
 * Returns the Slack authorize URL the user should open in a new tab to
 * install the bot into their workspace. We build it using the client's
 * own Slack App credentials (already saved via /config).
 *
 * redirect_uri is this VPS's /oauth/callback  -  must exactly match what
 * the client pasted into their Slack App's "OAuth & Permissions" page.
 */
export async function GET(req: NextRequest) {
  try {
    const organizationId = await currentOrganizationId();
    const conn = await getConnection(organizationId, PROVIDER_KEY);
    const meta = (conn?.metadata ?? {}) as { client_id?: string };
    if (!meta.client_id) {
      return NextResponse.json(
        {
          error:
            "Slack App credentials not configured yet  -  save them first.",
        },
        { status: 400 },
      );
    }

    const origin = (
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      new URL(req.url).origin
    ).replace(/\/$/, "");
    const redirectUri = `${origin}/api/connections/slack/oauth/callback`;

    const state = packState({ organizationId });
    const url = buildInstallUrl({
      clientId: meta.client_id,
      redirectUri,
      state,
    });

    return NextResponse.json({ ok: true, url, redirect_uri: redirectUri });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
