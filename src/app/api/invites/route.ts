import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { createInvite } from "@/lib/members/queries";
import { sendInviteEmail } from "@/lib/auth/email";
import { supabaseAdmin } from "@/lib/supabase/server";
import { KNOWN_DEPARTMENT_SLUGS } from "@/lib/auth/dept-acl";
import { isEmail } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    role?: "owner" | "admin" | "member" | "developer";
    allowed_departments?: string[];
  };
  const email = String(body.email ?? "").trim().slice(0, 254);
  const name = body.name ? String(body.name).trim().slice(0, 200) : null;
  const role = body.role && ["owner", "admin", "member", "developer"].includes(body.role)
    ? body.role
    : "member";
  // Whitelist against known dept slugs so a forged client can't grant
  // visibility to non-existent departments. Empty/missing = full access.
  const knownSet = new Set<string>(KNOWN_DEPARTMENT_SLUGS);
  const allowedDepartments = Array.isArray(body.allowed_departments)
    ? body.allowed_departments
        .filter((s): s is string => typeof s === "string")
        .filter((s) => knownSet.has(s))
    : [];

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  try {
    const { token } = await createInvite({
      organizationId: ctx.activeOrgId,
      email,
      name,
      role,
      invitedBy: ctx.userId,
      allowedDepartments,
    });

    const db = supabaseAdmin();
    const [{ data: org }, { data: inviter }] = await Promise.all([
      db
        .from("rgaios_organizations")
        .select("name")
        .eq("id", ctx.activeOrgId)
        .maybeSingle(),
      db
        .from("rgaios_users")
        .select("name")
        .eq("id", ctx.userId)
        .maybeSingle(),
    ]);

    const base = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
    const inviteUrl = `${base}/auth/invite?token=${encodeURIComponent(token)}`;

    await sendInviteEmail({
      to: email,
      inviteUrl,
      organizationName: org?.name ?? "your organization",
      inviterName: inviter?.name ?? null,
      recipientName: name,
    });

    await db.from("rgaios_audit_log").insert({
      organization_id: ctx.activeOrgId,
      kind: "member_invited",
      actor_type: "user",
      actor_id: ctx.userId,
      detail: { email, role, allowed_departments: allowedDepartments },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
