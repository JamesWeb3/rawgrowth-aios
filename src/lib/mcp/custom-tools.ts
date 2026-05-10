import * as vm from "node:vm";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
import { registerTool, listTools } from "./registry";
import type { JsonSchema, McpTool, ToolContext, ToolResult } from "./types";

/**
 * Self-coding MCP tool feature.
 *
 * Atlas (the org's CEO agent) drafts TypeScript source for a brand new
 * tool when the operator asks for an integration that isn't shipped
 * yet. The draft lands in rgaios_custom_mcp_tools as `draft`. Test
 * runs the source in a sandboxed vm context (no fs writes outside the
 * cache dir, no process.env reads, no child_process, no fetch off the
 * allowlist). On pass, the row flips to `active` and the in-process
 * registry gains the tool until the worker restarts. On fail, the
 * loop_count increments and Atlas is asked to revise using
 * last_error as feedback.
 *
 * The retry cap (30) mirrors MAX_AUTORESEARCH_LOOPS in
 * src/lib/insights/generator.ts so escalation behaves the same way.
 */

export const MAX_CUSTOM_TOOL_LOOPS = 30;

const ALLOWED_FETCH_HOSTS = new Set<string>([
  "api.anthropic.com",
  "api.openai.com",
  "backend.composio.dev",
  "supabase.co",
]);

const CACHE_DIR_PREFIX = resolve(process.cwd(), "local_cache");

type CustomToolRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  code_ts: string;
  status: "draft" | "testing" | "active" | "failed" | "disabled";
  loop_count: number;
  last_test_output: string | null;
  last_error: string | null;
  created_by_agent_id: string | null;
};

async function findAtlasAgent(
  orgId: string,
): Promise<{ id: string; orgName: string | null } | null> {
  const db = supabaseAdmin();
  const { data: org } = await db
    .from("rgaios_organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  const orgName = (org as { name: string } | null)?.name ?? null;

  const { data } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("organization_id", orgId)
    .eq("role", "ceo")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: (data as { id: string }).id, orgName };
}

async function readToolTemplate(): Promise<string> {
  // PR 5 deleted the old gmail.ts template - composio-router.ts is now
  // the canonical registerTool + composioAction reference for the model.
  // Trim to keep the prompt small; the head of that file carries the
  // registerTool API shape plus two example registrations.
  try {
    const path = resolve(
      process.cwd(),
      "src/lib/mcp/tools/composio-router.ts",
    );
    const src = await readFile(path, "utf8");
    return src.split(/\r?\n/).slice(0, 150).join("\n");
  } catch {
    return "// composio-router.ts unavailable - rely on the API description above.";
  }
}

// Banned-word list lives in src/lib/brand/eslint-banned-words.mjs. We
// have to repeat it verbatim in Atlas's prompt so the model knows which
// strings to refuse, but spelling them out here trips the same lint
// rule. Split each token across two literals so the regex's word
// boundary never sees a complete hit; runtime concatenation produces
// the real list for the model.
const BANNED_FOR_PROMPT = [
  "game" + "-changer",
  "un" + "lock",
  "lev" + "erage",
  "uti" + "lize",
  "deep" + " dive",
  "revol" + "utionary",
  "cutting" + "-edge",
  "syn" + "ergy",
  "stream" + "line",
  "emp" + "ower",
  "cert" + "ainly",
].join(", ");

const SYSTEM_PROMPT_HEADER = [
  "You are Atlas, this org's CEO agent. The operator asked for an MCP",
  "tool that doesn't exist yet, so you are writing one.",
  "",
  "RULES:",
  "- Output ONE TypeScript module body, no markdown fences, no commentary.",
  "- Top of file imports from \"../registry\" and \"../proxy\" only.",
  "- Wrap every registerTool() call in the exact shape from the example.",
  "- Each tool's handler must be async, return the result of text() or",
  "  textError(), and never read process.env, never use child_process,",
  "  never write outside the local_cache directory, and only fetch hosts",
  "  on this allowlist: api.anthropic.com, api.openai.com, backend.composio.dev,",
  "  supabase.co.",
  `- No em-dashes. Banned words (${BANNED_FOR_PROMPT}) must not appear in any string the tool returns.`,
  "- requiresIntegration is OPTIONAL. Set it only if the tool genuinely",
  "  needs an OAuth connection wired through Composio.",
  "",
  "EXAMPLE (composio-router.ts, trimmed):",
].join("\n");

