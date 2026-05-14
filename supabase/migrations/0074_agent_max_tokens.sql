-- 0074: Per-agent reasoning token budget.
--
-- chatReply (src/lib/agent/chat.ts) had a single global
-- DEFAULT_MAX_TOKENS = 32768 that capped every agent's reply. The
-- agent now opens each reply with a <thinking> ReAct block on top of
-- the visible answer, and some agents (orchestrators, code-heavy
-- heads) need real headroom - 64k - while most are fine at 32k.
-- "tem que ser 32/64 por agente": make the ceiling configurable per
-- agent instead of one global number.
--
-- Nullable on purpose: NULL = "use chatReply's DEFAULT_MAX_TOKENS".
-- Only rows that explicitly want a different ceiling carry a value.
-- max_tokens only caps OUTPUT and is not pre-paid, so a higher
-- ceiling is free until the model actually uses it.
--
-- Additive + idempotent: add column if not exists. Safe to re-run.

alter table rgaios_agents
  add column if not exists max_tokens integer;

comment on column rgaios_agents.max_tokens is
  'Per-agent Anthropic max_tokens ceiling for chatReply. NULL = use the global DEFAULT_MAX_TOKENS (32768). Typical explicit values: 32768 or 65536.';
