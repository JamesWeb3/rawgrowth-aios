# Supabase

Source of truth for the schema is `migrations/0001_init.sql`.

## How to apply

Phase 1 keeps it simple — copy-paste the migration into the Supabase SQL Editor.

1. Open your Supabase project → **SQL Editor** → **New query**
2. Paste the contents of `migrations/0001_init.sql`
3. Click **Run**

You should see "Success. No rows returned" and all tables listed under **Database → Tables**.

## Verify

```sql
select count(*) from rgaios_organizations;
-- expect 1 (the seeded MVP org)

select id, slug, name from rgaios_organizations;
-- id = 00000000-0000-0000-0000-000000000001
```

## When schema changes

For MVP, hand-edit the migration file, paste into SQL Editor again, re-run. Most changes in `0001_init.sql` are `create table`-level, so it's safe to re-run — if not, drop the table first.

When the schema stabilises, either:
- Run `npx supabase init && npx supabase link --project-ref <ref>` to manage migrations via the CLI
- Or regenerate types with `npx supabase gen types typescript --project-id <ref> --schema public > src/lib/supabase/types.ts`
