import { NextResponse, type NextRequest } from "next/server";
import { callTool, listTools } from "@/lib/mcp/registry";
import {
  parseBearer,
  resolveOrgFromToken,
} from "@/lib/mcp/token-resolver";

// Force the tools/ modules to register themselves on cold start.
import "@/lib/mcp/tools";

/**
 * Streamable HTTP MCP endpoint (stateless variant).
 *
 * Claude Desktop / Cursor / Claude Code / any MCP-compatible client POSTs
 * JSON-RPC 2.0 here. Authentication is **per-tenant**: the Authorization
 * header carries a bearer token from rgaios_organizations.mcp_token, which
 * resolves to the caller's organization id. Tools operate scoped to that
 * org — no cross-tenant leakage is possible.
 *
 * Supported JSON-RPC methods:
 *   - initialize
 *   - tools/list
 *   - tools/call
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
            capabilities: { tools: {} },
            serverInfo: { name: `rawgrowth-aios (${org.name})`, version: "0.3.0" },
          }),
        );

      case "notifications/initialized":
        return new NextResponse(null, { status: 204 });

      case "tools/list":
        return NextResponse.json(reply(msg.id, { tools: listTools() }));

      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        const result = await callTool(name, args, {
          organizationId: org.id,
        });
        return NextResponse.json(reply(msg.id, result));
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
