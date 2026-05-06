-- Race-free serialization for insight chat_state='sent' (Pedro audit
-- 2026-05-06).
--
-- The /api/insights/[id]/open-chat handler enforces "at most one
-- chat_state='sent' insight per org" in application code: it queries
-- for an active sent row, falls back to queued if found, else seeds.
-- Two concurrent clicks on different insights both pass that check
-- in the same millisecond and both end up 'sent', stacking unanswered
-- questions in the Atlas thread. Confirmed in ralph-fleet-A-run3:
-- two insights observed in chat_state='sent' simultaneously after
-- back-to-back POSTs.
--
-- Fix: a partial unique index on organization_id where chat_state='sent'
-- so the second concurrent UPDATE flipping a row to 'sent' fails with
-- a 23505 unique_violation. The route handler catches the violation
-- and downgrades the loser to 'queued' instead.

-- Drop any duplicate sent rows that already exist - keep the oldest
-- one per org so chat continuity isn't lost.
update rgaios_insights b
   set chat_state = 'queued',
       chat_state_updated_at = now()
  from rgaios_insights a
 where a.organization_id = b.organization_id
   and a.chat_state = 'sent'
   and b.chat_state = 'sent'
   and a.id <> b.id
   and a.chat_state_updated_at < b.chat_state_updated_at;

create unique index if not exists rgaios_insights_one_sent_per_org_idx
  on rgaios_insights (organization_id)
  where chat_state = 'sent';
