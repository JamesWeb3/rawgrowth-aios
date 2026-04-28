-- v3 mode: multi-tenant shared Supabase. Relaxes the single-org-per-VPS
-- invariant that self_hosted relies on and replaces it with Row-Level
-- Security keyed to the `organization_id` claim carried by NextAuth JWTs.
--
-- service_role (used by the app server with SUPABASE_SERVICE_ROLE_KEY)
-- bypasses RLS by default — these policies only affect clients that
-- present an anon/authenticated JWT with an `organization_id` claim.
--
-- Idempotent: safe to re-run.

-- Helper: extract organization_id from the JWT as a uuid (null if missing or
-- malformed). Marked stable so the planner can cache per-statement.
create or replace function rgaios_current_org_id() returns uuid
  language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.organization_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'organization_id')
    ),
    ''
  )::uuid
$$;

-- Tables with a direct organization_id column: same policy pattern for all.
do $$
declare
  tbl text;
  tables_with_org text[] := array[
    'rgaios_connections',
    'rgaios_knowledge_files',
    'rgaios_agents',
    'rgaios_agent_skills',
    'rgaios_routines',
    'rgaios_routine_triggers',
    'rgaios_routine_runs',
    'rgaios_approvals',
    'rgaios_audit_log',
    'rgaios_telegram_messages',
    'rgaios_slack_bindings'
  ];
begin
  foreach tbl in array tables_with_org loop
    execute format('alter table %I enable row level security', tbl);
    execute format('alter table %I force row level security', tbl);
    execute format('drop policy if exists rgaios_v3_org_isolation on %I', tbl);
    execute format(
      'create policy rgaios_v3_org_isolation on %I
         using (organization_id = rgaios_current_org_id())
         with check (organization_id = rgaios_current_org_id())',
      tbl
    );
  end loop;
end $$;

-- rgaios_organizations: a row is visible only to members of that org.
alter table rgaios_organizations enable row level security;
alter table rgaios_organizations force row level security;
drop policy if exists rgaios_v3_org_self on rgaios_organizations;
create policy rgaios_v3_org_self on rgaios_organizations
  using (id = rgaios_current_org_id())
  with check (id = rgaios_current_org_id());

-- rgaios_users: filtered through membership. A user is visible only if they
-- share an org with the caller.
alter table rgaios_users enable row level security;
alter table rgaios_users force row level security;
drop policy if exists rgaios_v3_users_via_membership on rgaios_users;
create policy rgaios_v3_users_via_membership on rgaios_users
  using (
    exists (
      select 1 from rgaios_organization_memberships m
      where m.user_id = rgaios_users.id
        and m.organization_id = rgaios_current_org_id()
    )
  )
  with check (
    exists (
      select 1 from rgaios_organization_memberships m
      where m.user_id = rgaios_users.id
        and m.organization_id = rgaios_current_org_id()
    )
  );

-- rgaios_organization_memberships: policy keyed by organization_id column.
alter table rgaios_organization_memberships enable row level security;
alter table rgaios_organization_memberships force row level security;
drop policy if exists rgaios_v3_memberships_org_isolation on rgaios_organization_memberships;
create policy rgaios_v3_memberships_org_isolation on rgaios_organization_memberships
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

-- rgaios_invites: same, carries organization_id directly.
alter table rgaios_invites enable row level security;
alter table rgaios_invites force row level security;
drop policy if exists rgaios_v3_invites_org_isolation on rgaios_invites;
create policy rgaios_v3_invites_org_isolation on rgaios_invites
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

-- rgaios_password_resets: filtered through the user's membership. The caller
-- is typically unauthenticated (resetting password), so the app hits this
-- table with service_role and bypasses RLS entirely. The policy exists for
-- belt-and-suspenders if an authenticated client ever touches the table.
alter table rgaios_password_resets enable row level security;
alter table rgaios_password_resets force row level security;
drop policy if exists rgaios_v3_resets_via_user on rgaios_password_resets;
create policy rgaios_v3_resets_via_user on rgaios_password_resets
  using (
    exists (
      select 1 from rgaios_organization_memberships m
      where m.user_id = rgaios_password_resets.user_id
        and m.organization_id = rgaios_current_org_id()
    )
  );

-- rgaios_schema_migrations: operational table, service_role only. No policy
-- needed beyond forcing RLS so non-service callers see nothing.
alter table rgaios_schema_migrations enable row level security;
alter table rgaios_schema_migrations force row level security;
