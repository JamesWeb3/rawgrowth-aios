-- 0069: Distinguish real automated workflows from one-shot chat
-- delegation artifacts on rgaios_routines.
--
-- Chris's bug (2026-05-14): the /routines page shows 161 routines, 157
-- active, almost all "Last run: Never". Root cause: every chat
-- delegation (Atlas `<command type="agent_invoke">` in
-- src/lib/agent/agent-commands.ts execAgentInvoke, and `<task>` blocks
-- in src/lib/agent/tasks.ts extractAndCreateTasks) inserts an
-- rgaios_routines row with status='active' and ZERO triggers. Those are
-- one-shot delegation jobs, not automated workflows - they have no
-- schedule/webhook/trigger - but they pollute the Routines list.
--
-- Fix: a `kind` column. New rows from the chat/delegation paths set
-- kind='delegation'; everything else stays kind='workflow' (the
-- default, so the /api/routines GET and the genuine create flow keep
-- working with zero code change beyond the list filter).
--
-- Backfill: any EXISTING routine with zero triggers whose runs all came
-- from a chat source ('chat_command' | 'chat_task') is a delegation
-- artifact - tag it so the historical 161 stop polluting the list.
-- Routines with at least one trigger, or with runs from a real trigger
-- source (schedule/webhook/integration/telegram/manual), are left as
-- 'workflow'. Nothing is deleted.
--
-- Additive + idempotent: `add column if not exists` plus a backfill
-- UPDATE that is a no-op on re-run (rows already 'delegation' stay so;
-- the WHERE clause re-selects the same set).

alter table rgaios_routines
  add column if not exists kind text not null default 'workflow';

comment on column rgaios_routines.kind is
  'workflow = real automated routine (has/expects a trigger; shown on /routines). delegation = one-shot chat delegation artifact created by agent_invoke or a <task> block (hidden from /routines, still visible via Tasks). Set by src/lib/agent/agent-commands.ts + src/lib/agent/tasks.ts; filtered in src/lib/routines/queries.ts listRoutinesForOrg.';

-- Backfill historical delegation artifacts: zero triggers AND at least
-- one run, every run sourced from chat. A routine with no runs at all
-- is left as 'workflow' (could be a freshly-created real routine).
update rgaios_routines r
set kind = 'delegation'
where r.kind = 'workflow'
  and not exists (
    select 1 from rgaios_routine_triggers t
    where t.routine_id = r.id
  )
  and exists (
    select 1 from rgaios_routine_runs run
    where run.routine_id = r.id
  )
  and not exists (
    select 1 from rgaios_routine_runs run
    where run.routine_id = r.id
      and run.source not in ('chat_command', 'chat_task')
  );
