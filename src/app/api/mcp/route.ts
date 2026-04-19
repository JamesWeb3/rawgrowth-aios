import { NextResponse, type NextRequest } from "next/server";
import { callTool, listTools } from "@/lib/mcp/registry";
import { currentOrganizationId } from "@/lib/supabase/constants";

// Force the tools/ modules to register themselves on cold start.
import "@/lib/mcp/tools";

/**
 * Streamable HTTP MCP endpoint (stateless variant).
 *
 * Claude Desktop / Cursor / Claude Code / any MCP-compatible client
 * POSTs JSON-RPC 2.0 here. We support three methods:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *
 * Every request is independent — no session state. Bearer auth via
 * MCP_BEARER_TOKEN in the Authorization header. In production, the
 * token maps to an organization; for MVP we use currentOrganizationId()
 * which returns the seeded default org.
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

function isAuthorized(req: NextRequest) {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (!expected) return true; // no token set → open mode (local dev only)
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
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

  const organizationId = await currentOrganizationId();

  try {
    switch (msg.method) {
      case "initialize":
        return NextResponse.json(
          reply(msg.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "rawgrowth-aios", version: "0.2.0" },
          }),
        );

      case "notifications/initialized":
        // Notification; no response expected
        return new NextResponse(null, { status: 204 });

      case "tools/list":
        return NextResponse.json(reply(msg.id, { tools: listTools() }));

      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        const result = await callTool(name, args, { organizationId });
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

// Many MCP clients probe GET first. Return a small banner.
export async function GET() {
  return NextResponse.json({
    server: "rawgrowth-aios",
    version: "0.2.0",
    transport: "streamable-http",
    protocolVersion: PROTOCOL_VERSION,
  });
}
