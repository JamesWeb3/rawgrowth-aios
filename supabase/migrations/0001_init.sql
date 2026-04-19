-- ================================================================
-- Rawgrowth AIOS — initial schema (MVP)
--
-- All tables prefixed with rgaios_ so this project can share a
-- Supabase instance with other apps without name collisions.
--
-- Design notes:
-- • Multi-tenant from day 1: every business table has organization_id.
-- • RLS policies are NOT enabled yet — auth isn't wired. Server routes
--   use the SUPABASE_SERVICE_ROLE_KEY which bypasses RLS anyway. When
--   NextAuth lands, enable RLS + policies keyed on a JWT claim.
-- • Paperclip-shaped: agents, routines, routine_triggers, routine_runs,
--   approvals, audit_log — same mental model as paperclipai/paperclip.
-- • Integrations are Nango-backed: we store a reference to the Nango
--   connection id per (organization_id, provider_config_key).
-- ================================================================

create extension if not exists "pgcrypto";

-- ─── Core tenancy ────────────────────────────────────────────────

create table rgaios_organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Stub users table ready for NextAuth (credentials + OAuth providers).
create table rgaios_users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text,
  image          text,
  password_hash  text,
  email_verified timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- User ↔ organization join.
create table rgaios_organization_memberships (
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  user_id         uuid not null references rgaios_users(id) on delete cascade,
  role            text not null default 'member',       -- 'owner' | 'admin' | 'member'
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index rgaios_organization_memberships_user_idx
  on rgaios_organization_memberships (user_id);

-- ─── Integrations (Nango-backed) ────────────────────────────────

create table rgaios_connections (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references rgaios_organizations(id) on delete cascade,
  provider_config_key   text not null,            -- 'google-mail' | 'google-drive' | 'shopify' | 'canva' | 'outlook' | 'telegram'
  nango_connection_id   text not null,            -- usually set = organization_id
  display_name          text,                     -- e.g. user email or store URL
  status                text not null default 'connected',  -- 'connected' | 'error' | 'disconnected'
  metadata              jsonb not null default '{}'::jsonb,
  connected_at          timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organization_id, provider_config_key)
);
create index rgaios_connections_org_idx on rgaios_connections (organization_id);

-- ─── Knowledge (uploaded markdown files) ────────────────────────

create table rgaios_knowledge_files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  title           text not null,
  tags            text[] not null default '{}',    -- e.g. {'brand-voice','pricing-sheet','proposal-template'}
  storage_path    text not null,                   -- path in Supabase Storage bucket 'knowledge'
  mime_type       text not null default 'text/markdown',
  size_bytes      integer,
  uploaded_at     timestamptz not null default now(),
  uploaded_by     uuid references rgaios_users(id) on delete set null
);
create index rgaios_knowledge_files_org_idx on rgaios_knowledge_files (organization_id);
create index rgaios_knowledge_files_tags_idx on rgaios_knowledge_files using gin (tags);

-- ─── Agents ─────────────────────────────────────────────────────

