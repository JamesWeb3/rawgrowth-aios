-- The per-Department-Head Telegram path inserts inbox rows with
-- agent_telegram_bot_id set and connection_id null (the legacy
-- org-level connection no longer applies). The original 0007 migration
-- declared connection_id NOT NULL, so those inserts were silently
-- failing inside the webhook's after() block — the drain skill saw
-- "Inbox zero" and gave up.
--
-- Relax the constraint. We still require AT LEAST ONE of the two ids
-- so an orphan row can't slip in.

alter table rgaios_telegram_messages
  alter column connection_id drop not null;

alter table rgaios_telegram_messages
  add constraint rgaios_telegram_messages_source_check
    check (connection_id is not null or agent_telegram_bot_id is not null);
