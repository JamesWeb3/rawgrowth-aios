/**
 * MCP tool types. Tools live in src/lib/mcp/tools/* and register
 * themselves via registerTool() in the registry module.
 */

export type ToolContext = {
  organizationId: string;
  /**
   * Caller's rgaios_users.id when available (PR 1, migration 0063).
   * Per-org bearer-token MCP path leaves this null so composioCall
   * falls back to the org-wide row. In-process callers (workflow
   * executor, custom-tool sandbox) populate it from the run owner so
   * per-user OAuth buckets get hit first instead of the org default.
   */
  userId?: string | null;
};

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// Loose JSON-schema shape  -  we don't validate in MCP, Claude does on its side
export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** If set, handler is skipped and returns a "not connected" hint when this integration id isn't connected. */
  requiresIntegration?: string;
  /** Marks a tool as a write  -  used later by the approvals layer. */
  isWrite?: boolean;
  /**
   * Org scoping for in-process custom tools (R08 cross-tenant fix).
   * - undefined: global tool (every static src/lib/mcp/tools/* file).
   *   Visible + callable to every org.
   * - string: per-org custom tool registered via registerCustomTool()
   *   from the sandbox-pass test path. Only listTools(ctx) /
   *   callTool(name, args, ctx) for the same orgId can see it.
   * Without this flag, an org-A draft would land in the shared global
   * Map and any org-B bearer would list + call it.
   */
  orgId?: string;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
};
