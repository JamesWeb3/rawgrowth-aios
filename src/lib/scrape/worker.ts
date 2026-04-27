import { supabaseAdmin } from "@/lib/supabase/server";
import { buildScrapeSources } from "@/lib/scrape/sources";
import { fetchSource } from "@/lib/scrape/fetcher";

/**
 * Drains a queued scrape job for an organization. Called from
 * /api/scrape/route.ts (in-process after onboarding submit) and from
 * the systemd schedule-tick cron (D12) as a retry path.
 *
 * Concurrency: sequential per org. We keep it simple  -  the scrape list
 * is <=~6 URLs and the dashboard unlock gate cares about overall
 * completion, not speed.
 *
 * Never throws  -  failures land in rgaios_scrape_snapshots.status.
 */
export async function drainScrapeQueue(organizationId: string): Promise<{
  total: number;
  succeeded: number;
  blocked: number;
  failed: number;
}> {
  const db = supabaseAdmin();

  // Pull the intake to discover fresh sources if none are queued yet.
  const { data: intake } = await db
    .from("rgaios_brand_intakes")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!intake) {
    return { total: 0, succeeded: 0, blocked: 0, failed: 0 };
  }

  // Seed pending rows for any source URL not yet tracked. Idempotent  - 
  // we don't re-seed succeeded/failed rows on re-run.
  const sources = buildScrapeSources(intake);
  const { data: existing } = await db
    .from("rgaios_scrape_snapshots")
    .select("url")
    .eq("organization_id", organizationId);
  const existingUrls = new Set((existing ?? []).map((r) => r.url));
  const toInsert = sources
    .filter((s) => !existingUrls.has(s.url))
    .map((s) => ({
      organization_id: organizationId,
      url: s.url,
      kind: s.kind,
      status: "pending" as const,
    }));
  if (toInsert.length > 0) {
    await db.from("rgaios_scrape_snapshots").insert(toInsert);
  }

  // Claim every pending row and fetch.
  const { data: pending } = await db
    .from("rgaios_scrape_snapshots")
    .select("id, url")
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  const stats = { total: pending?.length ?? 0, succeeded: 0, blocked: 0, failed: 0 };

  for (const row of pending ?? []) {
    await db
      .from("rgaios_scrape_snapshots")
      .update({ status: "running" })
      .eq("id", row.id);

    const result = await fetchSource(row.url);
    if (result.ok) {
      await db
        .from("rgaios_scrape_snapshots")
        .update({
          status: "succeeded",
          title: result.title,
          content: result.content,
          scraped_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", row.id);
      stats.succeeded += 1;
    } else {
      await db
        .from("rgaios_scrape_snapshots")
        .update({
          status: result.blocked ? "blocked" : "failed",
          error: result.error,
          scraped_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (result.blocked) stats.blocked += 1;
      else stats.failed += 1;
    }
  }

  return stats;
}

/**
 * True iff the scrape queue has at least one succeeded/blocked/failed row
 * for this org (i.e. the queue has drained to completion). Blocked + failed
 * are terminal states  -  we do NOT wait for 100% success, only for "we
 * stopped trying". This is what /api/dashboard/gate checks.
 */
export async function isScrapeComplete(organizationId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { count: pendingCount } = await db
    .from("rgaios_scrape_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["pending", "running"]);
  if ((pendingCount ?? 0) > 0) return false;

  const { count: terminalCount } = await db
    .from("rgaios_scrape_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["succeeded", "blocked", "failed"]);
  return (terminalCount ?? 0) > 0;
}
