import { spawn } from "node:child_process";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { anthropic } from "@ai-sdk/anthropic";
import {
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
  type ToolSet,
} from "ai";

/**
 * Unified chat-LLM provider abstraction. ONE entry point  -  `chatComplete`  - 
 * fans out to three backends so every call site (onboarding chat, manager
 * runs, brand-voice rewrite) can flip provider per-VPS via env var without
 * touching call-site code.
 *
 * Selection precedence:
 *   1. Explicit `provider` arg on the request.
 *   2. Per-call-site env var (resolved by the caller via resolveProvider()).
 *   3. Global LLM_PROVIDER env var.
 *   4. Default: "openai".
 *
 * Backends:
 *   openai         → OpenAI Chat Completions (gpt-4o default). Native tool
 *                    use. Streams text deltas via optional onTextDelta.
 *   anthropic-api  → @ai-sdk/anthropic + generateText (claude-sonnet-4-5
 *                    default). Maps OpenAI tool shape → AI SDK toolset.
 *                    No mid-step streaming (single fire-and-collect).
 *   anthropic-cli  → spawn `claude --print --dangerously-skip-permissions`,
 *                    pipe system + user as stdin, read stdout. Reuses Max
 *                    OAuth in ~/.claude. Tools NOT passed (operator-side
 *                    MCP registration only); a one-line warning logs if
 *                    the caller passes tools while in CLI mode.
 *
 * Contract: `chatComplete` executes ONE model step. Agentic loops (multi-
 * turn tool use) live in the caller  -  the provider just runs the step,
 * returns text + toolCalls, and the caller decides whether to call again
 * with the tool results appended to messages.
 */

export type ChatProviderId = "openai" | "anthropic-api" | "anthropic-cli";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * OpenAI Function-calling tool shape  -  the abstraction's canonical form.
 * For anthropic-api we translate to AI SDK `tool()` wrappers; for
 * anthropic-cli we drop them with a warning (CLI tools come from the
 * operator's claude_desktop_config, not request-time wiring).
 */
export type OpenAITool = ChatCompletionTool;

export type ChatToolCall = {
  /** Stable per-turn id (used to correlate tool result on the next step). */
  id: string;
  name: string;
  /** Parsed JSON args. Empty object when the model passed nothing. */
  input: Record<string, unknown>;
};

export type ChatRequest = {
  /** Override; defaults via resolveProvider(). */
  provider?: ChatProviderId;
  /** Provider-specific model id; ignored for anthropic-cli. */
  model?: string;
  system: string;
  messages: ChatMessage[];
  /** OpenAI Function-calling shape; translated per provider. */
  tools?: OpenAITool[];
  abortSignal?: AbortSignal;
  /**
   * Cap on internal tool-loop steps for the anthropic-api backend (whose
   * generateText runs its own loop). The openai backend always returns
   * after one step (caller iterates). Default 12.
   */
  maxSteps?: number;
  /**
   * Optional streaming hook for text deltas. Honoured by openai backend
   * (real per-token chunks) so the onboarding route keeps its NDJSON UX.
   * anthropic-api / anthropic-cli ignore it (they fire and collect).
   */
  onTextDelta?: (delta: string) => void;
  /**
   * OpenAI sampling temperature. Defaults to undefined (provider default).
   * Passed only to the openai backend; the others use their defaults.
   */
  temperature?: number;
};

export type ChatResponse = {
  text: string;
  toolCalls: ChatToolCall[];
};

const DEFAULT_OPENAI_MODEL = "gpt-4o";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_STEPS = 12;

/**
 * Resolve the active provider from env vars. Per-call-site overrides win
 * over the global default. Unknown values fall back to "openai" with a
 * warning so a typo in the per-VPS .env doesn't crash the request path.
 */
export function resolveProvider(callSiteEnvVar?: string): ChatProviderId {
  const raw = (
    (callSiteEnvVar ? process.env[callSiteEnvVar] : undefined) ??
    process.env.LLM_PROVIDER ??
    "openai"
  )
    .toLowerCase()
    .trim();
  if (raw === "openai" || raw === "anthropic-api" || raw === "anthropic-cli") {
    return raw;
  }
  console.warn(
    `[llm/provider] unknown provider "${raw}"  -  falling back to openai`,
  );
  return "openai";
}

let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/** Test seam  -  flush the cached OpenAI client between env-flip cases. */
export function __resetClientsForTests() {
  _openai = null;
}

/** Public entry point  -  see ChatRequest / ChatResponse. */
export async function chatComplete(req: ChatRequest): Promise<ChatResponse> {
  const provider = req.provider ?? resolveProvider();
  switch (provider) {
    case "openai":
      return runOpenAI(req);
    case "anthropic-api":
      return runAnthropicApi(req);
    case "anthropic-cli":
      return runAnthropicCli(req);
  }
}

// ─── openai ────────────────────────────────────────────────────────

async function runOpenAI(req: ChatRequest): Promise<ChatResponse> {
  const model = req.model ?? DEFAULT_OPENAI_MODEL;
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: req.system },
    ...req.messages.map(
      (m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam,
    ),
  ];

  const completion = await openaiClient().chat.completions.create(
    {
      model,
      stream: true,
      temperature: req.temperature,
      messages,
      ...(req.tools && req.tools.length > 0
        ? { tools: req.tools, tool_choice: "auto" as const }
        : {}),
    },
    req.abortSignal ? { signal: req.abortSignal } : undefined,
  );

  let text = "";
  const rawToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

  for await (const chunk of completion) {
    const choice = chunk.choices[0];
    const delta = choice?.delta;
    if (delta?.content) {
      text += delta.content;
      req.onTextDelta?.(delta.content);
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!rawToolCalls[idx]) rawToolCalls[idx] = { id: "", name: "", arguments: "" };
        if (tc.id) rawToolCalls[idx].id = tc.id;
        if (tc.function?.name) rawToolCalls[idx].name = tc.function.name;
        if (tc.function?.arguments) rawToolCalls[idx].arguments += tc.function.arguments;
      }
    }
  }

  const toolCalls: ChatToolCall[] = rawToolCalls
    .filter((tc) => !!tc.name)
    .map((tc) => {
      let input: Record<string, unknown> = {};
      try {
        input = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        input = {};
      }
      return { id: tc.id, name: tc.name, input };
    });

  return { text, toolCalls };
}

