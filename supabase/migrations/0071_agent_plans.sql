-- 0071: Persist the orchestrator's plan to durable storage.
--
-- The COO / Atlas orchestrator persona is told to run a
-- plan -> dispatch -> evaluate -> re-check loop, but until now the plan
-- only ever lived inside its <thinking> block. That block is ephemeral:
-- it is dropped on the next turn and lost outright when context gets
-- compacted, so the agent re-derives the same plan from scratch every
-- few turns and loses track of which steps already ran.
--
-- Anthropic's own multi-agent write-up has the lead agent save its plan
-- to external memory before the context window fills. This table is
-- that external memory: one row per plan, with the step list as jsonb
-- so the shape can evolve without a migration per field.
--
-- steps shape: array of
--   { id, desc, owner_agent_id, status, result_ref }
-- where status is one of pending | running | done | blocked. result_ref
-- is a free-form pointer (a routine_run id, an audit_log id, a URL)
-- back to whatever produced the step's output.
--
-- RLS mirrors rgaios_sales_calls (0040) and the gap-close pass (0065):
-- org isolation keyed on rgaios_current_org_id(), force RLS on. The
-- app server holds the service-role key and bypasses RLS, so server
-- routes and MCP tools keep working unchanged; the policy only filters
-- anon/authenticated JWT callers down to their own org.
--
-- Additive + idempotent: create table if not exists, drop policy if
-- exists, drop trigger if exists. Safe to re-run.

create table if not exists rgaios_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  owner_agent_id  uuid references rgaios_agents(id) on delete set null,
  goal            text not null,
  steps           jsonb not null default '[]'::jsonb,
  status          text not null default 'active'
    check (status in ('active', 'completed', 'abandoned')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table rgaios_plans is
  'Durable orchestrator plan artifact. One row per plan owned by the COO/Atlas agent (owner_agent_id). steps is a jsonb array of { id, desc, owner_agent_id, status, result_ref } with step status pending|running|done|blocked. Written + read by src/lib/mcp/tools/plans.ts (plan_create / plan_update / plan_get).';

create index if not exists idx_rgaios_plans_org_status
  on rgaios_plans (organization_id, status);

-- RLS: org isolation, mirroring rgaios_sales_calls (0040).
alter table rgaios_plans enable row level security;
alter table rgaios_plans force row level security;
drop policy if exists rgaios_v3_plans_org_isolation on rgaios_plans;
create policy rgaios_v3_plans_org_isolation on rgaios_plans
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

-- updated_at auto-touch.
drop trigger if exists tr_rgaios_plans_updated_at on rgaios_plans;
create trigger tr_rgaios_plans_updated_at
  before update on rgaios_plans
  for each row execute function rgaios_set_updated_at();
