import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  MAX_CUSTOM_TOOL_LOOPS,
  retryCustomMcpTool,
  testCustomMcpTool,
} from "@/lib/mcp/custom-tools";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/mcp-tools/[id]/test
 *   Run the stored draft inside the sandbox eval. On success the row
 *   flips to 'active' and the in-process registry gains the tool. On
 *   failure last_error is captured + Atlas is asked for a revision (up
 *   to MAX_CUSTOM_TOOL_LOOPS retries before escalation).
 *
 *   Mirrors the autoresearch retry pattern in
 *   src/lib/insights/generator.ts so cap behavior is consistent
 *   across self-coding paths.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // First sandbox attempt against whatever code_ts is stored right
  // now. testCustomMcpTool flips the row to 'active' on pass.
  let attempt = await testCustomMcpTool({ orgId: ctx.activeOrgId, toolId: id });
  if (attempt.ok) {
    return NextResponse.json({
      ok: true,
      status: "active",
      output: attempt.output,
      tools: attempt.tools,
      loop_count: 0,
    });
  }

  // Retry loop. Each iteration:
  //   1. Ask Atlas for a fresh draft using last_error as feedback
  //   2. Re-run the sandbox
  // Stops on success, on Atlas drafting failure, or at the cap.
  for (let i = 0; i < MAX_CUSTOM_TOOL_LOOPS; i += 1) {
    const retry = await retryCustomMcpTool({ orgId: ctx.activeOrgId, toolId: id });
    if (!retry.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: retry.escalated ? "escalated" : "failed",
          error: retry.error,
        },
        { status: retry.escalated ? 409 : 502 },
      );
    }
    attempt = await testCustomMcpTool({ orgId: ctx.activeOrgId, toolId: id });
    if (attempt.ok) {
      return NextResponse.json({
        ok: true,
        status: "active",
        output: attempt.output,
        tools: attempt.tools,
        loop_count: retry.loop,
      });
    }
  }

  // Loop cap exhausted without a passing build. Surface the latest
  // error the row carries.
  const { data } = await supabaseAdmin()
    .from("rgaios_custom_mcp_tools")
    .select("last_error, loop_count")
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id)
    .maybeSingle();
  const last = (data ?? {}) as { last_error?: string; loop_count?: number };
  return NextResponse.json(
    {
      ok: false,
      status: "failed",
      error: `loop cap (${MAX_CUSTOM_TOOL_LOOPS}) hit without a passing build. Last error: ${last.last_error ?? "n/a"}`,
      loop_count: last.loop_count ?? MAX_CUSTOM_TOOL_LOOPS,
    },
    { status: 409 },
  );
}
