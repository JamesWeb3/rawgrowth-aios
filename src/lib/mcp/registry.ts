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

function keyFor(orgId: string | undefined, name: string): string {
  return orgId ? `${orgId}:${name}` : name;
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
