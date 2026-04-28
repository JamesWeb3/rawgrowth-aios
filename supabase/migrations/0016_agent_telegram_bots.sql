-- Department Heads + Per-Head Telegram Bots
--
-- Concept: an agent can be marked as the head of their department (CMO,
-- CTO, COO, CEO type roles). Each head can have ONE Telegram bot wired
-- to it — DMs to that bot route to that head as the persona.
--
-- Sub-agents inherit through reports_to but can NOT have their own bot.
-- This is intentional in v1 — keeps the customer-facing surface small.

-- ─── 1. Mark agents as department heads ───────────────────────────
alter table rgaios_agents
  add column if not exists is_department_head boolean not null default false;

-- One head per (organization, department). Sub-agents can have any
-- department slug but is_department_head=false. NULL departments are
-- excluded from the constraint (you can't be head of nothing).
create unique index if not exists rgaios_agents_one_head_per_dept
  on rgaios_agents (organization_id, department)
  where is_department_head = true and department is not null;


-- ─── 2. Per-head Telegram bots ────────────────────────────────────
-- Separate from rgaios_connections (which is one-row-per-provider per
-- org). Multiple bots per org need their own table.
create table if not exists rgaios_agent_telegram_bots (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references rgaios_organizations(id) on delete cascade,
  agent_id          uuid not null references rgaios_agents(id) on delete cascade,
  bot_id            bigint not null,                 -- Telegram's numeric bot id
  bot_username      text,                            -- e.g. @rawgrowth_marketing_bot
  bot_first_name    text,
  bot_token         text not null,                   -- AES-encrypted via @/lib/crypto
  webhook_secret    text not null,                   -- random hex; verifies inbound webhook
  status            text not null default 'connected', -- 'connected' | 'error' | 'disconnected'
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (agent_id),                                 -- one bot per agent
  unique (organization_id, bot_id)                   -- prevent dup bot install
);

create index if not exists rgaios_agent_telegram_bots_org_idx
  on rgaios_agent_telegram_bots (organization_id);


-- ─── 3. Scope chat history by bot ─────────────────────────────────
-- Lets the per-bot webhook keep its conversations separate from any
-- other bot in the org (so Maya's chat history doesn't leak into the
-- CTO bot's context window).
alter table rgaios_telegram_messages
  add column if not exists agent_telegram_bot_id
    uuid references rgaios_agent_telegram_bots(id) on delete cascade;

create index if not exists rgaios_telegram_messages_bot_idx
  on rgaios_telegram_messages (agent_telegram_bot_id);
