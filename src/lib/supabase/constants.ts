import { getOrgContext } from "@/lib/auth/admin";

/**
 * The seeded admin organization — the Rawgrowth team's own tenant. Users
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
 * Resolves the "active" organization id for the current request.
 *
 *   1. If the user is signed in, use their org context (respects admin
 *      impersonation via the rg_admin_view_org cookie).
 *   2. If not signed in (e.g. cron, webhook before auth exists, local
 *      curl in dev), fall back to the default admin org id so the route
 *      doesn't crash — route-level auth guards are the real gatekeeper.
 *
 * Throws if neither a session nor a fallback resolves.
 */
export async function currentOrganizationId(): Promise<string> {
  try {
    const ctx = await getOrgContext();
    if (ctx?.activeOrgId) return ctx.activeOrgId;
  } catch {
    /* no session — fall through */
  }
  return DEFAULT_ORGANIZATION_ID;
}
