-- Track when an insight escalated to human due to autoresearch loop
-- cap (Karpathy-style hard stop after N retries). Pedro 2026-05-05.
alter table rgaios_insights
  add column if not exists escalated_at timestamptz;
