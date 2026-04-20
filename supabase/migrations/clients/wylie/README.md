# Wylie Hawkins X-Ray — client-specific migrations

These migrations **only run on the VPS whose `SEED_ORG_SLUG=wylie`**.
`scripts/migrate.ts` discovers this folder by its name matching the seed
slug, namespaces the tracking key as `clients/wylie/<file>.sql` in
`rgaios_schema_migrations`, and runs each file in order after the
platform migrations.

## Conventions

- Prefix tables with `wylie_` (e.g. `wylie_agents`, `wylie_policies`) so
  they're never mistaken for platform tables.
- Foreign-key into platform tables is fine (e.g. `wylie_agents` linking
  to `rgaios_users`), but platform migrations must not depend on anything
  in here.
- Number files from `0001_*.sql` (per-client numbering is independent of
  the platform sequence).

## Planned

- `0001_agents.sql` — 336 reps, contract tier, manager, office
- `0002_offices.sql` — three physical offices
- `0003_policies.sql` — carrier issued-premium imports
- `0004_kpi_daily.sql` — 4/4 ritual digitized
- `0005_training_content.sql` + `0006_training_progress.sql`
- `0007_leads.sql` + `0008_calls.sql` (CRM phase)
