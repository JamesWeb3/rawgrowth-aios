import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * After brand profile approval, seed three per-agent Telegram connection
 * rows in status='pending_token'. The dashboard's "Add to Telegram"
 * button on each default manager (Marketing/Sales/Ops) then flips the
 * row to 'connected' once the operator pastes a BotFather token.
 *
 * Idempotent — skips any (agent_id, provider_config_key='telegram') row
 * that already exists.
 *
 * Called from:
 *   - /api/onboarding/chat/route.ts approve_brand_profile tool
 *   - /api/dashboard/gate/route.ts (best-effort retry)
 */

const DEFAULT_DEPARTMENT_TITLES = [
  { name: "Marketing", role: "marketing-manager" },
  { name: "Sales", role: "sales-manager" },
  { name: "Operations", role: "operations-manager" },
];

export async function seedTelegramConnectionsForDefaults(
  organizationId: string,
): Promise<{ seeded: number; skipped: number }> {
  const db = supabaseAdmin();

  // Look up existing default-manager agents. We match by title case-
  // insensitively so we tolerate rgaios_agents rows seeded via a variety
  // of scripts (provision-vps, seed, manual).
  const { data: agents } = await db
    .from("rgaios_agents")
    .select("id, name, title, department")
    .eq("organization_id", organizationId);

  if (!agents?.length) return { seeded: 0, skipped: 0 };

  const target = (agents as Array<{ id: string; name: string; title: string; department: string | null }>)
    .filter((a) => {
      const label = `${a.title ?? ""} ${a.name ?? ""}`.toLowerCase();
      return DEFAULT_DEPARTMENT_TITLES.some((d) =>
        label.includes(d.name.toLowerCase()),
      );
    });

  if (!target.length) return { seeded: 0, skipped: 0 };

  const { data: existing } = await db
    .from("rgaios_connections")
    .select("agent_id, provider_config_key")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "telegram");
  const hasAgent = new Set(
    (existing ?? [])
      .map((r) => (r as { agent_id: string | null }).agent_id)
      .filter(Boolean),
  );

  let seeded = 0;
  let skipped = 0;
  for (const agent of target) {
    if (hasAgent.has(agent.id)) {
      skipped += 1;
      continue;
    }
    const { error } = await db.from("rgaios_connections").insert({
      organization_id: organizationId,
      agent_id: agent.id,
      provider_config_key: "telegram",
      nango_connection_id: `tg:pending:${agent.id}`,
      display_name: `${agent.name} (Telegram)`,
      status: "pending_token",
      metadata: {},
    });
    if (error) {
      console.error("[telegram-seed] insert failed:", error.message);
      skipped += 1;
    } else {
      seeded += 1;
    }
  }

  if (seeded > 0) {
    await db.from("rgaios_audit_log").insert({
      organization_id: organizationId,
      kind: "telegram_connections_seeded",
      actor_type: "system",
      actor_id: "approve_brand_profile",
      detail: { seeded, skipped, agent_ids: target.map((a) => a.id) },
    });
  }

  return { seeded, skipped };
}
