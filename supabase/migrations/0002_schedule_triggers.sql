-- ================================================================
-- Schedule triggers — add last_fired_at column + a targeted partial
-- index so the cron tick can cheap-scan only enabled schedule rows.
-- ================================================================

alter table rgaios_routine_triggers
  add column if not exists last_fired_at timestamptz;

-- Small index that only covers schedule triggers we actually fire.
create index if not exists rgaios_routine_triggers_active_schedule_idx
  on rgaios_routine_triggers (organization_id)
  where kind = 'schedule' and enabled = true;
