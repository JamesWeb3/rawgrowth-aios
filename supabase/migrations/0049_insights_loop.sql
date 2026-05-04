-- Persistent loop fields on rgaios_insights so the system keeps
-- working on a critical anomaly until the metric recovers.
--
-- loop_count       = how many times the agent has tried to fix it
-- last_attempt_at  = when the most recent retry fired (cron throttle)
-- resolved_at      = set when the underlying metric recovers (delta back
--                    inside the threshold). Then status flips to
--                    'resolved' automatically and the alarm clears.

alter table rgaios_insights
  add column if not exists loop_count int not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists resolved_at timestamptz;

create index if not exists idx_rgaios_insights_alarm
  on rgaios_insights (organization_id, severity, status)
  where status = 'open' and severity in ('critical', 'warning');
