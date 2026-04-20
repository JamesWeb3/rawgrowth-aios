-- Pillars are opt-in, not opt-out. A fresh VPS should boot with all four
-- dashboard charts hidden behind the "not configured" empty state so the
-- operator explicitly turns on pillars that actually have data sources
-- wired up for that client.
--
-- Idempotent: flipping defaults is safe to re-run, and the UPDATE only
-- touches rows where the value hasn't already been toggled to false.

alter table rgaios_organizations
  alter column marketing  set default false,
  alter column sales      set default false,
  alter column fulfilment set default false,
  alter column finance    set default false;

update rgaios_organizations
  set marketing = false,
      sales = false,
      fulfilment = false,
      finance = false
  where marketing is true
     or sales is true
     or fulfilment is true
     or finance is true;
