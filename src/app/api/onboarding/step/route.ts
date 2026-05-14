import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

const STEP_NAMES: Record<number, string> = {
  1: "Welcome",
  2: "Questionnaire",
  3: "Brand Profile",
  4: "Brand Documents",
  5: "API Keys",
  6: "Software Access",
  7: "Schedule Calls",
  8: "Complete",
};

export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { step, data } = await req.json();
    if (typeof step !== "number") {
      return NextResponse.json({ error: "step required" }, { status: 400 });
    }

    const nextStep = Math.min(step + 1, 8);
    const updateFields: Database["public"]["Tables"]["rgaios_organizations"]["Update"] =
      {
        onboarding_step: nextStep,
        updated_at: new Date().toISOString(),
      };

    // Save slack channel if provided in step 1. The org row's column is
    // `slack_channel_name` (migration 0017); `slack_channel_id` only exists
    // on rgaios_slack_bindings, so the old key silently wrote nothing.
    if (step === 1 && data?.slack_channel) {
      updateFields.slack_channel_name = data.slack_channel;
    }

    // Onboarding complete at step 8  -  flip flag on the org row
    if (step >= 8) {
      updateFields.onboarding_completed = true;
    }

    const { error } = await supabaseAdmin()
      .from("rgaios_organizations")
      .update(updateFields)
      .eq("id", ctx.activeOrgId);
    if (error) {
      console.error("Onboarding step update error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Portal notified a central Slack channel here; v3 uses per-org Slack
    // via rgaios_slack_bindings (Phase 1+2+3) so cross-org central notify is
    // out of scope for the trial. Log to stdout and move on.
    console.info(
      `[onboarding] org=${ctx.activeOrgId} completed step ${step}: ${STEP_NAMES[step] ?? `Step ${step}`}`,
    );

    return NextResponse.json({ success: true, nextStep });
  } catch (err: unknown) {
    console.error("Onboarding step error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
