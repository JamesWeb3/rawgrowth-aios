import { registerTool, text, textError } from "../registry";
import { composioAction } from "../proxy";

/**
 * Composio Tool Router MCP surface.
 *
 * Today our agents see ~7 hardcoded integration tools (gmail_search,
 * gmail_get_message, gmail_draft, plus the 4 booking/calendar wrappers).
 * Composio's Tool Router (Sept 2025) exposes 1000+ apps through a
 * single MCP endpoint with per-user session scoping. Instead of writing
 * one tool per app+action and shipping a redeploy every time a client
 * wires a new integration, we register two tools here and let the
 * model pick what to call:
 *
 *   - composio_list_tools({ app? })   - discover available actions
 *                                       (whole catalog or filtered to
 *                                       one app the client connected).
 *   - composio_use_tool({ app, action, input }) - invoke any of those
 *                                       actions through Composio with
 *                                       the caller's per-user OAuth
 *                                       grant from migration 0063.
 *
 * Both tools route through composioAction so per-user OAuth
 * (Worker 1 / PR 1 thread) carries through automatically: ctx.userId
 * is forwarded as the 5th arg, getConnection prefers the per-user row,
 * and Composio's executeAction sees the matching entityId. Without
 * that thread the router would silently borrow the first user's
 * grant for every member of the org - same bug Claude Max already
 * hit and we already fixed.
 *
 * We deliberately keep gmail.ts + calendar.ts shadowing the router
 * for the canonical paths until PR 5 deletes them: the model can
 * still reach Gmail via either path during the transition. PR 5
 * lands 24h after this commit proves stable on prod.
 */

type ComposioActionListItem = {
  name?: string;
  enum?: string;
  display_name?: string;
  appName?: string;
  appKey?: string;
  description?: string;
};

type ComposioActionListResponse = {
  items?: ComposioActionListItem[];
  // Older shapes seen in Composio responses - tolerate both.
  actions?: ComposioActionListItem[];
};

// ─── Tool: composio_list_tools (discovery) ──────────────────────────

registerTool({
  name: "composio_list_tools",
  description:
    "List Composio actions available to this user. Pass an `app` slug (e.g. \"slack\", \"gmail\", \"hubspot\") to filter to one toolkit, or omit to fetch the full catalog. Use this before composio_use_tool so you know the exact action name + input shape to call.",
  inputSchema: {
    type: "object",
    properties: {
      app: {
        type: "string",
        description:
          "Optional Composio app slug. Omit or pass \"all\" to list every action across every connected app.",
      },
    },
  },
  handler: async (args) => {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      return textError(
        "COMPOSIO_API_KEY missing - composio router not configured",
      );
    }
    const rawApp = String(args.app ?? "").trim().toLowerCase();
    const filter = rawApp && rawApp !== "all" ? rawApp : "";

    const url = filter
      ? `https://backend.composio.dev/api/v1/actions?appNames=${encodeURIComponent(filter)}`
      : "https://backend.composio.dev/api/v1/actions";

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      return textError(
        `composio_list_tools fetch failed: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      return textError(
        `composio_list_tools ${res.status}: ${body.slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as ComposioActionListResponse;
    const items = json.items ?? json.actions ?? [];
    if (items.length === 0) {
      return text(
        filter
          ? `No Composio actions found for app "${filter}". Either the slug is wrong or the client hasn't connected this toolkit at /connections.`
          : "Composio returned an empty action catalog. Either COMPOSIO_API_KEY has no toolkits enabled or the request was rate-limited.",
      );
    }

    const header = filter
      ? `Composio actions for app "${filter}" (${items.length}):`
      : `Composio catalog actions (${items.length}). Pass \`app\` to filter:`;

    const lines = items.slice(0, 200).map((it, i) => {
      const slug = it.enum ?? it.name ?? "(unnamed)";
      const app = it.appName ?? it.appKey ?? "?";
      const display = it.display_name ?? it.name ?? slug;
      const desc = it.description ? ` - ${it.description.slice(0, 120)}` : "";
      return `${i + 1}. \`${slug}\` (app=${app}) - ${display}${desc}`;
    });

    const truncated =
      items.length > 200
        ? `\n\n(showing first 200 of ${items.length}; pass an \`app\` filter to narrow)`
        : "";

    return text(
      [
        header,
        "",
        "Pass any `slug` value above as `action` to composio_use_tool, plus the input the action expects.",
        "",
        ...lines,
        truncated,
      ].join("\n"),
    );
  },
});

// ─── Tool: composio_use_tool (invoke) ───────────────────────────────

registerTool({
  name: "composio_use_tool",
  description:
    "Invoke any Composio action on behalf of the connected user. Pass `app` (toolkit slug, e.g. \"slack\", \"gmail\", \"hubspot\"), `action` (the ACTION_ENUM string from composio_list_tools), and `input` (object matching that action's expected shape). Routes through the caller's per-user OAuth grant from migration 0063.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      app: {
        type: "string",
        description:
          "Composio app slug, e.g. \"slack\", \"gmail\", \"googlecalendar\", \"hubspot\". Must match a toolkit the client connected at /connections.",
      },
      action: {
        type: "string",
        description:
          "Composio action enum, e.g. \"SLACK_SEND_MESSAGE\". Discover via composio_list_tools.",
      },
      input: {
        type: "object",
        description:
          "Action-specific input payload. Schema varies per action - check composio_list_tools output or Composio docs.",
      },
    },
    required: ["app", "action", "input"],
  },
  handler: async (args, ctx) => {
    const app = String(args.app ?? "").trim().toLowerCase();
    const action = String(args.action ?? "").trim();
    const rawInput = args.input;
    if (!app) return textError("app is required");
    if (!action) return textError("action is required");
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      return textError("input must be an object matching the action's schema");
    }

    // Per-user OAuth (migration 0063): hit the caller's own connection
    // row first when ToolContext + composioAction expose a userId arg.
    // Worker 1 / PR 1 threads ctx.userId through; until that lands the
    // 4-arg signature falls back to the org-wide row.
    const callerUserId =
      (ctx as { userId?: string | null }).userId ?? null;

    let result: unknown;
    try {
      const composioActionAny = composioAction as unknown as (
        organizationId: string,
        appKey: string,
        action: string,
        input: Record<string, unknown>,
        userId?: string | null,
      ) => Promise<unknown>;
      result = await composioActionAny(
        ctx.organizationId,
        app,
        action,
        rawInput as Record<string, unknown>,
        callerUserId,
      );
    } catch (err) {
      return textError(
        `composio_use_tool ${app}/${action} failed: ${(err as Error).message}`,
      );
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(result, null, 2);
    } catch {
      serialized = String(result);
    }
    if (serialized.length > 8000) {
      serialized = serialized.slice(0, 8000) + "\n... (truncated)";
    }

    return text(
      [
        `Composio \`${action}\` on app \`${app}\` returned:`,
        "",
        "```json",
        serialized,
        "```",
      ].join("\n"),
    );
  },
});
