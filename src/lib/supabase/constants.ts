/**
 * Default organization used by every server route until auth is wired.
 * Seeded by supabase/migrations/0001_init.sql.
 *
 * When NextAuth lands, replace every `currentOrganizationId()` call with
 * a lookup from the session JWT and delete this constant.
 */
export const DEFAULT_ORGANIZATION_ID =
  "00000000-0000-0000-0000-000000000001";

export function currentOrganizationId(): string {
  // TODO(auth): resolve from NextAuth session.
  return DEFAULT_ORGANIZATION_ID;
}
