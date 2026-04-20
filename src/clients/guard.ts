import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/admin";
import { ownerOfPath, getClientModule } from "./registry";

/**
 * Call at the top of a client-module page (Server Component) to make sure
 * the current org is allowed to see it. Returns 404 — not 403 — so other
 * tenants can't even detect that a given module exists on a shared
 * codebase.
 *
 * Usage:
 *   import { assertClientAccess } from "@/clients/guard";
 *   export default async function Page() {
 *     await assertClientAccess("/wylie/leaderboard");
 *     ...
 *   }
 */
export async function assertClientAccess(pathname: string): Promise<void> {
  const owner = ownerOfPath(pathname);
  if (!owner) return; // Not a client-module path — nothing to gate.
  const ctx = await getOrgContext();
  const activeSlug = ctx?.activeOrgSlug ?? null;
  const mine = getClientModule(activeSlug);
  if (!mine || mine.slug !== owner.slug) {
    notFound();
  }
}
