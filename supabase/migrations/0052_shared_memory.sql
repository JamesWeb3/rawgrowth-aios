-- Shared org memory. Two tiers of agent memory now exist:
--
--   1. INDIVIDUAL  - rgaios_audit_log kind=chat_memory with detail.agent_id.
--                    What the agent learned from its OWN conversations.
--   2. SHARED      - this table. Facts that ANY agent in the org should
--                    know: client preferences, owner's name, vendor stack,
--                    incident postmortems, decisions made in CEO/Atlas
--                    chats that downstream agents must respect.
--
-- Promotion path: when an individual memory is also relevant to peers
-- (e.g. Marketing Manager learns "client just hired a new sales VP, ramp
-- up bookings cadence" - SDR should know), it gets promoted via
-- promoteToShared() in src/lib/memory/shared.ts.
--
-- Scope semantics:
--   - empty array []        - org-wide; every agent reads it
--   - ["sales", "marketing"]- only agents whose department is in the list
--
-- Revisions: when a fact is superseded (e.g. "owner uses GMail" -> "owner
-- migrated to Superhuman"), the new row sets supersedes_id pointing at
-- the old row id. The old row is archived (archived_at) but retained for
-- audit history.

create table if not exists rgaios_shared_memory (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  fact            text not null,
  source_agent_id uuid references rgaios_agents(id) on delete set null,
  source_chat_id  bigint,
  importance      integer not null default 3,
  scope           text[] not null default '{}',
  supersedes_id   uuid references rgaios_shared_memory(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  constraint rgaios_shared_memory_importance_check
    check (importance between 1 and 5)
);

create index if not exists idx_rgaios_shared_memory_org_active
  on rgaios_shared_memory (organization_id, archived_at, importance desc, created_at desc);

create index if not exists idx_rgaios_shared_memory_scope
  on rgaios_shared_memory using gin (scope);

alter table rgaios_shared_memory enable row level security;
drop policy if exists "service_full_access_shared_memory" on rgaios_shared_memory;
create policy "service_full_access_shared_memory" on rgaios_shared_memory
  for all using (true) with check (true);
