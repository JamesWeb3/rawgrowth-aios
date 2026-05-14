import { getConnection } from "@/lib/connections/queries";
import { providerConfigKeyFor } from "@/lib/connections/providers";
import type { McpTool, ToolContext, ToolResult } from "./types";

/**
 * Central registry. Tool modules import this and call registerTool()
 * at module load time. The /api/mcp route imports registerAllTools()
 * from ./tools once and serves the registered set.
 *
 * Map key shape (R08 cross-tenant fix):
 *   - global tools (orgId === undefined): keyed on the bare name.
 *   - per-org custom tools (orgId set): keyed on `${orgId}:${name}`.
 * Two orgs can both register a custom tool named `foo` without
 * colliding, and listTools(ctx) / callTool(name, args, ctx) only
 * surface entries that match the caller's organization id.
 */

const tools = new Map<string, McpTool>();

// High-blast tools that ALWAYS queue for operator approval, regardless
// of whether the org opted into approvals_gate_all. supabase_run_sql
// runs arbitrary SQL against a project's Postgres; apply_migration and
// create_project are similarly irreversible. An agent is prompt-
// injectable (the reason crm-sync ships an injection guard), so these
// must never execute unattended on a client's production database.
const ALWAYS_GATE_TOOLS = new Set([
  "supabase_run_sql",
  "supabase_apply_migration",
  "supabase_create_project",
]);

function keyFor(orgId: string | undefined, name: string): string {
  return orgId ? `${orgId}:${name}` : name;
}

/**
 * Whether the org flipped the `approvals_gate_all` kill switch
 * (migration 0067). Fails CLOSED: a transient read failure gates the
 * call rather than silently dropping the protection - the caller gets
 * a clear "approval system failed" error instead of an ungated write.
 */
async function orgGatesAllWrites(organizationId: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    const { data, error } = await supabaseAdmin()
      .from("rgaios_organizations")
      .select("approvals_gate_all")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) {
      console.error(
        `callTool: approvals_gate_all read failed, gating closed: ${error.message}`,
      );
      return true;
    }
    return (
      (data as { approvals_gate_all?: boolean } | null)?.approvals_gate_all ===
      true
    );
  } catch (err) {
    console.error(
      `callTool: approvals_gate_all check threw, gating closed: ${(err as Error).message}`,
    );
    return true;
  }
}

export function registerTool(tool: McpTool): void {
  const key = keyFor(tool.orgId, tool.name);
  if (tools.has(key)) {
    // Turbopack HMR re-runs module side effects on every edit, so the
    // throw fires every time a dev edits a tool file. In production the
    // bundle loads once and a real duplicate is a coding bug worth
    // surfacing - keep the throw there.
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Duplicate tool registration: ${key}`);
    }
    console.warn(
      `[mcp/registry] re-registering tool ${key} (HMR reload)`,
    );
  }
  tools.set(key, tool);
}

/**
 * List tools visible to the given context. When ctx is omitted the
 * caller is treated as anonymous and only global tools are returned -
 * never per-org custom tools.
 */
export function listTools(ctx?: ToolContext) {
  const callerOrg = ctx?.organizationId;
  return Array.from(tools.values())
    .filter((t) => t.orgId === undefined || t.orgId === callerOrg)
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      requiresIntegration: t.requiresIntegration,
      isWrite: t.isWrite,
    }));
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Look up the per-org slot first; fall back to the global slot.
  // Cross-tenant calls for another org's custom tool fail at the
  // unknown-tool branch below.
  const tool =
    tools.get(keyFor(ctx.organizationId, name)) ?? tools.get(keyFor(undefined, name));
  if (!tool) {
    return textError(`Unknown tool: ${name}`);
  }
  if (tool.orgId !== undefined && tool.orgId !== ctx.organizationId) {
    return textError(`Unknown tool: ${name}`);
  }

  // Guard: if the tool needs an integration and none is connected, surface a helpful message
  if (tool.requiresIntegration) {
    const pck = providerConfigKeyFor(tool.requiresIntegration);
    if (!pck) {
      return textError(
        `Tool ${name} requires ${tool.requiresIntegration}, but that provider isn't mapped in connections/providers.ts.`,
      );
    }
    const conn = await getConnection(ctx.organizationId, pck);
    if (!conn) {
      return textError(
        `${tool.requiresIntegration} isn't connected for this organization. Connect it at /connections and retry.`,
      );
    }
  }

  // ── Write-action approval gate ──────────────────────────────────
  // isWrite used to be metadata only: callTool went straight to the
  // handler, so supabase_run_sql ("arbitrary SQL against Postgres")
  // and every other isWrite tool executed with zero human review. The
  // approvals_gate_all org flag (migration 0067) was advertised as the
  // "gate every outbound action" kill switch but only ever covered
  // composio_use_tool, because its check lived inside composio-router.
  // Lift the gate into the central dispatch so it covers EVERY tool:
  //   - ALWAYS_GATE_TOOLS queue regardless of org policy (high blast).
  //   - any other isWrite tool queues when approvals_gate_all is on.
  //   - composio_use_tool is exempt here - composio-router keeps its
  //     own finer-grained (app/action + destructive-keyword) gate, and
  //     double-gating would queue it twice.
  //   - ctx.skipApprovalGate short-circuits the gate: that is the path
  //     decideApproval re-executes an approved row through, which must
  //     not re-queue itself.
  if (
    !ctx.skipApprovalGate &&
    name !== "composio_use_tool" &&
    (ALWAYS_GATE_TOOLS.has(name) || tool.isWrite === true)
  ) {
    const mustGate =
      ALWAYS_GATE_TOOLS.has(name) ||
      (await orgGatesAllWrites(ctx.organizationId));
    if (mustGate) {
      try {
        const { createApproval } = await import("@/lib/approvals/queries");
        await createApproval({
          organizationId: ctx.organizationId,
          routineRunId: null,
          agentId: null,
          toolName: name,
          toolArgs: args,
          reason: ALWAYS_GATE_TOOLS.has(name)
            ? `${name} is a high-blast write tool; every call requires operator approval.`
            : "Org policy approvals_gate_all is on; every write action requires operator approval.",
        });
      } catch (approvalErr) {
        // createApproval IS the gate. If it throws (RLS, missing table,
        // write failure) we must NOT fall through to execute - that
        // bypasses the gate entirely. Abort and surface the failure.
        return textError(
          `${name}: approval system failed; tool execution aborted (${(approvalErr as Error).message})`,
        );
      }
      return text(
        [
          `Queued for approval: ${name}.`,
          "An operator must approve this at /approvals before it runs.",
          "When approved, the tool re-executes server-side with the same input.",
        ].join("\n"),
      );
    }
  }

  try {
    return await tool.handler(args, ctx);
  } catch (err) {
    return textError(`Tool ${name} failed: ${(err as Error).message}`);
  }
}

export function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }] };
}

export function textError(s: string): ToolResult {
  return { content: [{ type: "text", text: s }], isError: true };
}
