-- Atlas (the CEO agent) can self-author MCP tool source when the
-- operator asks for an integration that isn't shipped yet. This table
-- holds the draft TS source + the autoresearch retry state.
--
-- Lifecycle:
--   draft     -> Atlas just wrote the file, never tested
--   testing   -> sandbox eval running (transient)
--   active    -> sandbox eval passed; ready to wire into the static
--                index on next deploy. Until then the live registry
--                logs a console.warn that the active row exists but
--                isn't loaded.
--   failed    -> last_error captured; loop_count >= 30 escalates
--   disabled  -> operator turned it off
--
-- loop_count mirrors the rgaios_insights pattern (0049). Cap at 30
-- (MAX_AUTORESEARCH_LOOPS) before forcing a human in the loop.

create table if not exists rgaios_custom_mcp_tools (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references rgaios_organizations(id) on delete cascade,
  name                 text not null,
  description          text not null,
  code_ts              text not null,
  status               text not null default 'draft'
    check (status in ('draft', 'testing', 'active', 'failed', 'disabled')),
  loop_count           int  not null default 0,
  last_test_output     text,
  last_error           text,
  created_by_agent_id  uuid references rgaios_agents(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists idx_rgaios_custom_mcp_tools_org_status
  on rgaios_custom_mcp_tools (organization_id, status);

alter table rgaios_custom_mcp_tools enable row level security;
drop policy if exists "service_full_access_custom_mcp_tools" on rgaios_custom_mcp_tools;
create policy "service_full_access_custom_mcp_tools" on rgaios_custom_mcp_tools
  for all using (true) with check (true);
