import { registerTool, text, textError } from "../registry";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * MCP tools that let local Claude Code drive a routine run end-to-end in
 * self-hosted mode. The autonomous executor doesn't run in this deploy
 * mode  -  instead, Claude Code:
 *
 *   1. Lists pending runs for a routine (or picks one up directly with `runs_claim`).
 *   2. Does the actual work with the other MCP tools (gmail, knowledge, etc.).
 *   3. Calls `runs_complete` with a summary to mark it done.
 *
 * These tools are also safe in hosted mode  -  they work equivalently; the
 * executor just happens to be the usual caller there.
 */

// ─── Tool: runs_list_pending ────────────────────────────────────────

registerTool({
  name: "runs_list_pending",
  description:
    "List pending routine runs for this organization, newest first. Use this to discover work queued by schedules, webhooks, or the UI that a human hasn't yet driven to completion.",
  inputSchema: {
    type: "object",
    properties: {
      routine_id: {
        type: "string",
        description: "Optional  -  filter to a single routine.",
      },
      limit: {
        type: "number",
        description: "Max rows to return (default 20, max 100).",
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = Math.min(Number(args.limit ?? 20) || 20, 100);
    const db = supabaseAdmin();
    let q = db
      .from("rgaios_routine_runs")
      .select(
        `id, routine_id, source, status, input_payload, created_at,
         rgaios_routines:routine_id ( title )`,
      )
      .eq("organization_id", ctx.organizationId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (args.routine_id) q = q.eq("routine_id", String(args.routine_id));
    const { data, error } = await q;
    if (error) return textError(`runs_list_pending: ${error.message}`);

    type Row = {
      id: string;
      routine_id: string;
      source: string;
      status: string;
      input_payload: Record<string, unknown> | null;
      created_at: string;
      rgaios_routines: { title: string } | null;
    };
    const rows = (data as Row[] | null) ?? [];
    if (rows.length === 0) return text("No pending runs.");

    const lines = [
      `Found ${rows.length} pending run(s):`,
      "",
      ...rows.map(
        (r, i) =>
          `${i + 1}. \`${r.id}\`  -  ${r.rgaios_routines?.title ?? r.routine_id} (source: ${r.source}, queued ${r.created_at})`,
      ),
      "",
      "Claim one with `runs_claim` to see its instructions and mark it running.",
    ];
    return text(lines.join("\n"));
  },
});

// ─── Tool: runs_claim ───────────────────────────────────────────────

registerTool({
  name: "runs_claim",
  description:
    "Atomically move a pending run to 'running' and return its routine instructions plus input payload. Use this before doing the actual work for a routine. Returns an error if another process already claimed it.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      run_id: {
        type: "string",
        description: "The id of the run to claim.",
      },
    },
    required: ["run_id"],
  },
  handler: async (args, ctx) => {
    const runId = String(args.run_id ?? "").trim();
    if (!runId) return textError("run_id is required");
    const db = supabaseAdmin();

    const { data: claimed, error } = await db
      .from("rgaios_routine_runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("organization_id", ctx.organizationId)
      .eq("status", "pending")
      .select("id, routine_id, input_payload")
      .maybeSingle();
    if (error) return textError(`runs_claim: ${error.message}`);
    if (!claimed) {
      return textError(
        `Run ${runId} isn't pending  -  another worker may have claimed it already. Call runs_list_pending to find a fresh one.`,
      );
    }

    // why: this is the execution chokepoint for the v3 drain + self_hosted
    // Claude Code paths (the in-process executor stamps last_run_at in
    // claimRun, but those modes never reach claimRun). Without this, a
    // routine driven entirely through MCP would show "Last run: Never" on
    // the Routines page even after Claude Code completed it.
    await db
      .from("rgaios_routines")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", claimed.routine_id)
      .eq("organization_id", ctx.organizationId);

    const { data: routine } = await db
      .from("rgaios_routines")
      .select("title, description")
      .eq("id", claimed.routine_id)
      .maybeSingle();

    const payloadStr =
      claimed.input_payload && Object.keys(claimed.input_payload).length > 0
        ? "```json\n" + JSON.stringify(claimed.input_payload, null, 2) + "\n```"
        : "(no input payload)";

    return text(
      [
        `**Claimed run** \`${claimed.id}\``,
        `**Routine**: ${routine?.title ?? claimed.routine_id}`,
        "",
        "**Instructions:**",
        routine?.description ?? "(no instructions recorded)",
        "",
        "**Input payload:**",
        payloadStr,
        "",
        "Now execute the routine using the available tools. When done, call `runs_complete` with a short summary.",
      ].join("\n"),
    );
  },
});

// ─── Tool: runs_complete ────────────────────────────────────────────

registerTool({
  name: "runs_complete",
  description:
    "Mark a claimed run as succeeded with a short summary of what was done. Call this as the final step after finishing a routine's work.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      run_id: { type: "string" },
      summary: {
        type: "string",
        description: "Plain-text summary  -  what you did, any links or ids the user needs.",
      },
    },
    required: ["run_id", "summary"],
  },
  handler: async (args, ctx) => {
    const runId = String(args.run_id ?? "").trim();
    const summary = String(args.summary ?? "").trim();
    if (!runId) return textError("run_id is required");
    if (!summary) return textError("summary is required");

    const db = supabaseAdmin();
    const { data, error } = await db
      .from("rgaios_routine_runs")
      .update({
        status: "succeeded",
        output: { text: summary, source: "claude_code" },
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("organization_id", ctx.organizationId)
      .in("status", ["pending", "running"])
      .select("id")
      .maybeSingle();
    if (error) return textError(`runs_complete: ${error.message}`);
    if (!data) {
      return textError(
        `Run ${runId} couldn't be completed  -  it may already be finished or doesn't belong to this org.`,
      );
    }
    return text(`Run \`${runId}\` marked as succeeded.`);
  },
});

// ─── Tool: runs_fail ────────────────────────────────────────────────

registerTool({
  name: "runs_fail",
  description:
    "Mark a claimed run as failed with an error message. Use when a routine can't be completed (e.g. missing data, integration error).",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      run_id: { type: "string" },
      error: { type: "string", description: "Short failure reason." },
    },
    required: ["run_id", "error"],
  },
  handler: async (args, ctx) => {
    const runId = String(args.run_id ?? "").trim();
    const errMsg = String(args.error ?? "").trim();
    if (!runId || !errMsg) {
      return textError("run_id and error are required");
    }
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("rgaios_routine_runs")
      .update({
        status: "failed",
        error: errMsg,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("organization_id", ctx.organizationId)
      .in("status", ["pending", "running"])
      .select("id")
      .maybeSingle();
    if (error) return textError(`runs_fail: ${error.message}`);
    if (!data) {
      return textError(`Run ${runId} couldn't be marked failed.`);
    }
    return text(`Run \`${runId}\` marked as failed.`);
  },
});
