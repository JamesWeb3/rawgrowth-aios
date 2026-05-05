-- Per-org autonomous mode toggle for the insights loop.
--
-- off    - insights detected but not auto-executed; operator must approve
-- review - default; agent proposes plan + waits for explicit approve
-- on     - autonomous; agent auto-approves + executes its own plan, then
--          loops via Atlas autoresearch until metric recovers or N attempts exhausted.
--
-- max_loop_iterations caps the Atlas autoresearch loop. Default 5 -
-- after 5 different-angle attempts that didn't move the metric, escalate
-- to human (status='escalated', alarm stays).

alter table rgaios_organizations
  add column if not exists autonomous_mode text default 'review',
  add column if not exists max_loop_iterations integer default 5;

alter table rgaios_organizations drop constraint if exists rgaios_org_autonomous_mode_check;
alter table rgaios_organizations add constraint rgaios_org_autonomous_mode_check
  check (autonomous_mode in ('off', 'review', 'on'));

-- Allow 'escalated' status on insights (for when loop exhausted attempts)
alter table rgaios_insights drop constraint if exists rgaios_insights_status_check;
alter table rgaios_insights add constraint rgaios_insights_status_check
  check (status in ('open', 'acknowledged', 'dismissed', 'resolved', 'executing', 'rejected', 'escalated'));
