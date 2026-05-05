import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";
import { ingestCompanyChunk } from "@/lib/knowledge/company-corpus";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/crm-sync
 *
 * For every org with a HubSpot or Pipedrive connection, pulls recent
 * contacts + deals (last 24h delta) and ingests them into the company
 * corpus so agents can reason about pipeline state.
 *
 * Each provider has its own pull function below. Failures per org
 * don't break the others (individual try/catch).
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

  const { data: conns } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("organization_id, provider_config_key, metadata")
    .in("provider_config_key", ["hubspot", "pipedrive"])
    .eq("status", "connected");

  type Conn = {
    organization_id: string;
    provider_config_key: string;
    metadata: Record<string, unknown> | null;
  };
  const rows = (conns ?? []) as Conn[];
  const results: Array<{ org: string; provider: string; synced: number; error?: string }> = [];

  for (const c of rows) {
    try {
      const apiKey = tryDecryptSecret(
        (c.metadata as { api_key?: string } | null)?.api_key,
      );
      if (!apiKey) {
        results.push({
          org: c.organization_id,
          provider: c.provider_config_key,
          synced: 0,
          error: "no api key",
        });
        continue;
      }

      let synced = 0;
      if (c.provider_config_key === "hubspot") {
        synced = await syncHubspot(c.organization_id, apiKey);
      } else if (c.provider_config_key === "pipedrive") {
        synced = await syncPipedrive(c.organization_id, apiKey);
      }
      results.push({ org: c.organization_id, provider: c.provider_config_key, synced });
    } catch (err) {
      results.push({
        org: c.organization_id,
        provider: c.provider_config_key,
        synced: 0,
        error: (err as Error).message.slice(0, 200),
      });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

async function syncHubspot(orgId: string, apiKey: string): Promise<number> {
  // Pull recent contacts via HubSpot CRM v3 API
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const r = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,email,phone,company,lifecyclestage,notes_last_updated&archived=false`,
    { headers: { authorization: `Bearer ${apiKey}` } },
  );
  if (!r.ok) throw new Error(`hubspot ${r.status}`);
  const body = (await r.json()) as {
    results?: Array<{ id: string; properties: Record<string, string>; updatedAt: string }>;
  };
  const fresh = (body.results ?? []).filter((c) => new Date(c.updatedAt).getTime() >= since);

  let synced = 0;
  for (const c of fresh) {
    const text =
      `HubSpot contact ${c.properties.firstname ?? ""} ${c.properties.lastname ?? ""} (${c.properties.email ?? "no-email"})\n` +
      `Company: ${c.properties.company ?? "-"} | Phone: ${c.properties.phone ?? "-"} | Stage: ${c.properties.lifecyclestage ?? "-"}\n` +
      `Updated: ${c.updatedAt}`;
    await ingestCompanyChunk({
      orgId,
      source: "crm",
      sourceId: `hubspot-contact-${c.id}`,
      text,
      metadata: { provider: "hubspot", object: "contact", hubspot_id: c.id },
    });
    synced++;
  }
  return synced;
}

async function syncPipedrive(orgId: string, apiKey: string): Promise<number> {
  // Pull recent deals via Pipedrive API
  const r = await fetch(
    `https://api.pipedrive.com/v1/deals?limit=50&sort=update_time%20DESC&api_token=${encodeURIComponent(apiKey)}`,
  );
  if (!r.ok) throw new Error(`pipedrive ${r.status}`);
  const body = (await r.json()) as {
    data?: Array<{
      id: number;
      title: string;
      value: number;
      currency: string;
      stage_id: number;
      status: string;
      update_time: string;
      person_name?: string;
      org_name?: string;
    }>;
  };
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const fresh = (body.data ?? []).filter((d) => new Date(d.update_time).getTime() >= since);

  let synced = 0;
  for (const d of fresh) {
    const text =
      `Pipedrive deal #${d.id}: "${d.title}"\n` +
      `Value: ${d.value} ${d.currency} | Status: ${d.status} | Stage: ${d.stage_id}\n` +
      `Person: ${d.person_name ?? "-"} | Org: ${d.org_name ?? "-"}\n` +
      `Updated: ${d.update_time}`;
    await ingestCompanyChunk({
      orgId,
      source: "crm",
      sourceId: `pipedrive-deal-${d.id}`,
      text,
      metadata: { provider: "pipedrive", object: "deal", pipedrive_id: d.id },
    });
    synced++;
  }
  return synced;
}