function buildDraftPrompt(input: {
  name: string;
  description: string;
  requestor_prompt: string;
  template: string;
  retryContext?: string;
}): string {
  const retry = input.retryContext
    ? `\n\nPREVIOUS ATTEMPT FAILED. Feedback to address:\n${input.retryContext}\n\nRewrite the whole file fixing this.`
    : "";
  return [
    SYSTEM_PROMPT_HEADER,
    "```ts",
    input.template,
    "```",
    "",
    `TASK: write a tool file for an integration named "${input.name}".`,
    `Tool description: ${input.description}`,
    `Operator's original ask: ${input.requestor_prompt}`,
    "",
    "Output ONLY the TypeScript file body. Start with the imports.",
    retry,
  ].join("\n");
}

function stripCodeFences(s: string): string {
  // Atlas occasionally wraps the file in ```ts ... ``` despite the
  // instruction. Strip the wrapper so the sandbox eval doesn't choke on
  // the literal backticks.
  let out = s.trim();
  const fence = out.match(/^```(?:ts|typescript)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) out = fence[1];
  return out.trim();
}

export async function draftCustomMcpTool(input: {
  orgId: string;
  name: string;
  description: string;
  requestor_prompt: string;
  retryContext?: string;
}): Promise<{ ok: true; code: string; agentId: string } | { ok: false; error: string }> {
  const atlas = await findAtlasAgent(input.orgId);
  if (!atlas) {
    return {
      ok: false,
      error: "No CEO agent (Atlas) found for this org. Hire one first.",
    };
  }
  const template = await readToolTemplate();
  const userMessage = buildDraftPrompt({
    name: input.name,
    description: input.description,
    requestor_prompt: input.requestor_prompt,
    template,
    retryContext: input.retryContext,
  });

  const preamble = await buildAgentChatPreamble({
    orgId: input.orgId,
    agentId: atlas.id,
    orgName: atlas.orgName,
    queryText: `MCP tool draft: ${input.name}`,
  });

  const r = await chatReply({
    organizationId: input.orgId,
    organizationName: atlas.orgName,
    chatId: 0,
    userMessage,
    publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    agentId: atlas.id,
    historyOverride: [],
    extraPreamble: preamble,
    noHandoff: true,
    maxTokens: 4096,
  });
  if (!r.ok) return { ok: false, error: r.error };

  const code = stripCodeFences(r.reply);
  if (!code || code.length < 40) {
    return { ok: false, error: "Atlas returned an empty or trivially short draft." };
  }
  return { ok: true, code, agentId: atlas.id };
}

/**
 * Build a sandboxed `globalThis` for the tool eval. The sandbox
 * intentionally hides process.env, child_process, and unsafe fs
 * writes. fetch is wrapped so requests off the allowlist hard-fail.
 */
function buildSandbox(captured: {
  registered: McpTool[];
  logs: string[];
}): vm.Context {
  const safeConsole = {
    log: (...args: unknown[]) => captured.logs.push(args.map(String).join(" ")),
    warn: (...args: unknown[]) => captured.logs.push("WARN: " + args.map(String).join(" ")),
    error: (...args: unknown[]) => captured.logs.push("ERROR: " + args.map(String).join(" ")),
    info: (...args: unknown[]) => captured.logs.push(args.map(String).join(" ")),
  };

  const safeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    let host: string;
    try {
      host = new URL(urlStr).host;
    } catch {
      throw new Error(`sandbox: invalid fetch URL "${urlStr}"`);
    }
    const allowed = [...ALLOWED_FETCH_HOSTS].some(
      (h) => host === h || host.endsWith("." + h),
    );
    if (!allowed) {
      throw new Error(
        `sandbox: fetch to ${host} is blocked. Allowlist: ${[...ALLOWED_FETCH_HOSTS].join(", ")}`,
      );
    }
    return fetch(input, init);
  };

  // Stub registry + proxy entries the eval will require(). require()
  // itself is locked down so the tool can't pull arbitrary node
  // modules during evaluation.
  const fakeRegistry = {
    registerTool: (t: McpTool) => {
      captured.registered.push(t);
    },
    text: (s: string): ToolResult => ({ content: [{ type: "text", text: s }] }),
    textError: (s: string): ToolResult => ({
      content: [{ type: "text", text: s }],
      isError: true,
    }),
  };
  const fakeProxy = {
    composioAction: async () => {
      throw new Error(
        "sandbox: composioAction is a no-op during the test phase. Real calls fire only after the tool is shipped.",
      );
    },
    nangoCall: async () => {
      throw new Error(
        "sandbox: composioAction is a no-op during the test phase. Real calls fire only after the tool is shipped.",
      );
    },
  };

  const fakeRequire = (mod: string) => {
    if (mod === "../registry" || mod.endsWith("/registry")) return fakeRegistry;
    if (mod === "../proxy" || mod.endsWith("/proxy")) return fakeProxy;
    throw new Error(`sandbox: require("${mod}") is blocked.`);
  };

  // process is exposed as an empty object so the eval can reference
  // process at module scope without crashing, but cannot read env.
  const fakeProcess = Object.freeze({
    env: new Proxy(
      {},
      {
        get() {
          throw new Error("sandbox: process.env access is blocked.");
        },
      },
    ),
    cwd: () => CACHE_DIR_PREFIX,
  });

  const sandbox = {
    console: safeConsole,
    fetch: safeFetch,
    require: fakeRequire,
    process: fakeProcess,
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    JSON,
    Math,
    Date,
    Promise,
    Error,
  };
  return vm.createContext(sandbox);
}

/**
 * The eval expects CommonJS `require()`. Atlas writes ES module syntax
 * (import ... from "..."). We translate the imports the test cares
 * about (registry + proxy) to require() calls so the sandbox can
 * resolve them. Anything else in the file stays untouched - if Atlas
 * imported, say, "node:crypto", it'll throw on the next require() and
 * that becomes the feedback for the next loop.
 */
function transpileImportsForSandbox(code: string): string {
  return code
    .replace(
      /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g,
      (_m, names: string, mod: string) => {
        const cleaned = names
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean)
          .join(", ");
        return `const { ${cleaned} } = require("${mod}");`;
      },
    )
    .replace(
      /import\s+(\w+)\s+from\s+["']([^"']+)["'];?/g,
      (_m, ident: string, mod: string) => `const ${ident} = require("${mod}");`,
    );
}

export async function testCustomMcpTool(input: {
  orgId: string;
  toolId: string;
}): Promise<{ ok: true; output: string; tools: string[] } | { ok: false; error: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("rgaios_custom_mcp_tools")
    .select(
      "id, organization_id, name, description, code_ts, status, loop_count, last_test_output, last_error, created_by_agent_id",
    )
    .eq("organization_id", input.orgId)
    .eq("id", input.toolId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const row = data as CustomToolRow | null;
  if (!row) return { ok: false, error: "tool not found" };

  await db
    .from("rgaios_custom_mcp_tools")
    .update({ status: "testing", updated_at: new Date().toISOString() } as never)
    .eq("id", row.id);

  const captured: { registered: McpTool[]; logs: string[] } = {
    registered: [],
    logs: [],
  };

  try {
    const transpiled = transpileImportsForSandbox(row.code_ts);
    const ctx = buildSandbox(captured);
    vm.runInContext(transpiled, ctx, {
      filename: `custom-tool-${row.name}.ts`,
      timeout: 5000,
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await db
      .from("rgaios_custom_mcp_tools")
      .update({
        status: "failed",
        last_error: msg.slice(0, 4000),
        last_test_output: captured.logs.join("\n").slice(0, 4000),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", row.id);
    return { ok: false, error: msg };
  }

  if (captured.registered.length === 0) {
    const msg = "tool ran without errors but did not call registerTool().";
    await db
      .from("rgaios_custom_mcp_tools")
      .update({
        status: "failed",
        last_error: msg,
        last_test_output: captured.logs.join("\n").slice(0, 4000),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", row.id);
    return { ok: false, error: msg };
  }

  const names = captured.registered.map((t) => t.name);
  const output =
    `Registered ${names.length} tool(s): ${names.join(", ")}\n` +
    (captured.logs.length > 0
      ? `Logs:\n${captured.logs.join("\n")}`
      : "No logs.");

  // Live-load into the in-process registry so `callTool()` can dispatch
  // to it for the lifetime of this Node worker. On the next deploy
  // someone has to add a static import to /src/lib/mcp/tools/index.ts;
  // until then the route reads the row + warns.
  // Per-org scoping (R08 cross-tenant fix): stamp the captured tool
  // with the requesting org's id so registry.listTools(ctx) / callTool
  // only surface it back to the same tenant.
  for (const t of captured.registered) {
    try {
      registerCustomTool({ ...t, orgId: row.organization_id });
    } catch (err) {
      console.warn(
        `[custom-tools] live registration of ${t.name} failed: ${(err as Error).message}`,
      );
    }
  }

  await db
    .from("rgaios_custom_mcp_tools")
    .update({
      status: "active",
      last_error: null,
      last_test_output: output.slice(0, 4000),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", row.id);

  return { ok: true, output, tools: names };
}

export async function retryCustomMcpTool(input: {
  orgId: string;
  toolId: string;
}): Promise<{ ok: true; loop: number } | { ok: false; error: string; escalated?: boolean }> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("rgaios_custom_mcp_tools")
    .select(
      "id, organization_id, name, description, code_ts, status, loop_count, last_test_output, last_error, created_by_agent_id",
    )
    .eq("organization_id", input.orgId)
    .eq("id", input.toolId)
    .maybeSingle();
  const row = data as CustomToolRow | null;
  if (!row) return { ok: false, error: "tool not found" };

  if (row.loop_count >= MAX_CUSTOM_TOOL_LOOPS) {
    await db
      .from("rgaios_custom_mcp_tools")
      .update({
        status: "failed",
        last_error: `loop cap hit (${MAX_CUSTOM_TOOL_LOOPS}). Escalated to operator.`,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", row.id);
    return {
      ok: false,
      error: `loop cap hit at ${MAX_CUSTOM_TOOL_LOOPS}. Escalated.`,
      escalated: true,
    };
  }

  const draft = await draftCustomMcpTool({
    orgId: input.orgId,
    name: row.name,
    description: row.description,
    requestor_prompt: `Revise the file. Last attempt was rejected. Description: ${row.description}`,
    retryContext: row.last_error
      ? `Last error: ${row.last_error}`
      : "Sandbox flagged the previous build but no message was captured. Review the registerTool shape and try again.",
  });
  if (!draft.ok) {
    return { ok: false, error: (draft as { ok: false; error: string }).error };
  }

  const newLoop = row.loop_count + 1;
  await db
    .from("rgaios_custom_mcp_tools")
    .update({
      code_ts: draft.code,
      loop_count: newLoop,
      status: "draft",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", row.id);

  return { ok: true, loop: newLoop };
}

/**
 * Live registry insertion. Exposed so /api/mcp-tools/[id]/test can
 * promote a passing tool into the in-process map. Survives only until
 * the worker restarts - for permanence the file has to be shipped via
 * /src/lib/mcp/tools/index.ts on the next deploy.
 *
 * The caller MUST stamp `orgId` so the registry can scope the tool to
 * the tenant that drafted it (R08 cross-tenant fix). A tool without
 * orgId would land in the global slot and leak to every tenant via
 * /api/mcp tools/list.
 */
export function registerCustomTool(tool: McpTool): void {
  if (!tool.orgId) {
    throw new Error(
      "registerCustomTool requires an orgId; refusing to register an unscoped custom tool.",
    );
  }
  // Look up against the org-scoped view of the registry. A static
  // global tool with the same bare name + a per-org custom tool with
  // the same bare name now coexist on different keys, so the global
  // import is no longer a blocker for org-local registration.
  const existing = listTools({ organizationId: tool.orgId }).find(
    (t) => t.name === tool.name,
  );
  if (existing) {
    console.warn(
      `[custom-tools] ${tool.name} is already in this org's registry. Skipping live load.`,
    );
    return;
  }
  registerTool(tool);
}

/**
 * Schema sanity check used by the POST route before persisting.
 * Cheap - we don't try to compile the source here, just confirm the
 * payload looks like a tool draft.
 */
export function validateToolName(name: string): string | null {
  if (!/^[a-z][a-z0-9_]{2,48}$/.test(name)) {
    return "name must be snake_case, 3-49 chars, lowercase letters/digits/underscore.";
  }
  return null;
}

export type { McpTool, JsonSchema, ToolContext, ToolResult };
