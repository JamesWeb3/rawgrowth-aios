/**
 * Dashboard chat tool path - Anthropic API key + MCP tools.
 *
 * The default `chatReply` flow runs through the Claude Max OAuth token
 * pool (gate header `oauth-2025-04-20`). Anthropic does NOT allow
 * stacking the `mcp-client-2025-04-04` beta on top of the OAuth gate
 * today, so the OAuth path can never call MCP tools mid-reply.
 *
 * This module is the escape hatch: when the user's message is clearly
 * tool-needing (search my gmail, list my agents, post to slack, etc.)
 * we re-route THAT turn through the regular API key auth path
 * (x-api-key) which CAN stack the tool beta. The model is given the
 * full registered MCP tool catalogue, runs a tool_use → tool_result
 * loop in-process (we execute via the registry), and the final
 * assistant text is returned to the dashboard chat surface.
 *
 * Falls back gracefully:
 *  - heuristic miss → caller skips this path, OAuth path runs.
 *  - ANTHROPIC_API_KEY missing → returns ok:false so caller can fall
 *    back to the original copy-fallback (a337708) without breaking
 *    the user's chat experience.
 *  - tool loop iteration cap → returns whatever text the model has so
 *    far; no infinite spin.
 *
 * Telemetry: `console.log` on entry so the trigger is observable in
 * prod logs without burning an extra DB write.
 */
import { listTools, callTool } from "@/lib/mcp/registry";
import type { ToolContext } from "@/lib/mcp/types";

/** Single source of truth for the "looks like a tool ask" heuristic. */
const TOOL_INTENT_REGEX =
  /\b(search|send|post|email|message|create|find|fetch|list|delete|update|draft|schedule|get my|in my (gmail|slack|hubspot|notion|linear|github|drive|calendar))\b/i;

/**
 * Cheap, deliberately-dumb heuristic. Designed to err on the side of
 * over-triggering (tool path is strictly better than copy-fallback when
 * it works); the API-key fallback to copy-fallback covers the false
 * positives where the API key is missing.
 *
 * Exported so the unit test can pin behaviour.
 */
export function needsToolPath(userMessage: string): boolean {
  if (!userMessage) return false;
  return TOOL_INTENT_REGEX.test(userMessage);
}

const ANTHROPIC_API_MODEL = "claude-sonnet-4-5";
const MAX_TOOL_LOOP_ITERATIONS = 5;
const TOOL_PATH_TIMEOUT_MS = 90_000;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

type AnthropicMessageResp = {
  id: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  model: string;
};

export type ChatToolsResult =
  | { ok: true; reply: string; iterations: number }
  | { ok: false; error: string; reason: "no_api_key" | "api_error" | "no_text" };

/**
 * Run a tool-using chat turn against the Anthropic API key path.
 *
 * Mirrors the system + first-user-message preamble pattern of the
 * OAuth path so the persona/RAG context the caller already built can
 * be reused verbatim. The differences:
 *   - auth header is `x-api-key: $ANTHROPIC_API_KEY` (no Bearer)
 *   - beta header is `mcp-client-2025-04-04` (no oauth-2025-04-20)
 *   - tools array is built from the in-process MCP registry, scoped
 *     to the caller's org via ToolContext
 *   - we run an explicit tool_use → tool_result loop up to
 *     MAX_TOOL_LOOP_ITERATIONS rounds
 */