create table rgaios_agents (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references rgaios_organizations(id) on delete cascade,
  name                text not null,
  title               text,
  role                text not null default 'general',        -- ceo | cto | engineer | marketer | sdr | ops | designer | general
  reports_to          uuid references rgaios_agents(id) on delete set null,
  description         text,
  runtime             text not null default 'claude-sonnet-4-5',
  budget_monthly_usd  integer not null default 500,
  spent_monthly_usd   integer not null default 0,
  status              text not null default 'idle',            -- idle | running | paused | error
  write_policy        jsonb not null default '{}'::jsonb,      -- { "gmail_send": "requires_approval", "slack_post": "direct" }
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index rgaios_agents_org_idx on rgaios_agents (organization_id);
create index rgaios_agents_reports_to_idx on rgaios_agents (reports_to);

-- ─── Routines ───────────────────────────────────────────────────

create table rgaios_routines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references rgaios_organizations(id) on delete cascade,
  title             text not null,
  description       text,                          -- natural-language instructions / playbook
  assignee_agent_id uuid references rgaios_agents(id) on delete set null,
  status            text not null default 'active',  -- active | paused | archived
  last_run_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index rgaios_routines_org_idx on rgaios_routines (organization_id);
create index rgaios_routines_assignee_idx on rgaios_routines (assignee_agent_id);

create table rgaios_routine_triggers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  routine_id      uuid not null references rgaios_routines(id) on delete cascade,
  kind            text not null,                  -- manual | schedule | webhook | integration | telegram
  enabled         boolean not null default true,
  config          jsonb not null default '{}'::jsonb,  -- kind-specific: cron, event id, webhook_secret, telegram_command, etc.
  public_id       text unique,                    -- public URL fragment for webhook triggers
  created_at      timestamptz not null default now()
);
create index rgaios_routine_triggers_routine_idx on rgaios_routine_triggers (routine_id);
create index rgaios_routine_triggers_kind_idx on rgaios_routine_triggers (organization_id, kind);

create table rgaios_routine_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  routine_id      uuid not null references rgaios_routines(id) on delete cascade,
  trigger_id      uuid references rgaios_routine_triggers(id) on delete set null,
  source          text not null,                  -- manual | telegram | webhook | schedule | integration
  status          text not null default 'pending',  -- pending | running | awaiting_approval | succeeded | failed
  input_payload   jsonb,                          -- variables passed at trigger time
  output          jsonb,                          -- final result (e.g. { canva_url: "..." })
  error           text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index rgaios_routine_runs_routine_idx on rgaios_routine_runs (routine_id, created_at desc);
create index rgaios_routine_runs_status_idx on rgaios_routine_runs (organization_id, status);

-- ─── Approvals ──────────────────────────────────────────────────

create table rgaios_approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  routine_run_id  uuid references rgaios_routine_runs(id) on delete cascade,
  agent_id        uuid references rgaios_agents(id) on delete set null,
  tool_name       text not null,                  -- e.g. 'gmail_send'
  tool_args       jsonb not null,
  reason          text,                           -- agent's rationale for the action
  status          text not null default 'pending',  -- pending | approved | rejected
  reviewed_by     uuid references rgaios_users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index rgaios_approvals_org_status_idx on rgaios_approvals (organization_id, status);
create index rgaios_approvals_run_idx on rgaios_approvals (routine_run_id);

-- ─── Audit log ──────────────────────────────────────────────────

create table rgaios_audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references rgaios_organizations(id) on delete cascade,
  ts              timestamptz not null default now(),
  kind            text not null,                  -- tool_call | connection | agent | routine | approval | auth
  actor_type      text,                           -- agent | user | system
  actor_id        text,
  detail          jsonb not null default '{}'::jsonb
);
create index rgaios_audit_log_org_ts_idx on rgaios_audit_log (organization_id, ts desc);
create index rgaios_audit_log_kind_idx on rgaios_audit_log (organization_id, kind, ts desc);

-- ─── updated_at auto-touch trigger ──────────────────────────────

create or replace function rgaios_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tr_rgaios_organizations_updated_at
  before update on rgaios_organizations
  for each row execute function rgaios_set_updated_at();

create trigger tr_rgaios_users_updated_at
  before update on rgaios_users
  for each row execute function rgaios_set_updated_at();

create trigger tr_rgaios_connections_updated_at
  before update on rgaios_connections
  for each row execute function rgaios_set_updated_at();

create trigger tr_rgaios_agents_updated_at
  before update on rgaios_agents
  for each row execute function rgaios_set_updated_at();

create trigger tr_rgaios_routines_updated_at
  before update on rgaios_routines
  for each row execute function rgaios_set_updated_at();

-- ─── Seed: default MVP organization ─────────────────────────────
-- Hardcoded id used by server routes until auth is wired.

insert into rgaios_organizations (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Rawgrowth MVP', 'rawgrowth-mvp')
on conflict (id) do nothing;
