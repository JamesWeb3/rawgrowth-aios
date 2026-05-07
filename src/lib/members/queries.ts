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
      `email, name, role, created_at, expires_at, accepted_at,
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
    }));
}

export async function createInvite(params: {
  organizationId: string;
  email: string;
  name: string | null;
  role: MemberRole;
  invitedBy: string;
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

  const { error } = await db.from("rgaios_invites").insert({
    token_hash: tokenHash,
    email,
    name: params.name,
    role: params.role,
    organization_id: params.organizationId,
    invited_by: params.invitedBy,
    expires_at: expiresAt,
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
