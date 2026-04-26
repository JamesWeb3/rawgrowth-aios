import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { seedTelegramConnectionsForDefaults } from "@/lib/connections/telegram-seed";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isScrapeComplete } from "@/lib/scrape/worker";

/**
 * GET /api/dashboard/gate — true if onboarding is done AND brand profile
 * is approved AND the post-submit scrape queue has drained to a terminal
 * state. The dashboard shell uses this to decide whether to show the
 * content dashboard or the "still working…" waiting screen.
 *
 * Three gates, any false = not ready:
 *   1. rgaios_organizations.onboarding_completed
 *   2. A rgaios_brand_profiles row with status='approved'
 *   3. rgaios_scrape_snapshots all in terminal states
 */

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const { data: org } = await db
    .from("rgaios_organizations")
    .select("onboarding_completed")
    .eq("id", orgId)
    .maybeSingle();
  const onboardingDone = !!org?.onboarding_completed;

  const { data: approvedProfile } = await db
    .from("rgaios_brand_profiles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();
  const brandProfileApproved = !!approvedProfile;

  const scrapeDone = await isScrapeComplete(orgId);

  const ready = onboardingDone && brandProfileApproved && scrapeDone;

  if (brandProfileApproved) {
    seedTelegramConnectionsForDefaults(orgId).catch((err) =>
      console.error("[dashboard/gate] telegram seed retry failed:", err),
    );
  }

  return NextResponse.json(
    {
      ready,
      gates: {
        onboardingDone,
        brandProfileApproved,
        scrapeDone,
      },
    },
    { status: ready ? 200 : 403 },
  );
}
