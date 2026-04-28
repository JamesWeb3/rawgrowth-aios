import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";

/**
 * Thin wrapper around the Supabase Management API (api.supabase.com).
 *
 * Auth model: a single Personal Access Token (PAT) per organization, stored
 * encrypted in rgaios_connections.metadata.access_token. The PAT sees every
 * project across every Supabase org the user belongs to  -  so individual MCP
 * calls take a `project_ref` to scope writes/queries.
 *
 * We deliberately bypass Nango here: PATs don't expire and don't refresh,
 * so Nango's OAuth proxy adds no value and only complicates multi-project
 * routing.
 */

const BASE = "https://api.supabase.com";

export type SupabaseOrg = {
  id: string;
  name: string;
};

export type SupabaseProject = {
  id: string;
  organization_id: string;
  name: string;
  region: string;
  created_at: string;
  status: string;
};

export type SupabaseQueryRow = Record<string, unknown>;

export class SupabaseMgmtError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Supabase Management API ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

export async function loadSupabasePat(
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("metadata")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "supabase")
    .maybeSingle();
  const meta = (data?.metadata ?? {}) as { access_token?: string };
  return tryDecryptSecret(meta.access_token);
}

async function call<T>(
  pat: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${pat}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new SupabaseMgmtError(res.status, text);
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export function listOrganizations(pat: string): Promise<SupabaseOrg[]> {
  return call(pat, "GET", "/v1/organizations");
}

export function listProjects(pat: string): Promise<SupabaseProject[]> {
  return call(pat, "GET", "/v1/projects");
}

export function getProject(
  pat: string,
  projectRef: string,
): Promise<SupabaseProject> {
  return call(pat, "GET", `/v1/projects/${projectRef}`);
}

export function createProject(
  pat: string,
  input: {
    organization_id: string;
    name: string;
    region: string;
    db_pass: string;
    plan?: "free" | "pro";
  },
): Promise<SupabaseProject> {
  return call(pat, "POST", "/v1/projects", {
    plan: "free",
    ...input,
  });
}

/** Run arbitrary SQL against a project's database. Returns rows. */
export function runSql(
  pat: string,
  projectRef: string,
  query: string,
): Promise<SupabaseQueryRow[]> {
  return call(pat, "POST", `/v1/projects/${projectRef}/database/query`, {
    query,
  });
}

/** Apply a named migration (creates a versioned migration row). */
export function applyMigration(
  pat: string,
  projectRef: string,
  input: { name: string; query: string },
): Promise<unknown> {
  return call(
    pat,
    "POST",
    `/v1/projects/${projectRef}/database/migrations`,
    input,
  );
}
