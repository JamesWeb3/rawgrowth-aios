-- Postgres ON CONFLICT cannot infer a partial unique index without the
-- caller passing the index_predicate, but supabase-js .upsert() does
-- not surface that knob. The result: every call to
-- seedTelegramConnectionForAgent() returned
--   {seeded: false, reason: "there is no unique or exclusion constraint
--    matching the ON CONFLICT specification"}
-- which silently broke /departments/new (custom-department managers
-- never got a pending_token Telegram bot slot) and any future per-agent
-- upsert that relies on the (org, agent_id, provider_config_key) tuple.
--
-- Fix: drop the partial unique from 0028 and replace with a plain
-- unique on the same three columns. NULL agent_id rows (org-wide
-- integrations like Gmail / org-level Slack) keep working because in
-- Postgres NULL is distinct in unique constraints by default, so two
-- NULL-agent_id rows for the same (org, provider) still coexist; the
-- COALESCE-based index from 0024 (rgaios_connections_org_provider_agent_uniq)
-- continues to enforce uniqueness for that case. For non-NULL agent_id
-- (per-agent integrations) the plain unique works exactly like the
-- partial one did, AND supabase-js .upsert(onConflict=...) can target it.

drop index if exists rgaios_connections_org_agent_provider_key;

create unique index if not exists rgaios_connections_org_agent_provider_key
  on rgaios_connections (organization_id, agent_id, provider_config_key);
