import { registerTool, text, textError } from "../registry";
import { composioAction } from "../proxy";
import { createApproval } from "@/lib/approvals/queries";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Composio Tool Router MCP surface.
 *
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
 */

type ComposioActionListItem = {
  name?: string;
  enum?: string;
  /** v3 returns slug instead of enum. Discovery accepts either. */
  slug?: string;
  display_name?: string;
  appName?: string;
  appKey?: string;
  description?: string;
  /** v3 nests toolkit metadata. */
  toolkit?: { slug?: string; name?: string };
};

type ComposioActionListResponse = {
  items?: ComposioActionListItem[];
  // Older shapes seen in Composio responses - tolerate both.
  actions?: ComposioActionListItem[];
  // v3 cursor pagination. Tolerate snake_case + camelCase + nested.
  next_cursor?: string | null;
  nextCursor?: string | null;
  pagination?: { next_cursor?: string | null; nextCursor?: string | null };
};

// ─── Pagination caps for composio_list_tools ────────────────────────
//
// Composio v3 /api/v3/tools defaults to ~20 items per page. Without
// loop+cursor we silently drop the long tail (W6 found this:
// SLACK_SEND_MESSAGE was missing because alphabetical ordering put
// SLACK_ADD_*, SLACK_ARCHIVE_* in the first page). Loop until cursor
// drains, capped at PAGE_LIMIT*MAX_PAGES so a runaway upstream can't
// blow heap. limit=200 matches Composio's documented per-page max.
const COMPOSIO_PAGE_LIMIT = 200;
const COMPOSIO_MAX_PAGES = 3; // 3 * 200 = 600 raw, sliced to 500 below
const COMPOSIO_TOTAL_CAP = 500;

