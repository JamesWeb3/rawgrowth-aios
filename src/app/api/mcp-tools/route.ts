import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  draftCustomMcpTool,
  validateToolName,
} from "@/lib/mcp/custom-tools";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/mcp-tools
 *   List rgaios_custom_mcp_tools for the active org. Used by the
 *   dashboard widget so the operator can see which Atlas-authored
 *   tools exist in any state.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin()
    .from("rgaios_custom_mcp_tools")
    .select(
      "id, name, description, status, loop_count, last_error, last_test_output, created_by_agent_id, created_at, updated_at",
    )
    .eq("organization_id", ctx.activeOrgId)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ tools: data ?? [] });
}

/**
 * POST /api/mcp-tools
 *   body: { name, description, requestor_prompt }
 *
 * Atlas drafts a TS file matching the registerTool() shape, the row
 * lands in 'draft' state. The operator then hits
 * /api/mcp-tools/[id]/test to actually exercise the sandbox loop.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    requestor_prompt?: string;
  };
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim();
  const requestor_prompt = String(body.requestor_prompt ?? "").trim();
  if (!name || !description || !requestor_prompt) {
    return NextResponse.json(
      { error: "name, description, requestor_prompt are required" },
      { status: 400 },
    );
  }
  const nameErr = validateToolName(name);
  if (nameErr) {
    return NextResponse.json({ error: nameErr }, { status: 400 });
  }

  // Refuse to create a row when one with the same name already exists.
  // The unique index would block it anyway, but a clean 409 is nicer
  // than a Postgres exception.
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("rgaios_custom_mcp_tools")
    .select("id, status")
    .eq("organization_id", ctx.activeOrgId)
    .eq("name", name)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: `tool "${name}" already exists in status "${(existing as { status: string }).status}". Retry it via /api/mcp-tools/[id]/test or pick a new name.`,
      },
      { status: 409 },
    );
  }

  const draft = await draftCustomMcpTool({
    orgId: ctx.activeOrgId,
    name,
    description,
    requestor_prompt,
  });
  if (!draft.ok) {
    return NextResponse.json({ error: draft.error }, { status: 502 });
  }

  const { data, error } = await db
    .from("rgaios_custom_mcp_tools")
    .insert({
      organization_id: ctx.activeOrgId,
      name,
      description,
      code_ts: draft.code,
      status: "draft",
      created_by_agent_id: draft.agentId,
    } as never)
    .select("id, name, status, loop_count, code_ts")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tool: data });
}
