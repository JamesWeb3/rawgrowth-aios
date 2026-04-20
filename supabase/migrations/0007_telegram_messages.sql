-- Inbox for inbound Telegram bot messages. The webhook writes every
-- message here; the client's Claude Code reads from this table via
-- MCP and replies via telegram_reply.

create table if not exists rgaios_telegram_messages (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references rgaios_organizations(id) on delete cascade,
  connection_id     uuid not null references rgaios_connections(id) on delete cascade,
  chat_id           bigint not null,
  sender_user_id    bigint,
  sender_username   text,
  sender_first_name text,
  message_id        bigint not null,
  text              text,
  received_at       timestamptz not null default now(),
  responded_at      timestamptz,
  response_text     text
);

create index if not exists idx_rgaios_telegram_messages_org
  on rgaios_telegram_messages(organization_id);

create index if not exists idx_rgaios_telegram_messages_unread
  on rgaios_telegram_messages(organization_id, responded_at)
  where responded_at is null;
