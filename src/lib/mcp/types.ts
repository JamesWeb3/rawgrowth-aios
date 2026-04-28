/**
 * MCP tool types. Tools live in src/lib/mcp/tools/* and register
 * themselves via registerTool() in the registry module.
 */

export type ToolContext = {
  organizationId: string;
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
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
};
