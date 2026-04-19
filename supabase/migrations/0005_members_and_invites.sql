-- Org membership roles + an invites table so existing members can bring
-- new people into their organization by email.

alter table rgaios_users
  add column if not exists role text not null default 'member'
    check (role in ('owner', 'admin', 'member'));

create table if not exists rgaios_invites (
  token_hash text primary key,
  email text not null,
  name text,
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member')),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  invited_by uuid references rgaios_users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_rgaios_invites_org on rgaios_invites(organization_id);
create index if not exists idx_rgaios_invites_email on rgaios_invites(email);
