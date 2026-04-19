import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase/server";
import { generateMcpToken } from "@/lib/mcp/token-resolver";

/**
 * Admin-facing client provisioning. Every function assumes the caller
 * has already verified admin status — these don't check themselves.
 */

export type ClientRow = {
  id: string;
  name: string;
  slug: string;
  mcp_token: string | null;
  created_at: string;
  agent_count: number;
  routine_count: number;
  member_count: number;
};

export async function listClients(): Promise<ClientRow[]> {
  const db = supabaseAdmin();
  const { data: orgs, error } = await db
    .from("rgaios_organizations")
    .select("id, name, slug, mcp_token, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listClients: ${error.message}`);
  if (!orgs) return [];

  // Parallel count lookups for each org. Fine at MVP scale.
  const rows = await Promise.all(
    orgs.map(async (o) => {
      const [{ count: agent_count }, { count: routine_count }, { count: member_count }] =
        await Promise.all([
          db
            .from("rgaios_agents")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", o.id),
          db
            .from("rgaios_routines")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", o.id),
          db
            .from("rgaios_users")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", o.id),
        ]);
      return {
        ...o,
        agent_count: agent_count ?? 0,
        routine_count: routine_count ?? 0,
        member_count: member_count ?? 0,
      };
    }),
  );
  return rows;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Find a free slug, appending -2, -3... if needed. */
async function resolveSlug(base: string): Promise<string> {
  const db = supabaseAdmin();
  let candidate = base || "client";
  for (let i = 2; i < 100; i++) {
    const { data } = await db
      .from("rgaios_organizations")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${i}`;
  }
  throw new Error("Could not find a free slug after 100 attempts");
}

export type CreateClientInput = {
  name: string;
  ownerEmail: string;
  ownerName?: string;
  ownerPassword: string;
};

export type CreateClientResult = {
  org: {
    id: string;
    name: string;
    slug: string;
    mcp_token: string;
  };
  owner: {
    id: string;
    email: string;
  };
};

export async function createClient(
  input: CreateClientInput,
): Promise<CreateClientResult> {
  const db = supabaseAdmin();
  const name = input.name.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!name) throw new Error("Client name required");
  if (!ownerEmail) throw new Error("Owner email required");
  if (!input.ownerPassword || input.ownerPassword.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  // Uniqueness check on owner email
  const { data: existingUser } = await db
    .from("rgaios_users")
    .select("id")
    .eq("email", ownerEmail)
    .maybeSingle();
  if (existingUser) {
    throw new Error(`A user already exists with email ${ownerEmail}`);
  }

  const slug = await resolveSlug(slugify(name));
  const mcpToken = generateMcpToken();

  // Create org first so we have the id for the owner's organization_id
  const { data: org, error: orgErr } = await db
    .from("rgaios_organizations")
    .insert({ name, slug, mcp_token: mcpToken })
    .select("id, name, slug, mcp_token")
    .single();
  if (orgErr || !org) {
    throw new Error(`createClient org: ${orgErr?.message}`);
  }

  const passwordHash = await bcrypt.hash(input.ownerPassword, 10);
  const { data: user, error: userErr } = await db
    .from("rgaios_users")
    .insert({
      email: ownerEmail,
      name: input.ownerName?.trim() || null,
      password_hash: passwordHash,
      organization_id: org.id,
    })
    .select("id, email")
    .single();
  if (userErr || !user) {
    // Roll back the org to keep things clean.
    await db.from("rgaios_organizations").delete().eq("id", org.id);
    throw new Error(`createClient owner: ${userErr?.message}`);
  }

  // Audit log
  await db.from("rgaios_audit_log").insert({
    organization_id: org.id,
    kind: "client_provisioned",
    actor_type: "system",
    actor_id: "admin",
    detail: {
      org_id: org.id,
      org_name: org.name,
      owner_email: user.email,
    },
  });

  return {
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      mcp_token: org.mcp_token as string,
    },
    owner: {
      id: user.id,
      email: user.email,
    },
  };
}

export async function rotateMcpToken(
  organizationId: string,
): Promise<string> {
  const token = generateMcpToken();
  const { error } = await supabaseAdmin()
    .from("rgaios_organizations")
    .update({ mcp_token: token })
    .eq("id", organizationId);
  if (error) throw new Error(`rotateMcpToken: ${error.message}`);
  return token;
}
