import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * After brand profile approval, seed three per-agent Telegram connection
 * rows in status='pending_token'. The dashboard's "Add to Telegram"
 * button on each default manager (Marketing/Sales/Ops) then flips the
 * row to 'connected' once the operator pastes a BotFather token.
 *
 * Idempotent under concurrent calls  -  relies on the partial unique index
 * `rgaios_connections_org_agent_provider_key` (migration 0028) on
 * `(organization_id, agent_id, provider_config_key) where agent_id is
 * not null` plus supabase-js .upsert({ ignoreDuplicates: true }). Two
 * racing inserts both end up as no-ops for the loser instead of
 * crashing or duplicating.
 *
 * Called from:
 *   - /api/onboarding/chat/route.ts approve_brand_profile tool
 *   - /api/dashboard/gate/route.ts (best-effort retry on every poll)
 *   - /api/connections/telegram/seed-agent (per-manager seed when a
 *     user adds a custom department from /departments/new)
 */

const DEFAULT_DEPARTMENT_TITLES = [
  { name: "Marketing", role: "marketing-manager" },
  { name: "Sales", role: "sales-manager" },
  { name: "Operations", role: "operations-manager" },
];

const TELEGRAM_CONFLICT_TARGET = "organization_id,agent_id,provider_config_key";

/**
 * Seed a single pending_token Telegram connection row for one agent.
 *
 * Idempotent: if a row already exists for (organization_id, agent_id,
 * provider_config_key='telegram'), returns { seeded: false } without
 * raising. Use this when the caller already knows the agent id (e.g.
 * just created a custom department's manager) and wants exactly one
 * bot slot wired up.
 *
 * Concurrency-safe: under two simultaneous calls for the same agent,
 * exactly one upsert wins (returns the row), the other gets an empty
 * select result thanks to ignoreDuplicates=true and reports
 * already_exists. No duplicate rows, no constraint-violation logs.
 */
export async function seedTelegramConnectionForAgent(
  organizationId: string,
  agentId: string,
  displayName: string,
): Promise<{ seeded: boolean; reason?: string }> {
  const db = supabaseAdmin();

  const { data: inserted, error: upsertErr } = await db
    .from("rgaios_connections")
    .upsert(
      {
        organization_id: organizationId,
        agent_id: agentId,
        provider_config_key: "telegram",
        nango_connection_id: `tg:pending:${agentId}`,
        display_name: `${displayName} (Telegram)`,
        status: "pending_token",
        metadata: {},
      },
      {
        onConflict: TELEGRAM_CONFLICT_TARGET,
        ignoreDuplicates: true,
      },
    )
    .select("id");

  if (upsertErr) {
    return { seeded: false, reason: upsertErr.message };
  }

  // ignoreDuplicates: true => conflicting rows are NOT returned in the
  // select payload. Empty array means another writer won the race (or
  // the row already existed from a previous call).
  if (!inserted || inserted.length === 0) {
    return { seeded: false, reason: "already_exists" };
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

  // Build the upsert payload for all candidate agents. We let Postgres
  // (via the partial unique index from migration 0028) decide which
  // rows already exist. ignoreDuplicates makes conflicting rows a
  // no-op, and .select() returns only the rows actually inserted -
  // which is exactly the count we want for the audit log.
  const rows = target.map((agent) => ({
    organization_id: organizationId,
    agent_id: agent.id,
    provider_config_key: "telegram",
    nango_connection_id: `tg:pending:${agent.id}`,
    display_name: `${agent.name} (Telegram)`,
    status: "pending_token",
    metadata: {},
  }));

  const { data: insertedRows, error } = await db
    .from("rgaios_connections")
    .upsert(rows, {
      onConflict: TELEGRAM_CONFLICT_TARGET,
      ignoreDuplicates: true,
    })
    .select("agent_id");

  if (error) {
    console.error("[telegram-seed] upsert failed:", error.message);
    return { seeded: 0, skipped: target.length };
  }

  const seeded = insertedRows?.length ?? 0;
  const skipped = target.length - seeded;

  if (seeded > 0) {
    await db.from("rgaios_audit_log").insert({
      organization_id: organizationId,
      kind: "telegram_connections_seeded",
      actor_type: "system",
      actor_id: "approve_brand_profile",
      detail: {
        seeded,
        skipped,
        agent_ids: target.map((a) => a.id),
        inserted_agent_ids: (insertedRows ?? []).map(
          (r) => (r as { agent_id: string | null }).agent_id,
        ),
      },
    });
  }

  return { seeded, skipped };
}
