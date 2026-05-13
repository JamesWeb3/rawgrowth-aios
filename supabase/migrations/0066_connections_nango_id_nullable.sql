-- 0066: Make rgaios_connections.nango_connection_id nullable.
--
-- The column was added when every connection was a Nango/Composio OAuth
-- handshake and a connection_id from the upstream provider was the
-- primary key on their side. v3 added per-org API-key connections
-- (Composio API key, OpenAI, Apify, Stripe, etc.) that have no upstream
-- connection_id - the credential IS the key itself, stored encrypted in
-- metadata.api_key.
--
-- Effect: the existing OAuth path keeps writing a connection_id like
-- before (no behaviour change there). The API-key INSERT path in
-- src/app/api/connections/api-keys/route.ts no longer trips the
-- NOT NULL constraint that surfaced as Chris's bug 2 on 2026-05-12:
--   null value in column "nango_connection_id" of relation
--   "rgaios_connections" violates not-null constraint
--
-- All read sites (callback/webhook/[provider]/route) gate on
-- `existing.nango_connection_id` being truthy before touching the
-- Composio backend, so this is safe.

alter table rgaios_connections
  alter column nango_connection_id drop not null;
