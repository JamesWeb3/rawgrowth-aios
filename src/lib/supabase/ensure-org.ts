import { supabaseAdmin } from "./server";
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_ORGANIZATION_NAME,
  DEFAULT_ORGANIZATION_SLUG,
} from "./constants";

/**
 * Idempotently upserts the default organization row so write paths
 * can't hit a foreign-key violation when the seed insert was skipped or
 * the DB was re-provisioned. Memoised per server cold start.
 *
 * Delete this when NextAuth + real org provisioning lands.
 */

let ensured = false;

export async function ensureDefaultOrganization(): Promise<void> {
  if (ensured) return;
  const { error } = await supabaseAdmin()
    .from("rgaios_organizations")
    .upsert(
      {
        id: DEFAULT_ORGANIZATION_ID,
        name: DEFAULT_ORGANIZATION_NAME,
        slug: DEFAULT_ORGANIZATION_SLUG,
      },
      { onConflict: "id" },
    );
  if (error) {
    // Don't throw — the underlying write will still surface a useful error
    // if this really failed for a structural reason. Just log + re-try next time.
    console.error("[ensureDefaultOrganization] failed:", error.message);
    return;
  }
  ensured = true;
}