// ─── anthropic-api ─────────────────────────────────────────────────

/**
 * AI SDK runs its own internal tool loop, so we surface the FINAL text +
 * any tool calls collected. Tools translated from OpenAI shape  -  each
 * tool's `execute` is left as a no-op that records the call; the caller
 * is responsible for executing tool side-effects (parity with how the
 * openai branch returns tool calls without executing them). The exception
 * is the manager-runs path, which provides its own toolset directly via
 * the `tools` arg already wired through buildToolset.
 */
async function runAnthropicApi(req: ChatRequest): Promise<ChatResponse> {
  const model = req.model ?? DEFAULT_ANTHROPIC_MODEL;
  const captured: ChatToolCall[] = [];

  const toolset: ToolSet = {};
  if (req.tools) {
    for (const t of req.tools) {
      const name = t.function.name;
      toolset[name] = tool({
        description: t.function.description ?? "",
        inputSchema: jsonSchema(
          (t.function.parameters as Record<string, unknown>) ?? {
            type: "object",
            properties: {},
          },
        ),
        execute: async (args: unknown) => {
          captured.push({
            id: `${name}_${captured.length}`,
            name,
            input: (args ?? {}) as Record<string, unknown>,
          });
          // Returning a sentinel keeps the AI SDK loop from looping forever
          // on a tool call we don't actually execute here. The caller sees
          // captured.toolCalls and re-invokes chatComplete with the real
          // tool result appended to messages.
          return { ok: true, deferred: true };
        },
      });
    }
  }

  // Build messages: AI SDK uses `system` + `prompt` for one-shot, or
  // explicit messages for multi-turn. We always have a system + a list,
  // so we collapse into the prompt-style by stitching messages into a
  // single user prompt. For multi-turn we pass via `messages`.
  const aiMessages = req.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const result = await generateText({
    model: anthropic(model),
    system: req.system,
    messages: aiMessages,
    ...(Object.keys(toolset).length > 0
      ? { tools: toolset, stopWhen: stepCountIs(req.maxSteps ?? DEFAULT_MAX_STEPS) }
      : {}),
    abortSignal: req.abortSignal,
  });

  // Prefer the captured tool calls (which include parsed input). Fallback
  // to result.toolCalls if no execute fired (e.g. abort mid-step).
  if (captured.length === 0 && result.toolCalls.length > 0) {
    for (const tc of result.toolCalls) {
      captured.push({
        id: tc.toolCallId ?? `${tc.toolName}_${captured.length}`,
        name: tc.toolName,
        input: (tc.input ?? {}) as Record<string, unknown>,
      });
    }
  }

  return { text: result.text, toolCalls: captured };
}

// ─── anthropic-cli ─────────────────────────────────────────────────

/**
 * Spawn `claude --print --dangerously-skip-permissions` and pipe the
 * merged system+user prompt as stdin. Reuses the host's Claude Max OAuth
 * token in ~/.claude, no API key on the request path. Tools come from the
 * operator's claude_desktop_config MCP registration; if the caller passes
 * `tools` in CLI mode we log a one-line warning and proceed without them.
 *
 * abortSignal is honoured: if it fires mid-spawn we SIGTERM the child,
 * which lets the executor's wall-clock cap drain a stuck CLI.
 */
async function runAnthropicCli(req: ChatRequest): Promise<ChatResponse> {
  if (req.tools && req.tools.length > 0) {
    console.warn(
      `[llm/provider] anthropic-cli mode ignores ${req.tools.length} request-time tool(s); register MCP server in ~/.claude/claude_desktop_config.json instead`,
    );
  }
  // XML tags instead of "User:"/"Assistant:" labels so Claude doesn't
  // continue the pattern with a fake user turn ("User: telegram") at the
  // end of its reply. The CLI sees a single message; reply is whatever
  // comes after the closing </conversation> tag in the model's stream.
  const conversation = req.messages
    .map(
      (m) =>
        `<${m.role === "assistant" ? "assistant" : "user"}>${m.content}</${
          m.role === "assistant" ? "assistant" : "user"
        }>`,
    )
    .join("\n");
  const merged = [
    req.system,
    "",
    "<conversation>",
    conversation,
    "</conversation>",
    "",
    "Reply with ONLY your next assistant message. Do not add user/assistant labels, do not continue the conversation past one turn, do not echo the input back.",
  ].join("\n");
  const text = await spawnClaudeCli(merged, req.abortSignal);
  return { text, toolCalls: [] };
}

/**
 * Bare child-process wrapper around `claude --print`. Exported so the
 * manager-runs path can keep its existing single-string contract while
 * still routing through one home for the spawn logic.
 */
export function spawnClaudeCli(
  stdinPayload: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = process.env.CLAUDE_CLI_PATH ?? "claude";
    const child = spawn(
      bin,
      ["--print", "--dangerously-skip-permissions"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += b.toString("utf8");
    });
    child.stderr.on("data", (b) => {
      err += b.toString("utf8");
    });
    child.on("error", (e) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(
          new Error(
            `claude --print exited ${code}: ${err.slice(0, 500) || "(no stderr)"}`,
          ),
        );
        return;
      }
      resolve(out.trim());
    });

    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}