export async function chatReplyWithTools(input: {
  organizationId: string;
  userId?: string | null;
  systemPrompt: string;
  preamble: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  maxTokens: number;
}): Promise<ChatToolsResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY not set",
      reason: "no_api_key",
    };
  }

  const ctx: ToolContext = {
    organizationId: input.organizationId,
    userId: input.userId ?? null,
  };

  // Translate the registry's JSON-schema tool descriptors into
  // Anthropic's native tool shape. Skip tools without a name or
  // schema (defensive - registry guarantees them in practice).
  const registered = listTools(ctx);
  const tools = registered
    .filter((t) => !!t.name)
    .map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema ?? {
        type: "object",
        properties: {},
      },
    }));

  // Telemetry only - this is the cue to look in prod logs after demo.
  console.log(
    `[agent-chat] tool path triggered for "${input.userMessage.slice(0, 80)}" (org=${input.organizationId.slice(0, 8)}, tools=${tools.length})`,
  );

  // Compose messages identically to the OAuth path: persona +
  // instructions wrapped as the FIRST user message, then any
  // history, then the latest user turn. The OAuth path tags the
  // preamble inside the latest user message; we follow the same
  // pattern so caller code (route handler) doesn't need to know
  // which path fired.
  const firstUserContent =
    `<persona-and-instructions>\n${input.preamble}\n</persona-and-instructions>\n\n${input.userMessage}`;

  type ApiMessage = {
    role: "user" | "assistant";
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | {
              type: "tool_use";
              id: string;
              name: string;
              input: Record<string, unknown>;
            }
          | {
              type: "tool_result";
              tool_use_id: string;
              content: string;
              is_error?: boolean;
            }
        >;
  };

  const messages: ApiMessage[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: firstUserContent },
  ];

  // Loop tool_use → tool_result. Each iteration is one /v1/messages
  // round trip. We cap at MAX_TOOL_LOOP_ITERATIONS so a runaway
  // model can't burn budget; if the cap hits we return the latest
  // text content so the user still gets something useful.
  let lastTextReply = "";
  let iterations = 0;

  for (; iterations < MAX_TOOL_LOOP_ITERATIONS; iterations++) {
    const body: Record<string, unknown> = {
      model: ANTHROPIC_API_MODEL,
      max_tokens: input.maxTokens,
      system: input.systemPrompt,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
    };

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "mcp-client-2025-04-04",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TOOL_PATH_TIMEOUT_MS),
      });
    } catch (err) {
      return {
        ok: false,
        error: `Anthropic call failed: ${(err as Error).message}`,
        reason: "api_error",
      };
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(
        `[agent-chat] tool path Anthropic ${res.status}: ${txt.slice(0, 200)}`,
      );
      return {
        ok: false,
        error: `Anthropic ${res.status}: ${txt.slice(0, 300)}`,
        reason: "api_error",
      };
    }

    const data = (await res.json()) as AnthropicMessageResp;

    // Pull every text block from this turn so we can surface a
    // partial answer if the loop later breaks mid-way.
    const textParts = data.content
      .filter(
        (b): b is { type: "text"; text: string } =>
          b.type === "text" && typeof b.text === "string",
      )
      .map((b) => b.text);
    if (textParts.length > 0) {
      lastTextReply = textParts.join("\n\n").trim();
    }

    const toolUses = data.content.filter(
      (b): b is {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      } => b.type === "tool_use",
    );

    // No tool calls this turn → model is done, return the final text.
    if (toolUses.length === 0 || data.stop_reason !== "tool_use") {
      if (!lastTextReply) {
        return {
          ok: false,
          error: `Anthropic returned no text content (stop_reason=${data.stop_reason})`,
          reason: "no_text",
        };
      }
      return { ok: true, reply: lastTextReply, iterations: iterations + 1 };
    }

    // Append the assistant turn (text + tool_use blocks) so the next
    // request carries the model's intent forward.
    messages.push({
      role: "assistant",
      content: data.content as ApiMessage["content"],
    });

    // Execute every tool_use sequentially via the in-process registry
    // and stitch the results into a single user-role turn. Sequential
    // (not Promise.all) so stateful tools - e.g. agents_create then
    // agents_update on the freshly created id - see writes in order.
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];
    for (const tu of toolUses) {
      try {
        const r = await callTool(tu.name, tu.input ?? {}, ctx);
        const concat = (r.content ?? [])
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("\n");
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: concat || "(no output)",
          is_error: r.isError === true ? true : undefined,
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Tool ${tu.name} threw: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Iteration cap. Surface whatever text the model emitted on the
  // last completed turn so the user gets a partial answer rather
  // than a silent failure.
  if (lastTextReply) {
    console.warn(
      `[agent-chat] tool path hit ${MAX_TOOL_LOOP_ITERATIONS} iteration cap, returning partial`,
    );
    return { ok: true, reply: lastTextReply, iterations };
  }
  return {
    ok: false,
    error: `Tool loop exceeded ${MAX_TOOL_LOOP_ITERATIONS} iterations without final text`,
    reason: "no_text",
  };
}
