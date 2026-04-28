import { registerTool, text, textError } from "../registry";
import { decideApproval, listApprovals } from "@/lib/approvals/queries";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * MCP tools for the approvals inbox. Lets clients review and decide
 * approval requests from Claude Code without bouncing to the web UI.
 *
 * `reviewer_id` is looked up from the org's first owner when called via
 * MCP  -  audit log still records a real human, since the bearer token
 * authenticates the organization, not an individual user.
 */

async function resolveReviewerId(organizationId: string): Promise<string> {
  const { data } = await supabaseAdmin()
    .from("rgaios_users")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) {
    throw new Error(
      "No owner user found for this organization  -  cannot record reviewer.",
    );
  }
  return data.id;
}

// ─── approvals_list ────────────────────────────────────────────────

registerTool({
  name: "approvals_list",
  description:
    "List approval requests queued by agents. Filter by status (default: pending). Use this to see what Claude Code sessions or agents are waiting on human oversight to execute.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description:
          "Filter by status: pending, approved, rejected, all (default: pending).",
      },
      limit: {
        type: "number",
        description: "Max results (default 20, max 100).",
      },
    },
  },
  handler: async (args, ctx) => {
    const allowed = ["pending", "approved", "rejected", "all"] as const;
    const status = (allowed as readonly string[]).includes(String(args.status ?? "pending"))
      ? (String(args.status ?? "pending") as (typeof allowed)[number])
      : "pending";
    const limit = Math.min(Number(args.limit ?? 20) || 20, 100);

    const rows = await listApprovals(ctx.organizationId, status, limit);
    if (rows.length === 0) return text(`No ${status} approvals.`);

    const lines = [
      `Found ${rows.length} ${status} approval(s):`,
      "",
      ...rows.map((r) => {
        const ctxLine = [
          r.agent_name ? `agent: ${r.agent_name}` : null,
          r.routine_title ? `routine: ${r.routine_title}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return [
          `- \`${r.id}\`  -  tool: \`${r.tool_name}\` (${r.status})`,
          ctxLine ? `    ${ctxLine}` : "",
          r.reason ? `    reason: ${r.reason}` : "",
          `    args: \`${JSON.stringify(r.tool_args).slice(0, 120)}\``,
        ]
          .filter(Boolean)
          .join("\n");
      }),
    ];
    return text(lines.join("\n"));
  },
});

// ─── approvals_decide ──────────────────────────────────────────────

registerTool({
  name: "approvals_decide",
  description:
    "Approve or reject a pending approval. On 'approved' the underlying MCP tool executes immediately with its stored arguments. On 'rejected' the row is just marked without running anything.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Approval id (from approvals_list)." },
      decision: {
        type: "string",
        description: "Must be 'approved' or 'rejected'.",
      },
    },
    required: ["id", "decision"],
  },
  handler: async (args, ctx) => {
    const id = String(args.id ?? "").trim();
    const decision = String(args.decision ?? "");
    if (!id) return textError("id is required");
    if (decision !== "approved" && decision !== "rejected") {
      return textError("decision must be 'approved' or 'rejected'");
    }

    const reviewerId = await resolveReviewerId(ctx.organizationId);
    const result = await decideApproval({
      organizationId: ctx.organizationId,
      approvalId: id,
      decision,
      reviewerId,
    });

    if (decision === "approved") {
      return text(
        [
          `Approved \`${id}\`  -  executed \`${result.approval.tool_name}\`.`,
          result.executionResult
            ? `Result: ${result.executionResult.slice(0, 500)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return text(`Rejected \`${id}\`.`);
  },
});
