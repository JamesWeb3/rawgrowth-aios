import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { ADMIN_VIEW_COOKIE, getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isSelfHosted } from "@/lib/deploy-mode";

export async function POST(req: Request) {
  // Single-tenant in self-hosted mode — nothing to switch to.
  if (isSelfHosted) {
    return NextResponse.json({ ok: false, error: "Not available" }, { status: 404 });
  }
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { orgId } = (await req.json().catch(() => ({}))) as { orgId?: string | null };
  const cookieStore = await cookies();

  if (!orgId || orgId === ctx.homeOrgId) {
    cookieStore.delete(ADMIN_VIEW_COOKIE);
    return NextResponse.json({ ok: true, impersonating: false });
  }

  const { data: org } = await supabaseAdmin()
    .from("rgaios_organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) {
    return NextResponse.json({ ok: false, error: "Org not found" }, { status: 404 });
  }

  cookieStore.set(ADMIN_VIEW_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
  });

  return NextResponse.json({ ok: true, impersonating: true, orgId });
}
