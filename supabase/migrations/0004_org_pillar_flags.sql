-- Per-organization toggles for which business pillars to render on the
-- Dashboard. Every org starts with all four enabled so existing tenants
-- see no change; clients tailor this per engagement.

alter table rgaios_organizations
  add column if not exists marketing boolean not null default true,
  add column if not exists sales boolean not null default true,
  add column if not exists fulfilment boolean not null default true,
  add column if not exists finance boolean not null default true;
