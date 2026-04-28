import { getOrgContext } from "@/lib/auth/admin";

/**
 * The seeded admin organization  -  the Rawgrowth team's own tenant. Users
 * whose `organization_id` matches this row are platform admins who can
 * impersonate any other org via the admin view cookie.
 *
 * Kept as a constant so `/api/admin/*` endpoints can check it without
 * hitting the DB.
 */
export const DEFAULT_ORGANIZATION_ID =
  "323cd2bf-7548-4ce1-8f25-9a66d1c3972c";

export const DEFAULT_ORGANIZATION_NAME = "Rawgrowth";
export const DEFAULT_ORGANIZATION_SLUG = "rawgrowth";

/**
 * Resolves the "active" organization id for the current request via the
 * authenticated session (respects admin impersonation through the
 * rg_admin_view_org cookie).
 *
 * Throws on missing session. Prior versions silently fell back to
 * DEFAULT_ORGANIZATION_ID, which meant any route that forgot to call
 * getOrgContext() would default to Rawgrowth's tenant data instead of
 * 401-ing. Cron + webhook paths must look up org_id from their own
 * verified context (CRON_SECRET, connection-id signature).
 */
export async function currentOrganizationId(): Promise<string> {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    throw new Error(
      "currentOrganizationId: no authenticated session — route must guard with getOrgContext or use a webhook-scoped resolver",
    );
  }
  return ctx.activeOrgId;
}
