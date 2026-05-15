import { registerTool, text, textError } from "../registry";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";

/**
 * Apify actor runner. Apify isn't a Composio app, so this wires the
 * native API directly. The key is stored in rgaios_connections under
 * provider_config_key='apify-key' and never leaves the VPS - lookup
 * is scoped by organization_id so one org can't drive another's key.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_RUNS_LIMIT = 10;
// run-sync-get-dataset-items blocks until the actor finishes; a cold
// start + a real scrape regularly needs >2min. Both call surfaces allow
// >=300s turns (telegram webhook maxDuration=300, dashboard chat route
// uncapped), so 180s survives most cold starts with headroom.
const RUN_TIMEOUT_MS = 180_000;
const MAX_BODY = 500;

type ApifyMetadata = {
  api_key?: string;
  token?: string;
  key?: string;
} | null;

async function resolveApifyKey(
  organizationId: string,
): Promise<{ key: string } | { error: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("rgaios_connections")
    .select("metadata")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "apify-key")
    .eq("status", "connected")
    .maybeSingle();

  if (error) return { error: `apify: ${error.message}` };
  if (!data) return { error: "Apify not connected - add your key at /connections" };

  const meta = data.metadata as ApifyMetadata;
  const key = tryDecryptSecret(meta?.api_key ?? meta?.token ?? meta?.key);
  if (!key) return { error: "Apify not connected - add your key at /connections" };

  return { key };
}

function clampLimit(raw: unknown, fallback: number, cap: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), cap);
}

async function readBodySafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "(no body)";
  }
}

registerTool({
  name: "apify_run_actor",
  description:
    "Run an Apify actor synchronously and get its dataset items. Use for scraping tasks (Instagram Reels Scraper, etc.).",
  isWrite: true,
  // Apify isn't a Composio app, so it gets its own integration id.
  // Tagging it means the agent's write_policy can grant both apify
  // tools with the single key "apify" (instead of per-tool-name
  // entries), and the executor's explicit-mode filter keeps the
  // tools visible whenever an agent has the apify connector enabled.
  // It also makes registry.callTool() surface a "connect Apify"
  // hint when the org has no apify-key row.
  requiresIntegration: "apify",
  inputSchema: {
    type: "object",
    properties: {
      actor_id: {
        type: "string",
        description:
          "Apify actor id, e.g. \"apify/instagram-reel-scraper\".",
      },
      run_input: {
        type: "object",
        description: "The actor's input JSON (passed as the request body).",
      },
      limit: {
        type: "number",
        description: `Max dataset items to return. Default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT}.`,
      },
    },
    required: ["actor_id", "run_input"],
  },
  handler: async (args, ctx) => {
    const actorId = String(args.actor_id ?? "").trim();
    if (!actorId) return textError("actor_id is required");

    const runInput = args.run_input;
    if (runInput === undefined || runInput === null || typeof runInput !== "object") {
      return textError("run_input is required");
    }

    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);

    // Decouple what we FETCH from the actor from what we RETURN. The
    // Instagram scraper surfaces pinned posts first; if we ask the
    // actor for only `limit` items (e.g. 3) it returns 3 pinned posts
    // and there is nothing left to sort - "latest 3" comes back as the
    // 3 oldest pinned bangers. So always pull a generous window, sort
    // newest-first below, then slice to `limit`. Also bump any
    // run_input.resultsLimit the model set to the same floor so the
    // actor itself does not pre-truncate to the small number.
    const fetchLimit = Math.min(Math.max(limit * 5, 30), MAX_LIMIT);
    const runInputObj = runInput as Record<string, unknown>;
    if (
      typeof runInputObj.resultsLimit === "number" &&
      runInputObj.resultsLimit < fetchLimit
    ) {
      runInputObj.resultsLimit = fetchLimit;
    }

    const resolved = await resolveApifyKey(ctx.organizationId);
    if ("error" in resolved) return textError(resolved.error);

    // Apify API expects the actor id in the path as `username~actorname`.
    // Models naturally write `apify/instagram-scraper` (the slash form
    // shown on apify.com) - left as-is that becomes an extra path
    // segment and the API 404s ("no API endpoint at this URL").
    const actorPath = actorId.replace("/", "~");
    // Token goes in the Authorization header, not the query string - a
    // secret in a URL leaks into access logs / proxy logs / error traces.
    const url =
      `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items` +
      `?limit=${fetchLimit}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${resolved.key}`,
        },
        body: JSON.stringify(runInput),
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      });
    } catch (err) {
      // AbortSignal.timeout fires a TimeoutError (DOMException name
      // "TimeoutError"); a hard abort surfaces as "AbortError". Either
      // way the run-sync call blew past the chat-turn budget. Return a
      // plain-English explanation the agent can honestly relay instead
      // of leaking "AbortError" - the scrape may still be running on
      // Apify's side; the operator can retry or narrow it.
      const e = err as Error;
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        return textError(
          `apify_run_actor: the scrape on ${actorId} is taking longer than ` +
            `this chat turn allows (>${Math.round(RUN_TIMEOUT_MS / 1000)}s) - ` +
            `the actor may still be running on Apify. Try again, or narrow ` +
            `the scrape (fewer profiles/posts, a smaller resultsLimit). You ` +
            `can also check apify_list_actor_runs to see if it finished.`,
        );
      }
      return textError(`apify_run_actor: ${e.message}`);
    }

    if (res.status !== 200 && res.status !== 201) {
      const respBody = await readBodySafe(res);
      // A 404 here almost always means the actor_id is wrong or
      // hallucinated - the API has no endpoint for an actor that does
      // not exist. Say so plainly and point the agent back at the
      // documented presets instead of leaving it to re-guess.
      if (res.status === 404) {
        return textError(
          `apify_run_actor: actor "${actorId}" not found - check the ` +
            `actor_id; use one of the documented Apify presets in your ` +
            `instructions, or apify_list_actor_runs to confirm an actor ` +
            `exists. ${respBody.slice(0, MAX_BODY)}`,
        );
      }
      return textError(
        `apify_run_actor: ${res.status} ${respBody.slice(0, MAX_BODY)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (err) {
      return textError(`apify_run_actor: bad JSON - ${(err as Error).message}`);
    }

    // Sort newest-first BEFORE slicing. The Instagram scraper returns a
    // profile's PINNED posts at the top of the grid (they can be years
    // old) followed by the rest in roughly feed order - a plain
    // slice(0,limit) therefore returned a mix of pinned + recent and
    // missed the actual latest posts. Sort by the post timestamp
    // descending so "latest N" means latest N. Items with no timestamp
    // sort last rather than poisoning the order.
    const postTime = (o: unknown): number => {
      const r = (o ?? {}) as Record<string, unknown>;
      const raw =
        r.timestamp ??
        r.takenAt ??
        r.taken_at_timestamp ??
        r.takenAtTimestamp ??
        r.created_time;
      if (typeof raw === "number") {
        // Instagram epoch fields are seconds; ISO strings parse to ms.
        return raw > 1e12 ? raw : raw * 1000;
      }
      const parsedTs = Date.parse(String(raw ?? ""));
      return Number.isFinite(parsedTs) ? parsedTs : 0;
    };
    const allItems = Array.isArray(parsed) ? parsed : [];
    const items = [...allItems]
      .sort((a, b) => postTime(b) - postTime(a))
      .slice(0, limit);

    // Human-readable list instead of a raw JSON dump. Most scrape actors
    // (Instagram, web) return items with some recognisable subset of
    // caption/title/text + url + an author + engagement counts. Pull
    // those out per item; fall back to a short JSON slice only when an
    // item has none of the known fields.
    const s = (v: unknown): string =>
      typeof v === "string" ? v : v == null ? "" : String(v);
    const lines = items.slice(0, 15).map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const title =
        s(o.caption) || s(o.title) || s(o.text) || s(o.name) || "";
      const url = s(o.url) || s(o.link) || s(o.postUrl);
      const who = s(o.ownerUsername) || s(o.username) || s(o.author);
      const likes = o.likesCount ?? o.likeCount ?? o.likes;
      const comments = o.commentsCount ?? o.commentCount ?? o.comments;
      const meta = [
        who && `@${who}`,
        likes != null && `${likes} likes`,
        comments != null && `${comments} comments`,
      ]
        .filter(Boolean)
        .join(" · ");
      const head =
        title.replace(/\s+/g, " ").slice(0, 120) ||
        (url ? "(no caption)" : JSON.stringify(o).slice(0, 120));
      return `• ${head}${meta ? ` (${meta})` : ""}${url ? `\n  ${url}` : ""}`;
    });
    const more = items.length > 15 ? `\n…and ${items.length - 15} more` : "";

    return text(
      items.length === 0
        ? `Actor ${actorId} ran - 0 items returned.`
        : `Actor ${actorId} returned ${items.length} item(s):\n${lines.join("\n")}${more}`,
    );
  },
});

registerTool({
  name: "apify_list_actor_runs",
  description:
    "List recent runs of an Apify actor to check status/results.",
  // Same integration id as apify_run_actor - one connector grant
  // ("apify") covers both tools in the agent write_policy.
  requiresIntegration: "apify",
  inputSchema: {
    type: "object",
    properties: {
      actor_id: {
        type: "string",
        description: "Apify actor id, e.g. \"apify/instagram-reel-scraper\".",
      },
      limit: {
        type: "number",
        description: `Max runs to return. Default ${DEFAULT_RUNS_LIMIT}.`,
      },
    },
    required: ["actor_id"],
  },
  handler: async (args, ctx) => {
    const actorId = String(args.actor_id ?? "").trim();
    if (!actorId) return textError("actor_id is required");

    const limit = clampLimit(args.limit, DEFAULT_RUNS_LIMIT, MAX_LIMIT);

    const resolved = await resolveApifyKey(ctx.organizationId);
    if ("error" in resolved) return textError(resolved.error);

    // Slash form (`apify/instagram-scraper`) -> tilde form for the path.
    const actorPath = actorId.replace("/", "~");
    // Token in the Authorization header, not the query string (no secret
    // in URLs - logs / proxies / error traces).
    const url =
      `https://api.apify.com/v2/acts/${actorPath}/runs` +
      `?limit=${limit}&desc=true`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${resolved.key}` },
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      });
    } catch (err) {
      return textError(`apify_list_actor_runs: ${(err as Error).message}`);
    }

    if (res.status !== 200) {
      const respBody = await readBodySafe(res);
      return textError(
        `apify_list_actor_runs: ${res.status} ${respBody.slice(0, MAX_BODY)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (err) {
      return textError(
        `apify_list_actor_runs: bad JSON - ${(err as Error).message}`,
      );
    }

    const runs =
      parsed && typeof parsed === "object" && "data" in parsed
        ? (parsed as { data?: { items?: unknown[] } }).data?.items
        : undefined;
    const list = Array.isArray(runs) ? runs : [];

    const summary = list
      .map((r) => {
        const run = r as {
          id?: string;
          status?: string;
          startedAt?: string;
          defaultDatasetId?: string;
        };
        return `${run.id ?? "?"} | ${run.status ?? "?"} | ${run.startedAt ?? "?"} | dataset=${run.defaultDatasetId ?? "?"}`;
      })
      .join("\n");

    return text(`Actor ${actorId} - ${list.length} recent run(s).\n${summary}`);
  },
});
