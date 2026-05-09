import { NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { badUuidResponse } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * GET /api/agents/<id>/files
 *
 * Nested REST shim that mirrors the legacy /api/agent-files?agentId=<uuid>
 * shape so callers can use the canonical /api/agents/<id>/files path. Both
 * endpoints return identical bodies. Same cross-tenant guard: the agent
 * row must belong to the caller's active org or we 404.
 *
 * Used by:
 *   - Hire-flow E2E smoke (scripts/ralph-hire-flow.mjs) to verify
 *     auto-train ingested starter MDs from src/lib/agents/starter-content/.
 *   - Future per-agent file UIs that prefer nested REST over query strings.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bad = badUuidResponse(id);
  if (bad) return bad;

  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;

  const db = supabaseAdmin();
  // Confirm the agent belongs to the active org before reading any files.
  // Without this guard a user could enumerate files across tenants by
  // guessing UUIDs.
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("rgaios_agent_files")
    .select(
      "id, filename, mime_type, size_bytes, storage_path, uploaded_by, uploaded_at",
    )
    .eq("organization_id", orgId)
    .eq("agent_id", id)
    .order("uploaded_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ files: data ?? [] });
}
