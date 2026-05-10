import { NextResponse, type NextRequest } from "next/server";
import { callTool, listTools } from "@/lib/mcp/registry";
import {
  parseBearer,
  resolveOrgFromToken,
} from "@/lib/mcp/token-resolver";
import { listPromptsForOrg, getPromptForOrg } from "@/lib/mcp/prompts";
import { supabaseAdmin } from "@/lib/supabase/server";

// Force the tools/ modules to register themselves on cold start.
import "@/lib/mcp/tools";

// ─── Audit-log helpers for tools/call ───────────────────────────────
//
// Brief required `chat_command_tool_call` audit row for every tool
// invocation through /api/mcp. W6 found this missing: denylist
// refusals from composio_use_tool and every other tool call were
// silently flying under the radar - no trace, no replay, nothing for
// security review. Insert is fire-and-forget; we never let an audit
// failure break a real tool response.

// Args may carry secrets the model copy-pasted (e.g. an API key it
// pulled from connections). Strip anything that looks token-shaped
// before the row hits the database. Better to drop too much than to
// log a credential to a row a future viewer can read.
const SECRET_KEY_PATTERN =
  /token|secret|password|passwd|api[_-]?key|authorization|bearer|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key/i;

function sanitizeArgsForAudit(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-capped]";
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > 500 ? value.slice(0, 500) + "...(truncated)" : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => sanitizeArgsForAudit(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = sanitizeArgsForAudit(v, depth + 1);
  }
  return out;
}

type ToolCallResult = Awaited<ReturnType<typeof callTool>>;

function logToolCallAudit(opts: {
  organizationId: string;
  tool: string;
  args: unknown;
  ok: boolean;
  errorExcerpt?: string;
}): void {
  // Fire-and-forget; never block or break the response.
  try {
    const detail: Record<string, unknown> = {
      tool: opts.tool,
      args: sanitizeArgsForAudit(opts.args),
      ok: opts.ok,
    };
    if (opts.errorExcerpt) detail.error_excerpt = opts.errorExcerpt.slice(0, 300);
    // Supabase's PostgrestBuilder is `PromiseLike` (no native .catch),
    // so wrap in Promise.resolve to get a real Promise we can attach
    // a catch handler to. Fire-and-forget intentional - audit failure
    // must never block the tool response.
    Promise.resolve(
      supabaseAdmin()
        .from("rgaios_audit_log")
        .insert({
          organization_id: opts.organizationId,
          kind: "mcp_tool_call",
          actor_type: "mcp",
          actor_id: opts.tool,
          detail,
        } as never),
    ).catch((err: unknown) => {
      console.warn(
        `[mcp/audit] insert failed for ${opts.tool}: ${(err as Error).message}`,
      );
    });
  } catch (err) {
    console.warn(
      `[mcp/audit] sync setup failed for ${opts.tool}: ${(err as Error).message}`,
    );
  }
}

/**
 * Streamable HTTP MCP endpoint (stateless variant).
 *
 * Claude Desktop / Cursor / Claude Code / any MCP-compatible client POSTs
 * JSON-RPC 2.0 here. Authentication is **per-tenant**: the Authorization
 * header carries a bearer token from rgaios_organizations.mcp_token, which
 * resolves to the caller's organization id. Tools operate scoped to that
 * org  -  no cross-tenant leakage is possible.
 *
 * Supported JSON-RPC methods:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *   - prompts/list
 *   - prompts/get
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const PROTOCOL_VERSION = "2024-11-05";

type JsonRpc = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function reply(id: JsonRpc["id"] | undefined, result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

function replyError(
  id: JsonRpc["id"] | undefined,
  code: number,
  message: string,
) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

export async function POST(req: NextRequest) {
  const token = parseBearer(req.headers.get("authorization"));
  const org = token ? await resolveOrgFromToken(token) : null;
  if (!org) {
    return NextResponse.json(
      replyError(null, -32001, "Unauthorized"),
      { status: 401 },
    );
  }

  let msg: JsonRpc;
  try {
    msg = (await req.json()) as JsonRpc;
  } catch {
    return NextResponse.json(replyError(null, -32700, "Parse error"), {
      status: 400,
    });
  }

  if (msg.jsonrpc !== "2.0" || !msg.method) {
    return NextResponse.json(replyError(msg.id, -32600, "Invalid Request"));
  }

  try {
    switch (msg.method) {
      case "initialize":
        return NextResponse.json(
          reply(msg.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, prompts: {} },
            serverInfo: { name: `rawgrowth-aios (${org.name})`, version: "0.4.0" },
          }),
        );

      case "notifications/initialized":
        return new NextResponse(null, { status: 204 });

      case "tools/list":
        return NextResponse.json(
          reply(msg.id, {
            tools: listTools({ organizationId: org.id }),
          }),
        );

      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        let result: ToolCallResult;
        try {
          result = await callTool(name, args, {
            organizationId: org.id,
          });
        } catch (err) {
          // Tool threw before returning a result envelope - still
          // audit then rethrow into the outer handler so the JSON-RPC
          // error response shape is unchanged.
          logToolCallAudit({
            organizationId: org.id,
            tool: name,
            args,
            ok: false,
            errorExcerpt: (err as Error).message,
          });
          throw err;
        }
        // result.isError covers textError (denylist refusals, missing
        // creds, upstream non-2xx). detail.error_excerpt grabs the
        // first text block so the audit row has actionable context.
        const isError = result.isError === true;
        let errorExcerpt: string | undefined;
        if (isError) {
          const first = result.content?.[0];
          if (first && typeof first === "object" && "text" in first) {
            errorExcerpt = String((first as { text?: unknown }).text ?? "");
          }
        }
        logToolCallAudit({
          organizationId: org.id,
          tool: name,
          args,
          ok: !isError,
          errorExcerpt,
        });
        return NextResponse.json(reply(msg.id, result));
      }

      case "prompts/list": {
        const prompts = await listPromptsForOrg(org.id);
        return NextResponse.json(reply(msg.id, { prompts }));
      }

      case "prompts/get": {
        const name = String(msg.params?.name ?? "");
        const prompt = await getPromptForOrg(org.id, name);
        if (!prompt) {
          return NextResponse.json(
            replyError(msg.id, -32602, `Unknown prompt: ${name}`),
          );
        }
        return NextResponse.json(reply(msg.id, prompt));
      }

      default:
        return NextResponse.json(
          replyError(msg.id, -32601, `Method not found: ${msg.method}`),
        );
    }
  } catch (err) {
    return NextResponse.json(
      replyError(msg.id, -32000, (err as Error).message),
    );
  }
}

// Many MCP clients probe GET first. Return a small banner (no auth).
export async function GET() {
  return NextResponse.json({
    server: "rawgrowth-aios",
    version: "0.3.0",
    transport: "streamable-http",
    protocolVersion: PROTOCOL_VERSION,
  });
}
