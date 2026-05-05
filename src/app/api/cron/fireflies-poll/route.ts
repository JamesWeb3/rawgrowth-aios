import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/fireflies-poll
 *
 * For every org with a Fireflies API key in rgaios_connections, pulls
 * recent transcripts (last 7 days) + inserts new ones via the existing
 * sales-calls/fireflies/poll route. Idempotent: that route dedups on
 * fireflies_id.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Find orgs with Fireflies keys
  const { data: conns } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("organization_id")
    .eq("provider_config_key", "fireflies")
    .eq("status", "connected");

  const orgIds = Array.from(
    new Set(((conns ?? []) as Array<{ organization_id: string }>).map((c) => c.organization_id)),
  );

  const results: Array<{ org: string; ok: boolean; synced?: number; error?: string }> = [];

  for (const orgId of orgIds) {
    try {
      // Call the per-org sync route - it handles the actual GraphQL pull
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/sales-calls/fireflies/poll`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${expected ?? ""}`,
            "x-org-id": orgId,
          },
        },
      );
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        synced?: number;
        error?: string;
      };
      results.push({ org: orgId, ok: !!body.ok, synced: body.synced, error: body.error });
    } catch (err) {
      results.push({ org: orgId, ok: false, error: (err as Error).message.slice(0, 200) });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
