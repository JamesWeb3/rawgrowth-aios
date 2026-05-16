import { cookies } from "next/headers";

import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

// ADMIN_ORG_ID identifies the operator org that can create + impersonate
// other client orgs via /api/admin/clients. Defaults to the original
// hosted-mode admin org id, but can be overridden per-VPS via env so a
// fresh deploy can grant admin to its first user without a code change
// or DB rewrite. (Pedro hit this on D2 trying to demo create-org flow.)
export const ADMIN_ORG_ID =
  process.env.ADMIN_ORG_ID ?? "323cd2bf-7548-4ce1-8f25-9a66d1c3972c";
export const ADMIN_VIEW_COOKIE = "rg_admin_view_org";

export type OrgSummary = { id: string; name: string };

export type OrgContext = {
  userId: string;
  userEmail: string | null;
  userName: string | null;
  isAdmin: boolean;
  homeOrgId: string | null;
  activeOrgId: string | null;
  activeOrgName: string | null;
  isImpersonating: boolean;
};

async function getUserProfile(
  userId: string,
): Promise<{
  organization_id: string | null;
  email: string | null;
  name: string | null;
}> {
  const { data } = await supabaseAdmin()
    .from("rgaios_users")
    .select("organization_id, email, name")
    .eq("id", userId)
    .maybeSingle();
  return {
    organization_id: data?.organization_id ?? null,
    email: data?.email ?? null,
    name: data?.name ?? null,
  };
}

export async function getOrgContext(): Promise<OrgContext | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const profile = await getUserProfile(userId);
  const homeOrgId = profile.organization_id;
  const isAdmin = homeOrgId === ADMIN_ORG_ID;

  let activeOrgId = homeOrgId;
  let isImpersonating = false;

  if (isAdmin) {
    const cookieStore = await cookies();
    const viewing = cookieStore.get(ADMIN_VIEW_COOKIE)?.value;
    if (viewing && viewing !== homeOrgId) {
      activeOrgId = viewing;
      isImpersonating = true;
    }
  }

  let activeOrgName: string | null = null;
  if (activeOrgId) {
    const { data } = await supabaseAdmin()
      .from("rgaios_organizations")
      .select("name")
      .eq("id", activeOrgId)
      .maybeSingle();
    activeOrgName = data?.name ?? null;
  }

  return {
    userId,
    userEmail: profile.email,
    userName: profile.name,
    isAdmin,
    homeOrgId,
    activeOrgId,
    activeOrgName,
    isImpersonating,
  };
}

/**
 * Look up the caller's role inside the active org. Used by the chat
 * route to flip the agent preamble from third-person ("the client") to
 * second-person ("you / your") when the operator IS the owner / admin.
 *
 * - Returns "admin" for any user whose home org is the platform ADMIN_ORG_ID
 *   (Rawgrowth operators viewing client VPSes via impersonation).
 * - Returns the rgaios_organization_memberships.role value when set.
 * - Returns null on lookup failure or no membership row (legacy seed flows
 *   create a user without a membership row; treat as no-elevation).
 *
 * Reads are cheap (single .eq().eq().maybeSingle()) so callers can hit
 * this per chat turn without batching.
 */
export async function getActiveOrgRole(
  ctx: OrgContext,
): Promise<"owner" | "admin" | "developer" | "member" | null> {
  if (ctx.isAdmin) return "admin";
  if (!ctx.activeOrgId) return null;
  const { data } = await supabaseAdmin()
    .from("rgaios_organization_memberships")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("organization_id", ctx.activeOrgId)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  if (
    role === "owner" ||
    role === "admin" ||
    role === "developer" ||
    role === "member"
  ) {
    return role;
  }
  return null;
}

export async function listAllOrganizations(): Promise<OrgSummary[]> {
  const { data } = await supabaseAdmin()
    .from("rgaios_organizations")
    .select("id, name")
    .order("name", { ascending: true });
  return (data as OrgSummary[] | null) ?? [];
}
