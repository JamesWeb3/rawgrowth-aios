-- ================================================================
-- Per-tenant MCP tokens.
--
-- Each organization gets a unique, rotatable bearer token. Claude Desktop
-- / Cursor / Claude Cowork configs for a client use THIS token, and our
-- /api/mcp route resolves the calling org by looking it up here. Replaces
-- the single shared MCP_BEARER_TOKEN env var.
-- ================================================================

alter table rgaios_organizations
  add column if not exists mcp_token text;

-- Unique index — one active token per org; NULL allowed while provisioning.
create unique index if not exists rgaios_organizations_mcp_token_uq
  on rgaios_organizations (mcp_token)
  where mcp_token is not null;

-- Backfill the admin org with a generated token so the existing
-- Claude Desktop config keeps working after this migration. Clients
-- created after this run get tokens via the provisioning API.
update rgaios_organizations
  set mcp_token = 'rgmcp_' || encode(gen_random_bytes(24), 'hex')
  where id = '323cd2bf-7548-4ce1-8f25-9a66d1c3972c'
    and mcp_token is null;
