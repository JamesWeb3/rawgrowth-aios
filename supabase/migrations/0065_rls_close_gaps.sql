-- 0065: Close the four remaining RLS gaps the Cloud advisor flagged
-- on the Marti project (and that every fresh client would inherit
-- without this migration). All four were created in earlier migrations
-- without enabling row-level security, so any anon-key query against
-- them would return cross-tenant rows.
--
-- Tables touched:
--   - rgaios_agent_chat_messages   (per-agent chat history; CRITICAL)
--   - rgaios_agent_telegram_bots   (bot tokens per agent; CRITICAL)
--   - rgaios_onboarding_knowledge  (shared seed; LOW but tidy)
--   - rgaios_provisioning_queue    (internal queue; LOW but tidy)
--
-- Policy pattern matches every other org-scoped rgaios_* table:
-- `using (organization_id = rgaios_current_org_id())` plus the same
-- predicate in `with check`. supabaseAdmin() with the service-role key
-- bypasses RLS, so server routes keep working without changes; the
-- only behaviour difference is that anon-key calls now respect the
-- per-org filter.
--
-- Idempotent: every statement uses IF NOT EXISTS / DROP IF EXISTS.

-- ─── rgaios_agent_chat_messages ──────────────────────────────────
alter table rgaios_agent_chat_messages enable row level security;
alter table rgaios_agent_chat_messages force row level security;
drop policy if exists rgaios_v3_agent_chat_messages_org_isolation
  on rgaios_agent_chat_messages;
create policy rgaios_v3_agent_chat_messages_org_isolation
  on rgaios_agent_chat_messages
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

-- ─── rgaios_agent_telegram_bots ──────────────────────────────────
alter table rgaios_agent_telegram_bots enable row level security;
alter table rgaios_agent_telegram_bots force row level security;
drop policy if exists rgaios_v3_agent_telegram_bots_org_isolation
  on rgaios_agent_telegram_bots;
create policy rgaios_v3_agent_telegram_bots_org_isolation
  on rgaios_agent_telegram_bots
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

-- ─── rgaios_onboarding_knowledge ─────────────────────────────────
-- Shared static seed: rows aren't org-scoped by intent (every org sees
-- the same chunks). RLS-on with `using (true)` keeps the advisor happy
-- without changing query behaviour.
alter table rgaios_onboarding_knowledge enable row level security;
alter table rgaios_onboarding_knowledge force row level security;
drop policy if exists rgaios_v3_onboarding_knowledge_read_all
  on rgaios_onboarding_knowledge;
create policy rgaios_v3_onboarding_knowledge_read_all
  on rgaios_onboarding_knowledge
  for select using (true);

-- ─── rgaios_provisioning_queue ───────────────────────────────────
alter table rgaios_provisioning_queue enable row level security;
alter table rgaios_provisioning_queue force row level security;
drop policy if exists rgaios_v3_provisioning_queue_org_isolation
  on rgaios_provisioning_queue;
create policy rgaios_v3_provisioning_queue_org_isolation
  on rgaios_provisioning_queue
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

-- ─── Defense-in-depth: force RLS on the six tables that have it
-- enabled but not forced. service-role still bypasses; this only
-- changes behaviour for the table's own owner role, which in Supabase
-- normal-deployment surface area is no-op. Cheap to add now.
alter table rgaios_custom_mcp_tools          force row level security;
alter table rgaios_insights                  force row level security;
alter table rgaios_kalendly_availability     force row level security;
alter table rgaios_kalendly_bookings         force row level security;
alter table rgaios_kalendly_calendar_bindings force row level security;
alter table rgaios_kalendly_event_types      force row level security;
alter table rgaios_mini_saas                 force row level security;
alter table rgaios_shared_memory             force row level security;
