-- Insight → Atlas chat handoff (Pedro request 2026-05-05).
--
-- Each insight card now has an "Open chat" button that seeds the
-- insight's "Question for you" into the Atlas chat thread as the next
-- assistant turn. To prevent stacking when the operator clicks several
-- cards in a row, we serialize: only ONE insight at a time can be in
-- state='sent' (last assistant turn = the question, awaiting a user
-- reply). Newer clicks land in state='queued' and get promoted to
-- 'sent' after the operator answers the active one.
--
-- States:
--   none      - default; never opened in chat
--   queued    - user clicked Open chat but another question is active;
--               waits for that one to be answered before being sent
--   sent      - the question has been written into the Atlas thread as
--               an assistant turn and is awaiting a user reply
--   answered  - user replied; insight is "complete" from the chat side
--               (status field still tracks acknowledge/dismiss/approve)

alter table rgaios_insights
  add column if not exists chat_state text not null default 'none'
    check (chat_state in ('none','queued','sent','answered')),
  add column if not exists chat_state_updated_at timestamptz;

create index if not exists rgaios_insights_chat_state_idx
  on rgaios_insights (organization_id, chat_state, created_at);
