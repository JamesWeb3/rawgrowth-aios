-- Approve / Reject loop for insights.
--
-- New status values: 'executing' (operator approved → tasks running)
--                    'rejected'  (operator killed the plan)
--
-- Existing values: 'open' | 'acknowledged' | 'dismissed' | 'resolved'
--
-- approved_at + rejected_at + dismissed_at + acknowledged_at columns
-- are added (acknowledged_at + dismissed_at may already exist from
-- the original 0048; CREATE COLUMN IF NOT EXISTS handles it).

alter table rgaios_insights
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists dismissed_at timestamptz;

-- Status check constraint (drop + readd to extend with new values)
alter table rgaios_insights drop constraint if exists rgaios_insights_status_check;
alter table rgaios_insights add constraint rgaios_insights_status_check
  check (status in ('open', 'acknowledged', 'dismissed', 'resolved', 'executing', 'rejected'));

-- Index on (org, status) for fast alarm-banner queries (status='open' OR 'executing')
create index if not exists rgaios_insights_org_status_open_idx
  on rgaios_insights (organization_id, status)
  where status in ('open', 'executing');
