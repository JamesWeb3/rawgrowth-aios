import { NextResponse, type NextRequest } from "next/server";
import { nango } from "@/lib/nango/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { providerConfigKeyFor } from "@/lib/nango/providers";

export const runtime = "nodejs";

/**
 * POST /api/nango/session
 * Body: { integrationId: string }
 *
 * Creates a Nango Connect Session for the given integration and returns
 * the session token. The client-side @nangohq/frontend SDK uses this
 * token to open the hosted Connect UI.
 */
export async function POST(req: NextRequest) {
  try {
    const { integrationId } = (await req.json()) as { integrationId: string };
    if (!integrationId) {
      return NextResponse.json(
        { error: "integrationId required" },
        { status: 400 },
      );
    }

    const providerConfigKey = providerConfigKeyFor(integrationId);
    if (!providerConfigKey) {
      return NextResponse.json(
        { error: `No Nango provider mapped for ${integrationId}` },
        { status: 400 },
      );
    }

    const organizationId = await currentOrganizationId();

    const session = await nango().createConnectSession({
      // End-user identifier Nango attaches to the connection; we use the
      // organization id so every tool call is scoped to this tenant.
      end_user: {
        id: organizationId,
      },
      allowed_integrations: [providerConfigKey],
    });

    return NextResponse.json({
      token: session.data.token,
      expires_at: session.data.expires_at,
      providerConfigKey,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
