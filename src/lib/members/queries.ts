import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hashToken } from "@/lib/auth/reset-token";
import { hashPassword } from "@/lib/auth/password";

export type MemberRole = "owner" | "admin" | "member" | "developer";

export type MemberRow = {
  id: string;
  email: string;
  name: string | null;
  role: MemberRole;
  created_at: string;
};

export type PendingInvite = {
  email: string;
  name: string | null;
  role: MemberRole;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
  allowed_departments: string[];
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function listMembers(organizationId: string): Promise<MemberRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_users")
    .select("id, email, name, role, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listMembers: ${error.message}`);
  return (data ?? []) as MemberRow[];
}

export async function listPendingInvites(
  organizationId: string,
): Promise<PendingInvite[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("rgaios_invites")
    .select(
      `email, name, role, created_at, expires_at, accepted_at, allowed_departments,
       inviter:invited_by ( name )`,
    )
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listPendingInvites: ${error.message}`);

  type Joined = {
    email: string;
    name: string | null;
    role: MemberRole;
    created_at: string;
    expires_at: string;
    accepted_at: string | null;
    allowed_departments: string[] | null;
    inviter: { name: string | null } | null;
  };

  return (data as Joined[] | null ?? [])
    .filter((r) => new Date(r.expires_at) > new Date())
    .map((r) => ({
      email: r.email,
      name: r.name,
      role: r.role,
      invited_by_name: r.inviter?.name ?? null,
      created_at: r.created_at,
      expires_at: r.expires_at,
      allowed_departments: (r.allowed_departments ?? []) as string[],
    }));
}

export async function createInvite(params: {
  organizationId: string;
  email: string;
  name: string | null;
  role: MemberRole;
  invitedBy: string;
  allowedDepartments?: string[];
}): Promise<{ token: string }> {
  const email = params.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Invalid email");

  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("rgaios_users")
    .select("id, organization_id")
    .eq("email", email)
    .maybeSingle();
  if (existing?.organization_id === params.organizationId) {
    throw new Error("That email is already a member of this organization");
  }
  if (existing) {
    throw new Error(
      "That email belongs to another organization and can't be invited here",
    );
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const allowedDepartments = (params.allowedDepartments ?? []).filter(
    (s) => typeof s === "string" && s.length > 0,
  );

  const { error } = await db.from("rgaios_invites").insert({
    token_hash: tokenHash,
    email,
    name: params.name,
    role: params.role,
    organization_id: params.organizationId,
    invited_by: params.invitedBy,
    expires_at: expiresAt,
    allowed_departments: allowedDepartments,
  });
  if (error) throw new Error(`createInvite: ${error.message}`);

  return { token };
}

export async function acceptInvite(params: {
  token: string;
  password: string;
}): Promise<{ userId: string; organizationId: string }> {
  if (params.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const db = supabaseAdmin();
  const tokenHash = hashToken(params.token);

  const { data: invite, error: fetchErr } = await db
    .from("rgaios_invites")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (fetchErr) throw new Error(`acceptInvite: ${fetchErr.message}`);
  if (!invite) throw new Error("Invalid invitation");
  if (invite.accepted_at) throw new Error("Invitation already accepted");
  if (new Date(invite.expires_at) < new Date()) {
    throw new Error("Invitation has expired");
  }

  const password_hash = await hashPassword(params.password);

  const { data: user, error: insErr } = await db
    .from("rgaios_users")
    .insert({
      email: invite.email,
      name: invite.name,
      password_hash,
      organization_id: invite.organization_id,
      role: invite.role,
    })
    .select("id, organization_id")
    .single();
  if (insErr || !user) throw new Error(`acceptInvite user: ${insErr?.message}`);

  // Mirror the invite's per-department scope onto the membership row so
  // the dept-acl helpers (src/lib/auth/dept-acl.ts) hide non-allowed
  // depts in the sidebar + /agents for this invitee. Empty array = no
  // restriction (matches existing behavior).
  const allowedDepartments = ((invite.allowed_departments as string[] | null) ?? []).filter(
    (s) => typeof s === "string" && s.length > 0,
  );
  // rgaios_organization_memberships isn't in the generated supabase types
  // (matches the existing dept-acl.ts read pattern), so cast through unknown
  // to satisfy the typed builder. Migrations 0001 + 0037 define the shape.
  const membershipRow = {
    organization_id: invite.organization_id,
    user_id: user.id,
    role: invite.role,
    allowed_departments: allowedDepartments,
  } as unknown as never;
  const { error: memErr } = await db
    .from("rgaios_organization_memberships")
    .upsert(membershipRow, { onConflict: "organization_id,user_id" });
  if (memErr) throw new Error(`acceptInvite membership: ${memErr.message}`);

  await db
    .from("rgaios_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);

  return { userId: user.id, organizationId: user.organization_id! };
}

export async function peekInvite(token: string): Promise<{
  email: string;
  name: string | null;
  role: MemberRole;
  organizationName: string;
} | null> {
  const db = supabaseAdmin();
  const tokenHash = hashToken(token);

  const { data } = await db
    .from("rgaios_invites")
    .select(
      `email, name, role, accepted_at, expires_at,
       org:organization_id ( name )`,
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  type Joined = {
    email: string;
    name: string | null;
    role: MemberRole;
    accepted_at: string | null;
    expires_at: string;
    org: { name: string } | null;
  };

  const row = data as Joined | null;
  if (!row) return null;
  if (row.accepted_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  return {
    email: row.email,
    name: row.name,
    role: row.role,
    organizationName: row.org?.name ?? "your organization",
  };
}
