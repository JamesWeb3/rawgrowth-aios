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
 *   - /api/connections/telegram/seed-agent (per-manager seed when a user
 *     adds a custom department from /departments/new)
 */

const DEFAULT_DEPARTMENT_TITLES = [
  { name: "Marketing", role: "marketing-manager" },
  { name: "Sales", role: "sales-manager" },
  { name: "Operations", role: "operations-manager" },
];

/**
 * Seed a single pending_token Telegram connection row for one agent.
 *
 * Idempotent: if a row already exists for (organization_id, agent_id,
 * provider_config_key='telegram'), returns { seeded: false } without
 * raising. Use this when the caller already knows the agent id (e.g.
 * just created a custom department's manager) and wants exactly one
 * bot slot wired up.
 */
export async function seedTelegramConnectionForAgent(
  organizationId: string,
  agentId: string,
  displayName: string,
): Promise<{ seeded: boolean; reason?: string }> {
  const db = supabaseAdmin();

  const { data: existing, error: existingErr } = await db
    .from("rgaios_connections")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("agent_id", agentId)
    .eq("provider_config_key", "telegram")
    .maybeSingle();

  if (existingErr) {
    return { seeded: false, reason: existingErr.message };
  }
  if (existing) {
    return { seeded: false, reason: "already_exists" };
  }

  const { error: insertErr } = await db.from("rgaios_connections").insert({
    organization_id: organizationId,
    agent_id: agentId,
    provider_config_key: "telegram",
    nango_connection_id: `tg:pending:${agentId}`,
    display_name: `${displayName} (Telegram)`,
    status: "pending_token",
    metadata: {},
  });

  if (insertErr) {
    return { seeded: false, reason: insertErr.message };
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: organizationId,
    kind: "telegram_connection_seeded_for_department",
    actor_type: "system",
    actor_id: "departments_new",
    detail: { agent_id: agentId, display_name: displayName },
  });

  return { seeded: true };
}

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
