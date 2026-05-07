-- Per-department invite scope. Admin chooses which dept slugs the invitee
-- will see when they accept; on acceptance the array is copied into
-- rgaios_organization_memberships.allowed_departments (migration 0037).
--
-- Empty array = no restriction (full visibility, current behavior).
-- Non-empty = invitee is scoped to only those dept slugs.

alter table rgaios_invites
  add column if not exists allowed_departments text[] not null default '{}'::text[];

comment on column rgaios_invites.allowed_departments is
  'Empty = full visibility. Non-empty = scope invitee to listed dept slugs (copied to memberships on accept).';
