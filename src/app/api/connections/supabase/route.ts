import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { upsertConnection } from "@/lib/connections/queries";
import { encryptSecret } from "@/lib/crypto";
import { listOrganizations, SupabaseMgmtError } from "@/lib/supabase-mgmt/client";

export const runtime = "nodejs";

const PROVIDER_KEY = "supabase";

/**
 * POST /api/connections/supabase
 * Body: { token: string }   // Supabase Personal Access Token (sbp_…)
 *
 * Validates the PAT by listing the user's Supabase organizations, then
 * stores it encrypted. One PAT covers every project the user can access  - 
 * MCP tools take `project_ref` per call to target a specific DB.
 */
export async function POST(req: NextRequest) {
  try {
    const { token } = (await req.json()) as { token?: string };
    if (!token || !token.startsWith("sbp_")) {
      return NextResponse.json(
        { error: "Token should start with sbp_ (Supabase Personal Access Token)" },
        { status: 400 },
      );
    }

    let orgs;
    try {
      orgs = await listOrganizations(token);
    } catch (err) {
      if (err instanceof SupabaseMgmtError && err.status === 401) {
        return NextResponse.json(
          { error: "Token rejected by Supabase (401)." },
          { status: 400 },
        );
      }
      throw err;
    }

    const organizationId = await currentOrganizationId();
    const displayName =
      orgs.length === 1
        ? orgs[0].name
        : `${orgs.length} Supabase organization${orgs.length === 1 ? "" : "s"}`;

    const conn = await upsertConnection({
      organizationId,
      providerConfigKey: PROVIDER_KEY,
      nangoConnectionId: `sb:${orgs.map((o) => o.id).join(",").slice(0, 60)}`,
      displayName,
      metadata: {
        access_token: encryptSecret(token),
        organizations: orgs.map((o) => ({ id: o.id, name: o.name })),
      },
    });

    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind: "connection_connected",
        actor_type: "system",
        actor_id: "supabase",
        detail: { organizations: orgs.length },
      });

    return NextResponse.json({
      ok: true,
      connectionId: conn.id,
      organizations: orgs,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
