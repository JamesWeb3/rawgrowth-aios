import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Autonomous-mode persistence helper.
 *
 * Backed by the two columns added in migration 0051:
 *   - rgaios_organizations.autonomous_mode  ('off' | 'review' | 'on')
 *   - rgaios_organizations.max_loop_iterations (1-10, default 5)
 *
 * Reads also try to surface the last-applied timestamp from the audit
 * log so the settings UI can render "Updated <when> by <who>" without a
 * separate column. Falls back to null when no audit row exists yet.
 */

export type AutonomousMode = "off" | "review" | "on";

export type AutonomousSettings = {
  mode: AutonomousMode;
  maxLoopIterations: number;
  lastAppliedAt: string | null;
  lastAppliedByEmail: string | null;
};

const DEFAULT: AutonomousSettings = {
  mode: "review",
  maxLoopIterations: 5,
  lastAppliedAt: null,
  lastAppliedByEmail: null,
};

export const AUTONOMOUS_AUDIT_KIND = "autonomous_settings_updated";

export async function getAutonomousSettings(
  orgId: string,
): Promise<AutonomousSettings> {
  const db = supabaseAdmin();
  const { data: org } = await db
    .from("rgaios_organizations")
    .select("autonomous_mode, max_loop_iterations")
    .eq("id", orgId)
    .maybeSingle();

  const mode = normalizeMode(
    (org as { autonomous_mode?: string } | null)?.autonomous_mode,
  );
  const max = clampIter(
    (org as { max_loop_iterations?: number } | null)?.max_loop_iterations,
  );

  // Audit hop for "Updated <when>" hint. Best-effort; failure leaves
  // the timestamps null and the UI just hides the line.
  const { data: lastAudit } = await db
    .from("rgaios_audit_log")
    .select("ts, actor_id")
    .eq("organization_id", orgId)
    .eq("kind", AUTONOMOUS_AUDIT_KIND)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  let lastAppliedByEmail: string | null = null;
  const actorId =
    (lastAudit as { actor_id?: string | null } | null)?.actor_id ?? null;
  if (actorId) {
    const { data: actor } = await db
      .from("rgaios_users")
      .select("email")
      .eq("id", actorId)
      .maybeSingle();
    lastAppliedByEmail =
      (actor as { email?: string | null } | null)?.email ?? null;
  }

  return {
    mode,
    maxLoopIterations: max,
    lastAppliedAt:
      (lastAudit as { ts?: string | null } | null)?.ts ?? null,
    lastAppliedByEmail,
  };
}

export function normalizeMode(value: unknown): AutonomousMode {
  if (value === "off" || value === "review" || value === "on") return value;
  return DEFAULT.mode;
}

export function clampIter(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT.maxLoopIterations;
  return Math.min(10, Math.max(1, Math.floor(n)));
}
