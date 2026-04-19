import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Per-tenant MCP token helpers.
 *
 * Token format: `rgmcp_<48 hex chars>` (~192 bits of entropy). Stored
 * in rgaios_organizations.mcp_token under a unique index. Resolution is
 * a single indexed lookup on each MCP request.
 */

export const TOKEN_PREFIX = "rgmcp_";

export function generateMcpToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(24).toString("hex");
}

export function parseBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

/**
 * Look up the organization that owns a given MCP bearer token.
 * Returns null if no match — the caller should 401.
 */
export async function resolveOrgFromToken(
  token: string,
): Promise<{ id: string; name: string } | null> {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const { data, error } = await supabaseAdmin()
    .from("rgaios_organizations")
    .select("id, name")
    .eq("mcp_token", token)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}