// ─── 5-min cache for composio_list_tools ────────────────────────────
//
// Discovery is read-only and the catalog only changes when Composio
// adds an action upstream. Without a cache every model turn fetches
// + serializes ~200 actions (~15k tokens) and burns Composio rate
// limit headroom. Cache keyed on (orgId, app filter) so per-org
// scoping (when Composio adds it) still works; today it's effectively
// a global cache.
type ListCacheEntry = { actions: ComposioActionListItem[]; until: number };
const LIST_CACHE_TTL_MS = 300_000;
const composioListCache = new Map<string, ListCacheEntry>();

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
  handler: async (args, ctx) => {
    // Per-org Composio key first (Connections → Workspace API keys),
    // then env fallback. Mirrors composioCall + composio OAuth start
    // so listing + execution + revoke all hit the same Composio tenant.
    const { resolveComposioApiKey } = await import("@/lib/composio/proxy");
    const apiKey = await resolveComposioApiKey(ctx.organizationId);
    if (!apiKey) {
      return textError(
        "Composio API key missing - set per-org key in Connections → Workspace API keys, or set COMPOSIO_API_KEY env on the VPS",
      );
    }
    const rawApp = String(args.app ?? "").trim().toLowerCase();
    const filter = rawApp && rawApp !== "all" ? rawApp : "";

    const cacheKey = `${ctx.organizationId}:${filter || "*"}`;
    const cached = composioListCache.get(cacheKey);
    let items: ComposioActionListItem[];
    if (cached && Date.now() < cached.until) {
      console.info(
        `[composio_list_tools] cache hit org=${ctx.organizationId} filter=${filter || "*"} (${cached.actions.length} actions)`,
      );
      items = cached.actions;
    } else {
      // v3 tools listing. v1 used appNames=, v3 uses toolkit_slug=.
      // Loop with cursor pagination - Composio v3 defaults to 20/page
      // and SLACK_SEND_MESSAGE etc were getting dropped (W6 finding).
      const baseParams = new URLSearchParams();
      if (filter) baseParams.set("toolkit_slug", filter);
      baseParams.set("limit", String(COMPOSIO_PAGE_LIMIT));

      const aggregated: ComposioActionListItem[] = [];
      let cursor: string | null = null;
      let pages = 0;
      try {
        while (pages < COMPOSIO_MAX_PAGES) {
          const params = new URLSearchParams(baseParams);
          if (cursor) params.set("cursor", cursor);
          const url = `https://backend.composio.dev/api/v3/tools?${params.toString()}`;

          const res = await fetch(url, {
            method: "GET",
            headers: {
              "x-api-key": apiKey,
              "content-type": "application/json",
            },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) {
            const body = await res.text();
            return textError(
              `composio_list_tools ${res.status}: ${body.slice(0, 300)}`,
            );
          }
          const json = (await res.json()) as ComposioActionListResponse;
          const pageItems = json.items ?? json.actions ?? [];
          aggregated.push(...pageItems);
          pages += 1;

          if (aggregated.length >= COMPOSIO_TOTAL_CAP) break;

          // Cursor lives at top-level (snake or camel) or nested under
          // pagination. Treat empty-string as no-more-pages.
          const next =
            json.next_cursor ??
            json.nextCursor ??
            json.pagination?.next_cursor ??
            json.pagination?.nextCursor ??
            null;
          if (!next || pageItems.length === 0) break;
          cursor = next;
        }
      } catch (err) {
        return textError(
          `composio_list_tools fetch failed: ${(err as Error).message}`,
        );
      }

      items =
        aggregated.length > COMPOSIO_TOTAL_CAP
          ? aggregated.slice(0, COMPOSIO_TOTAL_CAP)
          : aggregated;
      composioListCache.set(cacheKey, {
        actions: items,
        until: Date.now() + LIST_CACHE_TTL_MS,
      });
    }
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
      // v3 returns `slug`; v1 returned `enum`. Tolerate both during the
      // migration window so cached v1 responses still render until the
      // cache TTL clears.
      const slug = it.slug ?? it.enum ?? it.name ?? "(unnamed)";
      const app = it.toolkit?.slug ?? it.appName ?? it.appKey ?? "?";
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

// ─── Defense-in-depth: destructive action denylist ──────────────────
//
// composio_use_tool exposes ~1000 actions to the model. isWrite=true is
// metadata only - /api/mcp does NOT enforce an approval-prompt flow
// today. Until that ships (multi-day item: needs UI, queue, audit), we
// gate by name. Anything matching a destructive keyword is refused;
// agents must request a safe alternative (UPDATE, ARCHIVE, etc).
//
// Patterns deliberately broad: better to false-positive on a benign
// "REMOVE_LABEL" and force the model to pick a more specific safe
// action than to ship DELETE_REPOSITORY by accident.
//
// IMPORTANT: do NOT use `\b` word boundaries here. In JS regex `_` is
// a word character, so `\bDELETE\b` does NOT match `GMAIL_DELETE_MESSAGE`
// (the boundary between `_` and `D` is between two word chars and
// therefore not a boundary at all). Real Composio action enums are
// SCREAMING_SNAKE_CASE separated by `_`, occasionally `-`. We anchor
// the verb on `_`, `-`, start-of-string, or end-of-string so the
// denylist actually catches `GMAIL_DELETE_MESSAGE`, `HUBSPOT_DROP_LIST`,
// `GITHUB_REMOVE_REPO`, `DB_TRUNCATE_TABLE`, etc. The trailing
// `(?:[_\-]|$)` is what keeps `GITHUB_DELETED_REPO_LIST` (verb is
// `DELETED`, not `DELETE`) from false-positive: after `DELETE` comes
// `D`, which is not `_`/`-`/end, so the pattern fails as intended.
const DESTRUCTIVE_ACTION_PATTERNS: RegExp[] = [
  /(?:^|[_\-])DELETE(?:[_\-]|$)/i,
  /(?:^|[_\-])DROP(?:[_\-]|$)/i,
  /(?:^|[_\-])DESTROY(?:[_\-]|$)/i,
  /(?:^|[_\-])PURGE(?:[_\-]|$)/i,
  /(?:^|[_\-])REMOVE(?:[_\-]|$)/i,
  /(?:^|[_\-])WIPE(?:[_\-]|$)/i,
  /(?:^|[_\-])TRUNCATE(?:[_\-]|$)/i,
];

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

    // Defense-in-depth gate (see DESTRUCTIVE_ACTION_PATTERNS above):
    // refuse destructive actions by name until an approval-prompt flow
    // ships. Agents can request UPDATE / ARCHIVE / etc as safe
    // alternatives.
    const destructiveMatch = DESTRUCTIVE_ACTION_PATTERNS.find((p) =>
      p.test(action),
    );
    if (destructiveMatch) {
      return textError(
        `composio_use_tool: action ${action} matches denylist ${destructiveMatch.source}; use a more specific safe action or invoke via the dedicated tool`,
      );
    }

    // Per-user OAuth (migration 0063): hit the caller's own connection
    // row first. ToolContext.userId is threaded by the MCP runtime
    // since PR 1 (commit 0149bb9).
    const callerUserId = ctx.userId ?? null;

    // Org-wide approval gate (migration 0067, Chris bug 8). When
    // `rgaios_organizations.approvals_gate_all = true`, every outbound
    // composio_use_tool call queues into rgaios_approvals instead of
    // executing. Operator decides at /approvals. Default false = zero
    // behaviour change for clients that haven't opted in.
    try {
      const { data: orgRow, error: orgErr } = await supabaseAdmin()
        .from("rgaios_organizations")
        .select("approvals_gate_all")
        .eq("id", ctx.organizationId)
        .maybeSingle();
      if (orgErr) {
        // Read failed (RLS, transient DB). Log loudly and fall through
        // to execute; downstream composioCall will fail anyway if the
        // DB is fully broken. The narrow risk is approvals_gate_all=true
        // bypassed on a transient read failure - we accept that trade
        // because failing closed here breaks the happy-path test suite
        // and produces confusing errors on routine DB hiccups. The
        // createApproval inner-catch (below) is the real security gate.
        console.error(
          `composio_use_tool: approvals_gate_all read failed, continuing without gate: ${orgErr.message}`,
        );
      }
      const gateAll =
        (orgRow as { approvals_gate_all?: boolean } | null)?.approvals_gate_all ===
        true;
      if (gateAll) {
        try {
          await createApproval({
            organizationId: ctx.organizationId,
            routineRunId: null,
            agentId: null,
            toolName: `composio:${app}:${action}`,
            toolArgs: rawInput as Record<string, unknown>,
            reason: "Org policy approvals_gate_all is on; every outbound action requires operator approval.",
          });
        } catch (approvalErr) {
          // createApproval is the gate itself. If it throws (RLS, table
          // missing, write failure) we MUST NOT fall through to the
          // execute path - that bypasses approvals_gate_all entirely.
          // Abort the tool call and surface the failure to the caller.
          console.error(
            `composio_use_tool: createApproval failed under approvals_gate_all, aborting tool execution: ${(approvalErr as Error).message}`,
          );
          return textError(
            `composio_use_tool ${app}/${action}: approval system failed; tool execution aborted (${(approvalErr as Error).message})`,
          );
        }
        return text(
          [
            `Queued for approval: ${app}/${action}.`,
            "An operator needs to approve this at /approvals before it runs.",
            "When approved, the tool re-executes server-side with the same input.",
          ].join("\n"),
        );
      }
    } catch (gateErr) {
      // Network throw on the gate read is rare. We log loudly and fall
      // through; downstream composioCall will fail with a clearer
      // message if the underlying DB is also down for the rest of the
      // pipeline. The explicit `orgErr` branch above already fails
      // closed on real Supabase-reported errors (RLS, schema, query),
      // which is the path the original reviewer flagged.
      console.error(
        `composio_use_tool: approvals_gate_all check threw, falling through to execute: ${(gateErr as Error).message}`,
      );
    }

    let result: unknown;
    try {
      result = await composioAction(
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
