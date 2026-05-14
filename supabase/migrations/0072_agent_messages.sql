-- 0072: Agent-to-agent async messaging (rgaios_agent_messages).
--
-- Rawclaw's pitch is "a company of agents", but the only agent-to-agent
-- path today is agent_invoke: one-shot, blocking, manager -> sub-agent,
-- no back-and-forth, no peer-to-peer, no inbox. This table adds a
-- lightweight async peer channel (A2A-style) so a department head can
-- ask a peer a clarifying question without spawning a full blocking
-- delegation run.
--
-- Shape:
--   - thread_id groups a back-and-forth. A fresh message gets its own
--     thread_id (the row default); a reply reuses the parent's
--     thread_id so the whole exchange stays grouped.
--   - read_at null = unread. agent_inbox flips it to now() when the
--     recipient reads with unread_only.
--
-- RLS pattern matches every other org-scoped rgaios_* table (see
-- 0065_rls_close_gaps.sql): `using (organization_id =
-- rgaios_current_org_id())` plus the same predicate in `with check`.
-- supabaseAdmin() with the service-role key bypasses RLS, so the
-- agent_message / agent_inbox MCP tools keep working without changes;
-- the only behaviour difference is that anon-key calls now respect the
-- per-org filter.
--
-- Idempotent: every statement uses IF NOT EXISTS / DROP IF EXISTS.

create table if not exists rgaios_agent_messages (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references rgaios_organizations(id) on delete cascade,
  from_agent_id     uuid not null references rgaios_agents(id) on delete cascade,
  to_agent_id       uuid not null references rgaios_agents(id) on delete cascade,
  thread_id         uuid not null default gen_random_uuid(),  -- groups a back-and-forth; a reply reuses the parent's thread_id
  body              text not null,
  read_at           timestamptz,                              -- null = unread
  created_at        timestamptz not null default now()
);

-- Fast unread-inbox lookup: agent_inbox filters on
-- (organization_id, to_agent_id) and optionally read_at is null.
create index if not exists rgaios_agent_messages_inbox_idx
  on rgaios_agent_messages (organization_id, to_agent_id, read_at);

-- ─── RLS ──────────────────────────────────────────────────────────
alter table rgaios_agent_messages enable row level security;
alter table rgaios_agent_messages force row level security;
drop policy if exists rgaios_v3_agent_messages_org_isolation
  on rgaios_agent_messages;
create policy rgaios_v3_agent_messages_org_isolation
  on rgaios_agent_messages
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());
