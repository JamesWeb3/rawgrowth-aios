-- Lock the (organization_id, version) pair against the create-side TOCTOU
-- race. Two concurrent regenerations both read latest.version=3 and both
-- insert version=4; the unique index makes the loser fail loud so the
-- caller can retry instead of silently corrupting the "highest version
-- wins" invariant the executor's loadBrandVoice depends on.
create unique index if not exists rgaios_brand_profiles_org_version_uniq
  on rgaios_brand_profiles (organization_id, version);
