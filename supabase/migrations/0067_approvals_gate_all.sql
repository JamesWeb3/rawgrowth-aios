-- 0067: Org-level toggle that gates every outbound Composio action
-- behind /approvals.
--
-- Chris's bug 8 (2026-05-12): operator wants to gate every outbound
-- action (Gmail, Slack, HubSpot, etc.) when a client is in a sensitive
-- phase, not just the write_policy=approval-required subset. The full
-- "per-agent or per-action-type" matrix from the spec is a follow-up;
-- this column ships the org-wide kill switch that composio_use_tool
-- inspects on every invocation. Default false = zero behaviour change
-- for existing clients.

alter table rgaios_organizations
  add column if not exists approvals_gate_all boolean not null default false;

comment on column rgaios_organizations.approvals_gate_all is
  'When true, every composio_use_tool call writes an rgaios_approvals row instead of executing. Operator decides via /approvals. See src/lib/mcp/tools/composio-router.ts handler.';
