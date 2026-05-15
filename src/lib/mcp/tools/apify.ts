import { registerTool, text, textError } from "../registry";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";
import type { ToolContext } from "../types";

/**
 * Apify actor runner. Apify isn't a Composio app, so this wires the
 * native API directly. The key is stored in rgaios_connections under
 * provider_config_key='apify-key' and never leaves the VPS - lookup
 * is scoped by organization_id so one org can't drive another's key.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_RUNS_LIMIT = 10;
// run-sync-get-dataset-items blocks until the actor finishes. Apify's
// own server-side max for this endpoint is 300s (per
// https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post -
// "default maximum synchronous wait is 300 seconds; exceeding it
// results in a timeout error"). We previously capped at 180s which
// aborted runs Apify itself would have completed inside their own
// 300s budget. A multi-handle Instagram reel scrape on 13 profiles
// with resultsLimit 5 typically finishes 70-90s scrape + 30s cold
// start = ~120s total - the 180s ceiling was clipping the long tail.
// Set to 280_000 so we abort just under Apify's hard limit, giving
// the actor every chance to finish.
const RUN_TIMEOUT_MS = 280_000;
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

    // Decouple what we FETCH from the actor from what we RETURN.
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

    // Auto-split: if the agent passed >5 handles in `username`, the
    // Apify run-sync call would scrape all of them serially inside
    // the actor and frequently exceed our chat budget. Split into
    // 5-handle parallel sub-runs (Promise.all) so total wall-clock
    // = max(batch durations) instead of sum. Single tool call from
    // the agent's POV, hidden parallelism, same return shape.
    // Auto-split key + value: prefer `username` (reel-scraper shape),
    // fall back to `directUrls` (general instagram-scraper shape). The
    // general scraper is the recommended actor in the preamble; it
    // takes profile URLs under directUrls.
    const usernameArg = runInputObj.username;
    const directUrlsArg = runInputObj.directUrls;
    let splitKey: "username" | "directUrls" | null = null;
    let handles: string[] | null = null;
    if (
      Array.isArray(usernameArg) &&
      usernameArg.every((u) => typeof u === "string")
    ) {
      splitKey = "username";
      handles = usernameArg as string[];
    } else if (
      Array.isArray(directUrlsArg) &&
      directUrlsArg.every((u) => typeof u === "string")
    ) {
      splitKey = "directUrls";
      handles = directUrlsArg as string[];
    }
    const AUTO_SPLIT_AT = 5;
    const actorPath = actorId.replace("/", "~");
    // Token goes in the Authorization header, not the query string - a
    // secret in a URL leaks into access logs / proxy logs / error traces.
    const url =
      `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items` +
      `?limit=${fetchLimit}`;

    let res: Response;
    let parsedInjection: unknown[] | null = null;
    // Parallel auto-split path: >5 handles -> Promise.all across
    // 5-handle batches. Each carries its own RUN_TIMEOUT_MS budget.
    // Single tool call from the agent's POV, hidden parallelism.
    if (handles && splitKey && handles.length > AUTO_SPLIT_AT) {
      const batches: string[][] = [];
      for (let i = 0; i < handles.length; i += AUTO_SPLIT_AT) {
        batches.push(handles.slice(i, i + AUTO_SPLIT_AT));
      }
      const batchResults = await Promise.all(
        batches.map(async (batch): Promise<unknown[]> => {
          const subInput = { ...runInputObj, [splitKey]: batch };
          try {
            const r = await fetch(url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${resolved.key}`,
              },
              body: JSON.stringify(subInput),
              signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
            });
            if (r.status !== 200 && r.status !== 201) return [];
            const j = await r.json();
            return Array.isArray(j) ? j : [];
          } catch {
            return [];
          }
        }),
      );
      const merged: unknown[] = [];
      for (const items of batchResults) {
        for (const it of items) merged.push(it);
      }
      res = { status: 200 } as Response;
      parsedInjection = merged;
    } else try {
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

    let parsed: unknown = parsedInjection;
    if (parsed === null) {
      try {
        parsed = await res.json();
      } catch (err) {
        return textError(`apify_run_actor: bad JSON - ${(err as Error).message}`);
      }
    }

    // Sort newest-first BEFORE slicing.
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
    // Marti's complaint - "low comment reels / wrong info" - traced to
    // the model anchoring on the time-ordered visible list. Compute the
    // top-5 by commentsCount ACROSS the full pre-truncation list and
    // prepend as a header so the model sees the comment-ranked picks
    // BEFORE the time-ordered body. Same approach used in
    // humanizeToolResult Instagram branch (inv-tool-quality D4).
    const _commentsOf = (o: unknown): number => {
      const r = (o ?? {}) as Record<string, unknown>;
      const v = r.commentsCount ?? r.commentCount ?? r.comments;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const topByComments = [...allItems]
      .map((p) => ({ p, c: _commentsOf(p) }))
      .filter((r) => r.c > 0)
      .sort((a, b) => b.c - a.c)
      .slice(0, 5);

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

    // Top-by-comments header (Marti GAP #12 wrong-info root cause):
    // pre-fix the visible result list was time-ordered, agent claimed
    // "top by comments" while reading time-ranked items. Prepending the
    // comment-ranked picks forces the agent's eye onto the right metric.
    const topHeader =
      topByComments.length > 0
        ? `Top ${topByComments.length} by comments (across all ${allItems.length} items): ${topByComments
            .map((r) => {
              const o = (r.p ?? {}) as Record<string, unknown>;
              const who = s(o.ownerUsername) || s(o.username) || s(o.author);
              return who ? `@${who} (${r.c})` : `(${r.c})`;
            })
            .join(", ")}.\n\n`
        : "";

    return text(
      items.length === 0
        ? `Actor ${actorId} ran - 0 items returned.`
        : `${topHeader}Actor ${actorId} returned ${items.length} item(s):\n${lines.join("\n")}${more}`,
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

/**
 * apify_start_run + apify_poll_run - async pattern. Use these when
 * the synchronous apify_run_actor would exceed the chat turn budget
 * (>180s): wide scrapes across many handles, large resultsLimit, or
 * any cold-start actor. The flow:
 *
 *   1. apify_start_run(actor_id, run_input)
 *      -> kicks off the actor, returns { run_id, dataset_id, status }
 *      in ~1-2s without waiting. Emit MULTIPLE in parallel for batch
 *      scrapes.
 *
 *   2. apify_poll_run(run_id, max_wait_seconds)
 *      -> polls the run for up to max_wait_seconds (cap 60s). If the
 *      actor finishes within that window, returns the dataset items
 *      formatted the same way as apify_run_actor. If it's still
 *      running, returns "in-flight, retry the poll" - the agent can
 *      decide to poll again next turn instead of holding the chat.
 *
 * This pattern keeps each individual tool call well under the chat
 * turn budget and lets a 13-handle scrape complete in 2-3 polled
 * turns instead of one stalled 10-minute call.
 */

const POLL_DEFAULT_WAIT_S = 30;
const POLL_MAX_WAIT_S = 60;
const POLL_INTERVAL_MS = 5_000;
const RUN_KICKOFF_TIMEOUT_MS = 15_000;

type ApifyRunSnapshot = {
  id?: string;
  status?: string;
  defaultDatasetId?: string;
  startedAt?: string;
  finishedAt?: string;
  buildId?: string;
};

registerTool({
  name: "apify_start_run",
  description:
    "Start an Apify actor run WITHOUT waiting for it to finish. Returns a run_id + dataset_id so a subsequent apify_poll_run can fetch the results. Use this for wide scrapes that would exceed the chat turn budget under apify_run_actor.",
  isWrite: true,
  requiresIntegration: "apify",
  inputSchema: {
    type: "object",
    properties: {
      actor_id: {
        type: "string",
        description: 'Apify actor id, e.g. "apify/instagram-reel-scraper".',
      },
      run_input: {
        type: "object",
        description: "The actor's input JSON (passed as the request body).",
      },
    },
    required: ["actor_id", "run_input"],
  },
  handler: async (args, ctx) => {
    const actorId = String(args.actor_id ?? "").trim();
    if (!actorId) return textError("actor_id is required");
    const runInput = args.run_input;
    if (
      runInput === undefined ||
      runInput === null ||
      typeof runInput !== "object"
    ) {
      return textError("run_input is required");
    }
    const resolved = await resolveApifyKey(ctx.organizationId);
    if ("error" in resolved) return textError(resolved.error);

    const actorPath = actorId.replace("/", "~");
    const url = `https://api.apify.com/v2/acts/${actorPath}/runs`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${resolved.key}`,
        },
        body: JSON.stringify(runInput),
        signal: AbortSignal.timeout(RUN_KICKOFF_TIMEOUT_MS),
      });
    } catch (err) {
      const e = err as Error;
      return textError(`apify_start_run: ${e.message}`);
    }
    if (res.status !== 200 && res.status !== 201) {
      const respBody = await readBodySafe(res);
      if (res.status === 404) {
        return textError(
          `apify_start_run: actor "${actorId}" not found - check the actor_id. ${respBody.slice(0, MAX_BODY)}`,
        );
      }
      return textError(
        `apify_start_run: ${res.status} ${respBody.slice(0, MAX_BODY)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (err) {
      return textError(`apify_start_run: bad JSON - ${(err as Error).message}`);
    }
    const run = (parsed as { data?: ApifyRunSnapshot } | null)?.data ?? {};
    if (!run.id) {
      return textError(`apify_start_run: response missing run id`);
    }
    return text(
      `Started run on ${actorId}.\n` +
        `run_id: ${run.id}\n` +
        `dataset_id: ${run.defaultDatasetId ?? "(pending)"}\n` +
        `status: ${run.status ?? "READY"}\n` +
        `Call apify_poll_run with run_id="${run.id}" to fetch results once it finishes.`,
    );
  },
});

registerTool({
  name: "apify_poll_run",
  description:
    "Poll an Apify run started via apify_start_run. Waits up to max_wait_seconds (default 30, cap 60) for the run to finish. Returns the dataset items if it completes within the window, or a still-running status if not.",
  isWrite: false,
  requiresIntegration: "apify",
  inputSchema: {
    type: "object",
    properties: {
      run_id: { type: "string", description: "The run id from apify_start_run." },
      max_wait_seconds: {
        type: "number",
        description: `Up to this many seconds to wait for the run. Default ${POLL_DEFAULT_WAIT_S}, cap ${POLL_MAX_WAIT_S}.`,
      },
      limit: {
        type: "number",
        description: `Max dataset items to return when the run finishes. Default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT}.`,
      },
    },
    required: ["run_id"],
  },
  handler: async (args, ctx) => {
    const runId = String(args.run_id ?? "").trim();
    if (!runId) return textError("run_id is required");
    const waitSec = clampLimit(
      args.max_wait_seconds,
      POLL_DEFAULT_WAIT_S,
      POLL_MAX_WAIT_S,
    );
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const resolved = await resolveApifyKey(ctx.organizationId);
    if ("error" in resolved) return textError(resolved.error);

    const deadline = Date.now() + waitSec * 1000;
    let snapshot: ApifyRunSnapshot | null = null;
    while (Date.now() < deadline) {
      let res: Response;
      try {
        res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
          headers: { authorization: `Bearer ${resolved.key}` },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        return textError(`apify_poll_run: ${(err as Error).message}`);
      }
      if (res.status !== 200) {
        const body = await readBodySafe(res);
        return textError(
          `apify_poll_run: ${res.status} ${body.slice(0, MAX_BODY)}`,
        );
      }
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch (err) {
        return textError(
          `apify_poll_run: bad JSON - ${(err as Error).message}`,
        );
      }
      snapshot = (parsed as { data?: ApifyRunSnapshot } | null)?.data ?? null;
      const status = snapshot?.status ?? "UNKNOWN";
      if (status === "SUCCEEDED") break;
      if (
        status === "FAILED" ||
        status === "ABORTED" ||
        status === "TIMED-OUT"
      ) {
        return textError(`apify_poll_run: run ${runId} ${status}`);
      }
      // RUNNING / READY: sleep + poll again.
      if (Date.now() + POLL_INTERVAL_MS >= deadline) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (snapshot?.status !== "SUCCEEDED") {
      return text(
        `Run ${runId} is still ${snapshot?.status ?? "running"} after ${waitSec}s. ` +
          `Call apify_poll_run again in a moment - the agent should hold the operator with a one-liner and re-poll, not stall the turn.`,
      );
    }

    // Fetch the dataset items.
    const datasetId = snapshot.defaultDatasetId;
    if (!datasetId) {
      return text(`Run ${runId} SUCCEEDED but has no dataset id.`);
    }
    let dres: Response;
    try {
      dres = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?limit=${MAX_LIMIT}`,
        {
          headers: { authorization: `Bearer ${resolved.key}` },
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch (err) {
      return textError(`apify_poll_run: dataset fetch ${(err as Error).message}`);
    }
    if (dres.status !== 200) {
      const body = await readBodySafe(dres);
      return textError(
        `apify_poll_run: dataset ${dres.status} ${body.slice(0, MAX_BODY)}`,
      );
    }
    let items: unknown;
    try {
      items = await dres.json();
    } catch (err) {
      return textError(
        `apify_poll_run: dataset bad JSON - ${(err as Error).message}`,
      );
    }
    const arr = Array.isArray(items) ? items : [];

    // Format dataset items - same shape as apify_run_actor so the
    // agent reads both paths identically.
    const postTime = (o: unknown): number => {
      const r = (o ?? {}) as Record<string, unknown>;
      const raw =
        r.timestamp ??
        r.takenAt ??
        r.taken_at_timestamp ??
        r.takenAtTimestamp ??
        r.created_time;
      if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
      const p = Date.parse(String(raw ?? ""));
      return Number.isFinite(p) ? p : 0;
    };
    const sorted = [...arr]
      .sort((a, b) => postTime(b) - postTime(a))
      .slice(0, limit);
    const s = (v: unknown): string =>
      typeof v === "string" ? v : v == null ? "" : String(v);
    const lines = sorted.slice(0, 15).map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const title = s(o.caption) || s(o.title) || s(o.text) || s(o.name) || "";
      const url = s(o.url) || s(o.link) || s(o.postUrl);
      const who = s(o.ownerUsername) || s(o.username) || s(o.author);
      const likes = o.likesCount ?? o.likeCount ?? o.likes;
      const comments = o.commentsCount ?? o.commentCount ?? o.comments;
      const ts = postTime(o);
      const tsStr = ts > 0 ? new Date(ts).toISOString() : "";
      const meta = [
        who && `@${who}`,
        likes != null && `${likes} likes`,
        comments != null && `${comments} comments`,
        tsStr && `posted ${tsStr.slice(0, 10)}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const head =
        title.replace(/\s+/g, " ").slice(0, 120) ||
        (url ? "(no caption)" : JSON.stringify(o).slice(0, 120));
      return `• ${head}${meta ? ` (${meta})` : ""}${url ? `\n  ${url}` : ""}`;
    });
    const more =
      sorted.length > 15 ? `\n…and ${sorted.length - 15} more` : "";
    return text(
      sorted.length === 0
        ? `Run ${runId} SUCCEEDED but returned 0 items.`
        : `Run ${runId} SUCCEEDED with ${sorted.length} item(s):\n${lines.join("\n")}${more}`,
    );
  },
});

/**
 * apify_batch_scrape - server-side parallel batches.
 *
 * The agent passes a full handle list; this tool splits it into
 * N-sized batches and fires apify run-sync calls in parallel via
 * Promise.all. Total wall-clock = max(batch durations) instead of
 * the sum, so a 13-handle scrape that would take 4-5 minutes
 * sequentially completes in ~90-120s.
 *
 * Marti retest pattern (eval 1-4) showed: agent fires multiple
 * apify_run_actor calls itself and loops, never synthesizing.
 * Pull the parallelism server-side so the agent makes ONE tool
 * call, gets ONE merged dataset back, and can synthesize.
 */
registerTool({
  name: "apify_batch_scrape",
  description:
    "Scrape an Apify actor on N handles via PARALLEL server-side batches and return ONE merged dataset. Use this when the creator list is >5 handles - it's wall-clock-faster than calling apify_run_actor multiple times in sequence, because the batches run concurrently in the same tool call.",
  isWrite: true,
  requiresIntegration: "apify",
  inputSchema: {
    type: "object",
    properties: {
      actor_id: {
        type: "string",
        description: 'Apify actor id, e.g. "apify/instagram-reel-scraper".',
      },
      handles: {
        type: "array",
        items: { type: "string" },
        description:
          "Bare handles to scrape. For Instagram, NOT URLs - the actor's `username` field.",
      },
      results_per_handle: {
        type: "number",
        description: "How many items per handle. Default 5, cap 20.",
      },
      batch_size: {
        type: "number",
        description: "Handles per parallel batch. Default 5, cap 8.",
      },
    },
    required: ["actor_id", "handles"],
  },
  handler: async (args, ctx) => {
    const actorId = String(args.actor_id ?? "").trim();
    if (!actorId) return textError("actor_id is required");
    const handlesArg = args.handles;
    if (!Array.isArray(handlesArg) || handlesArg.length === 0) {
      return textError("handles must be a non-empty array of strings");
    }
    const handles = handlesArg
      .map((h) => String(h ?? "").trim())
      .filter((h) => h.length > 0);
    if (handles.length === 0) {
      return textError("handles array is empty after trimming");
    }
    const perHandle = clampLimit(args.results_per_handle, 5, 20);
    const batchSize = clampLimit(args.batch_size, 5, 8);

    const resolved = await resolveApifyKey(ctx.organizationId);
    if ("error" in resolved) return textError(resolved.error);

    // Split into batches.
    const batches: string[][] = [];
    for (let i = 0; i < handles.length; i += batchSize) {
      batches.push(handles.slice(i, i + batchSize));
    }

    const actorPath = actorId.replace("/", "~");
    const fetchLimit = Math.min(perHandle * batchSize, MAX_LIMIT);
    const url =
      `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items` +
      `?limit=${fetchLimit}`;

    type BatchResult = {
      batchIndex: number;
      batchHandles: string[];
      items: unknown[];
      error: string | null;
    };

    // Fire all batches concurrently. Each carries its own 280s budget.
    const results: BatchResult[] = await Promise.all(
      batches.map(async (batch, idx): Promise<BatchResult> => {
        const runInput = { username: batch, resultsLimit: perHandle };
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
          const e = err as Error;
          return {
            batchIndex: idx,
            batchHandles: batch,
            items: [],
            error:
              e.name === "TimeoutError" || e.name === "AbortError"
                ? `batch ${idx + 1} timed out after ${Math.round(RUN_TIMEOUT_MS / 1000)}s`
                : e.message,
          };
        }
        if (res.status !== 200 && res.status !== 201) {
          const body = await readBodySafe(res);
          return {
            batchIndex: idx,
            batchHandles: batch,
            items: [],
            error: `batch ${idx + 1} HTTP ${res.status} ${body.slice(0, 150)}`,
          };
        }
        try {
          const parsed = await res.json();
          const arr = Array.isArray(parsed) ? parsed : [];
          return { batchIndex: idx, batchHandles: batch, items: arr, error: null };
        } catch (err) {
          return {
            batchIndex: idx,
            batchHandles: batch,
            items: [],
            error: `batch ${idx + 1} bad JSON: ${(err as Error).message}`,
          };
        }
      }),
    );

    // Merge + summarize.
    const allItems: unknown[] = [];
    const okBatches: number[] = [];
    const failedBatches: string[] = [];
    for (const r of results) {
      if (r.error) {
        failedBatches.push(
          `batch ${r.batchIndex + 1} (${r.batchHandles.join(", ")}): ${r.error}`,
        );
      } else {
        okBatches.push(r.batchIndex + 1);
        for (const it of r.items) allItems.push(it);
      }
    }

    // Sort newest-first by timestamp - same logic as apify_run_actor
    // so the agent can read the same shape from both tools.
    const postTime = (o: unknown): number => {
      const r = (o ?? {}) as Record<string, unknown>;
      const raw =
        r.timestamp ??
        r.takenAt ??
        r.taken_at_timestamp ??
        r.takenAtTimestamp ??
        r.created_time;
      if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
      const p = Date.parse(String(raw ?? ""));
      return Number.isFinite(p) ? p : 0;
    };
    const sorted = [...allItems].sort((a, b) => postTime(b) - postTime(a));

    const s = (v: unknown): string =>
      typeof v === "string" ? v : v == null ? "" : String(v);
    const cap = Math.min(sorted.length, 50);
    const lines = sorted.slice(0, cap).map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const title = s(o.caption) || s(o.title) || s(o.text) || s(o.name) || "";
      const url = s(o.url) || s(o.link) || s(o.postUrl);
      const who = s(o.ownerUsername) || s(o.username) || s(o.author);
      const likes = o.likesCount ?? o.likeCount ?? o.likes;
      const comments = o.commentsCount ?? o.commentCount ?? o.comments;
      const ts = postTime(o);
      const tsStr = ts > 0 ? new Date(ts).toISOString().slice(0, 10) : "";
      const meta = [
        who && `@${who}`,
        likes != null && `${likes} likes`,
        comments != null && `${comments} comments`,
        tsStr && `posted ${tsStr}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const head =
        title.replace(/\s+/g, " ").slice(0, 120) ||
        (url ? "(no caption)" : JSON.stringify(o).slice(0, 120));
      return `• ${head}${meta ? ` (${meta})` : ""}${url ? `\n  ${url}` : ""}`;
    });
    const more = sorted.length > cap ? `\n…and ${sorted.length - cap} more` : "";

    const header =
      `Batch scrape on ${actorId}: ${batches.length} batch(es), ` +
      `${okBatches.length} OK, ${failedBatches.length} failed. ` +
      `${allItems.length} total items merged.`;
    const failBlock =
      failedBatches.length > 0
        ? `\nFailed batches (you can retry just these):\n${failedBatches.join("\n")}`
        : "";
    return text(
      sorted.length === 0
        ? `${header}\n(no items - all batches failed)${failBlock}`
        : `${header}${failBlock}\n${lines.join("\n")}${more}`,
    );
  },
});

/**
 * apify_race_scrape - race multiple Instagram scrapers in parallel,
 * return whichever surfaces a dataset first. apify/instagram-reel-scraper
 * has known 'extremely slow' issues in 2026; apify/instagram-scraper +
 * apidojo/instagram-scraper return on different schedules. Racing them
 * gets the operator data from whichever happens to be healthy NOW.
 *
 * Input shape: handles (bare). Tool maps to each actor's native shape:
 *   apify/instagram-scraper       -> directUrls profile URLs + resultsType:"posts"
 *   apidojo/instagram-scraper     -> directUrls profile URLs
 *   apify/instagram-reel-scraper  -> username bare handles
 * Then Promise.any picks the FIRST one that returns >0 items.
 */
registerTool({
  name: "apify_race_scrape",
  description:
    "Race 2-3 Instagram scrapers in parallel for the same handles and return whichever surfaces a dataset first. Use this when one specific actor has been hanging - racing means the operator gets data from whichever is healthy. Single tool call.",
  isWrite: true,
  requiresIntegration: "apify",
  inputSchema: {
    type: "object",
    properties: {
      handles: {
        type: "array",
        items: { type: "string" },
        description: "Bare Instagram handles to scrape across the racing actors.",
      },
      results_per_handle: {
        type: "number",
        description: "How many items per handle. Default 5, cap 20.",
      },
    },
    required: ["handles"],
  },
  handler: async (args, ctx) => {
    const handlesArg = args.handles;
    if (!Array.isArray(handlesArg) || handlesArg.length === 0) {
      return textError("handles must be a non-empty array of bare handles");
    }
    const handles = handlesArg
      .map((h) => String(h ?? "").trim())
      .filter((h) => h.length > 0);
    if (handles.length === 0) return textError("handles array is empty");
    const perHandle = clampLimit(args.results_per_handle, 5, 20);

    const resolved = await resolveApifyKey(ctx.organizationId);
    if ("error" in resolved) return textError(resolved.error);

    // Per-actor request shapers.
    type ActorRace = {
      id: string;
      url: string;
      body: Record<string, unknown>;
    };
    const profileUrls = handles.map((h) => `https://www.instagram.com/${h}/`);
    const fetchLimit = Math.min(perHandle * handles.length, MAX_LIMIT);
    const sync = (actorId: string) =>
      `https://api.apify.com/v2/acts/${actorId.replace("/", "~")}/run-sync-get-dataset-items?limit=${fetchLimit}`;
    const races: ActorRace[] = [
      {
        id: "apify/instagram-scraper",
        url: sync("apify/instagram-scraper"),
        body: {
          directUrls: profileUrls,
          resultsType: "posts",
          resultsLimit: perHandle,
        },
      },
      {
        id: "apidojo/instagram-scraper",
        url: sync("apidojo/instagram-scraper"),
        body: { directUrls: profileUrls, resultsLimit: perHandle },
      },
    ];

    type RaceResult = {
      actor: string;
      items: unknown[];
      error: string | null;
    };
    // Use Promise.allSettled to capture every actor's outcome, then
    // pick the winner: first non-empty dataset by completion order. If
    // every actor times out or returns 0, surface the per-actor errors
    // so the operator can see WHICH path failed.
    const settled = await Promise.allSettled(
      races.map(async (race): Promise<RaceResult> => {
        try {
          const r = await fetch(race.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${resolved.key}`,
            },
            body: JSON.stringify(race.body),
            signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
          });
          if (r.status !== 200 && r.status !== 201) {
            const body = await readBodySafe(r);
            return {
              actor: race.id,
              items: [],
              error: `${r.status} ${body.slice(0, 150)}`,
            };
          }
          const j = await r.json();
          const arr = Array.isArray(j) ? j : [];
          return { actor: race.id, items: arr, error: null };
        } catch (err) {
          const e = err as Error;
          return {
            actor: race.id,
            items: [],
            error:
              e.name === "TimeoutError" || e.name === "AbortError"
                ? `timed out at ${Math.round(RUN_TIMEOUT_MS / 1000)}s`
                : e.message,
          };
        }
      }),
    );
    const results: RaceResult[] = settled.map((s) =>
      s.status === "fulfilled"
        ? s.value
        : { actor: "?", items: [], error: (s.reason as Error).message },
    );

    // Quality scoring beats raw race-to-first. The fastest actor may
    // return junk (empty captions, missing comments, stale items),
    // while the slower one delivers what the operator actually asked
    // for. Wait for every settled result, then score each dataset on
    // the criteria the operator's prompt cares about:
    //   - has caption text
    //   - has commentsCount
    //   - has a parseable timestamp (so window-filter actually works)
    //   - covers MULTIPLE distinct handles (creator-domination guard)
    // Pick the dataset that wins overall, NOT the one that returned
    // first.
    const postTime = (o: unknown): number => {
      const r = (o ?? {}) as Record<string, unknown>;
      const raw =
        r.timestamp ??
        r.takenAt ??
        r.taken_at_timestamp ??
        r.takenAtTimestamp ??
        r.created_time;
      if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
      const p = Date.parse(String(raw ?? ""));
      return Number.isFinite(p) ? p : 0;
    };
    const scoreDataset = (items: unknown[]): { score: number; brief: string } => {
      if (items.length === 0) return { score: 0, brief: "0 items" };
      let hasCaption = 0;
      let hasComments = 0;
      let hasTs = 0;
      const handlesSet = new Set<string>();
      for (const raw of items) {
        const o = (raw ?? {}) as Record<string, unknown>;
        const caption =
          typeof o.caption === "string"
            ? o.caption
            : typeof o.title === "string"
              ? o.title
              : typeof o.text === "string"
                ? o.text
                : "";
        if (caption.trim().length > 0) hasCaption++;
        const comments = o.commentsCount ?? o.commentCount ?? o.comments;
        if (typeof comments === "number") hasComments++;
        if (postTime(o) > 0) hasTs++;
        const who =
          typeof o.ownerUsername === "string"
            ? o.ownerUsername
            : typeof o.username === "string"
              ? o.username
              : typeof o.author === "string"
                ? o.author
                : "";
        if (who.trim().length > 0) handlesSet.add(who.trim().toLowerCase());
      }
      // Weighted: completeness matters more than raw count. Multi-creator
      // gets a bonus so a single-creator dump can't win over a thinner
      // multi-creator dataset.
      const completeness =
        (hasCaption + hasComments + hasTs) / (items.length * 3);
      const multiCreatorBonus = Math.min(handlesSet.size, 10) * 5;
      const score = items.length * completeness * 10 + multiCreatorBonus;
      const brief =
        `${items.length} items, ${handlesSet.size} handles, ` +
        `${hasComments}/${items.length} have comments, ` +
        `${hasTs}/${items.length} have timestamp, ` +
        `completeness ${(completeness * 100).toFixed(0)}%`;
      return { score, brief };
    };
    const scored = results.map((r) => ({
      ...r,
      ...scoreDataset(r.items),
    }));
    // Sort by score desc; the highest-quality dataset wins.
    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];
    if (!winner || winner.score === 0) {
      const errs = results
        .map((r) => `${r.actor}: ${r.error ?? "0 items"}`)
        .join("; ");
      return textError(`All racing actors failed quality bar - ${errs}`);
    }
    const commentCount = (raw: unknown): number => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const v = o.commentsCount ?? o.commentCount ?? o.comments;
      return typeof v === "number" ? v : Number(v) || 0;
    };
    // Default sort = comments desc (most common ranking metric for IG reels).
    // Caller asking for top-by-comments wants the highest-commented items
    // surfaced first, not the latest. Time desc would skew toward whichever
    // creator posts most often and hide higher-commented older posts within
    // the time window.
    const handleOf = (raw: unknown): string => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const v =
        (typeof o.ownerUsername === "string" && o.ownerUsername) ||
        (typeof o.username === "string" && o.username) ||
        (typeof o.author === "string" && o.author) ||
        "";
      return String(v).toLowerCase();
    };
    // Diversify ranking: cap each creator at max 2 reels in the top output.
    // Without this, one prolific creator (e.g. someone posting daily) can fill
    // the top N globally when other handles in the user's list have lower-
    // volume but still high-quality items. Cap matches Marti's bar that top-N
    // "from my creator list" surfaces multiple creators, not one dominator.
    const PER_CREATOR_CAP = 2;
    const byCreator = new Map<string, number>();
    const sortedAll = [...winner.items].sort(
      (a, b) => commentCount(b) - commentCount(a),
    );
    const diversified: unknown[] = [];
    const overflow: unknown[] = [];
    for (const item of sortedAll) {
      const h = handleOf(item);
      const seen = byCreator.get(h) ?? 0;
      if (!h || seen < PER_CREATOR_CAP) {
        diversified.push(item);
        if (h) byCreator.set(h, seen + 1);
      } else {
        overflow.push(item);
      }
    }
    // Append the overflow at the end so callers can still see what was
    // dropped, but the top of the list is creator-diverse.
    const sorted = [...diversified, ...overflow].slice(0, MAX_LIMIT);
    const s = (v: unknown): string =>
      typeof v === "string" ? v : v == null ? "" : String(v);
    // Bumped cap 50 -> 100 so the agent can apply its own per-creator
    // diversification on a wider candidate pool.
    const cap = Math.min(sorted.length, 100);
    const lines = sorted.slice(0, cap).map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const title = s(o.caption) || s(o.title) || s(o.text) || s(o.name) || "";
      const url = s(o.url) || s(o.link) || s(o.postUrl);
      const who = s(o.ownerUsername) || s(o.username) || s(o.author);
      const likes = o.likesCount ?? o.likeCount ?? o.likes;
      const comments = o.commentsCount ?? o.commentCount ?? o.comments;
      const ts = postTime(o);
      const tsStr = ts > 0 ? new Date(ts).toISOString().slice(0, 10) : "";
      const meta = [
        who && `@${who}`,
        likes != null && `${likes} likes`,
        comments != null && `${comments} comments`,
        tsStr && `posted ${tsStr}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const head =
        title.replace(/\s+/g, " ").slice(0, 120) ||
        (url ? "(no caption)" : JSON.stringify(o).slice(0, 120));
      return `• ${head}${meta ? ` (${meta})` : ""}${url ? `\n  ${url}` : ""}`;
    });
    const more = sorted.length > cap ? `\n…and ${sorted.length - cap} more` : "";
    const others = scored
      .filter((r) => r.actor !== winner.actor)
      .map(
        (r) =>
          `${r.actor}: ${r.error ?? r.brief} (score ${r.score.toFixed(0)})`,
      )
      .join("; ");
    return text(
      `Winner by quality: ${winner.actor} (${winner.brief}, score ${winner.score.toFixed(0)}). Others: ${others}.\n${lines.join("\n")}${more}`,
    );
  },
});

/**
 * apify_top_reels_from_file - one-shot tool for "top N reels by metric
 * from MY creator list" style queries.
 *
 * The agent should not have to do the dance of:
 *   1) knowledge_query to load the creator-list file,
 *   2) parse out the @handles,
 *   3) call apify_race_scrape with the full handle array,
 *   4) filter window + cap per creator + rank,
 *   5) deliver.
 *
 * It picks the right tool and the tool does the work. Hands the agent
 * back a ranked, window-filtered, creator-diversified text block plus a
 * coverage_brief line so it can declare ranked_by / window / source in
 * its OBSERVATION step exactly like the RANKED-GROUNDING preamble asks.
 */
async function readAgentFileBody(
  ctx: ToolContext,
  fileName: string,
): Promise<{ filename: string; body: string } | { error: string }> {
  const agentId = ctx.agentId;
  if (!agentId) {
    return { error: "agent_id missing on this surface" };
  }
  const db = supabaseAdmin();
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (!agent) return { error: "agent not found in this organization" };

  // Loose filename match - the agent often passes the bare name without
  // extension (e.g. "creator-list" instead of "creator-list-v2.md"). Pick
  // the most recently uploaded file whose name contains the substring.
  const { data: files } = await db
    .from("rgaios_agent_files")
    .select("id, filename, uploaded_at")
    .eq("organization_id", ctx.organizationId)
    .eq("agent_id", agentId)
    .ilike("filename", `%${fileName}%`)
    .order("uploaded_at", { ascending: false })
    .limit(1);
  const file = (files ?? [])[0] as
    | { id: string; filename: string }
    | undefined;
  if (!file) {
    return { error: `no agent file matched "${fileName}"` };
  }
  const { data: chunks } = await db
    .from("rgaios_agent_file_chunks")
    .select("content, chunk_index")
    .eq("file_id", file.id)
    .order("chunk_index", { ascending: true });
  const body = (chunks ?? []).map((c) => c.content).join("\n");
  return { filename: file.filename, body };
}

function extractHandles(input: string): string[] {
  // Match @handle (Instagram allows lowercase, digits, dot, underscore).
  // Also pick up plain instagram.com/<handle> URLs the user may have
  // pasted instead of @handle. Deduped, lower-cased.
  const handles = new Set<string>();
  const atRe = /@([A-Za-z0-9._]{2,30})\b/g;
  const urlRe = /instagram\.com\/([A-Za-z0-9._]{2,30})(?:\/|\b)/g;
  // Bare-handle line pattern: a markdown bullet or empty line prefix,
  // optionally a "- " or "* ", then a handle. Marti's creator-list-v2.md
  // uses bare handles (one per line, no `@` prefix). Without this branch
  // the tool failed in eval 12 with "file found but no @handles".
  // The pattern requires the handle to START a line (after optional
  // bullet + whitespace) and END at whitespace / comma / end-of-line -
  // that's strict enough to avoid catching arbitrary words in prose
  // paragraphs while still picking up plain markdown list items.
  const lineRe =
    /(?:^|\n)\s*(?:[-*]\s+)?([A-Za-z0-9_][A-Za-z0-9._]{1,29})(?=\s|,|$)/g;
  const BARE_BLOCKLIST = new Set([
    "instagram",
    "tiktok",
    "youtube",
    "twitter",
    "facebook",
    "linkedin",
    "creator",
    "creators",
    "list",
    "handles",
    "username",
    "usernames",
    "name",
    "names",
    "v1",
    "v2",
    "v3",
    "todo",
    "done",
    "n/a",
    "na",
    "tba",
    "tbd",
  ]);
  let m: RegExpExecArray | null;
  while ((m = atRe.exec(input)) !== null) handles.add(m[1].toLowerCase());
  while ((m = urlRe.exec(input)) !== null) {
    const h = m[1].toLowerCase();
    if (!["p", "reel", "reels", "explore", "stories", "tv"].includes(h)) {
      handles.add(h);
    }
  }
  while ((m = lineRe.exec(input)) !== null) {
    const h = m[1].toLowerCase();
    // Skip obviously non-handle tokens. Also skip too-short (<3) and
    // tokens that look like headings / sentence words by their position
    // in the file: we already require start-of-line, but heading lines
    // ("# CREATORS") have the leading marker stripped by the regex so
    // we still need the blocklist + length floor.
    if (h.length < 3) continue;
    if (BARE_BLOCKLIST.has(h)) continue;
    handles.add(h);
  }
  return [...handles];
}

registerTool({
  name: "apify_top_reels_from_file",
  description:
    "Top-N Instagram reels by a metric, ranked across every creator " +
    "listed in one of YOUR uploaded knowledge files. The tool reads " +
    "the file, extracts every @handle / instagram.com/<handle> URL " +
    "in it, scrapes all of them in parallel batches, filters by your " +
    "time window, ranks by the metric, caps each creator at 2 reels " +
    "for diversity, and returns the top N with @handle + caption + " +
    "metric + URL per line. Use this whenever the operator says \"my " +
    "creator list\" / \"from my creators\" / \"from the list I uploaded\". " +
    "ONE call, no handle-passing.",
  isWrite: true,
  requiresIntegration: "apify",
  inputSchema: {
    type: "object",
    required: ["file_name"],
    properties: {
      file_name: {
        type: "string",
        description:
          "Substring match against your agent files (e.g. \"creator-list\"). The most recently uploaded match is used.",
      },
      window_days: {
        type: "number",
        description: "How far back to scrape (default 10, max 90).",
      },
      top_n: {
        type: "number",
        description: "How many reels to return after ranking (default 10, max 50).",
      },
      metric: {
        type: "string",
        description:
          "Ranking metric. \"comments\" (default), \"likes\", or \"plays\".",
      },
      results_per_handle: {
        type: "number",
        description:
          "How many recent reels per handle to fetch before ranking (default 20). Lower = faster but may miss high-comment older posts inside the window.",
      },
    },
  },
  handler: async (args, ctx) => {
    const fileNameArg = String(args.file_name ?? "").trim();
    if (!fileNameArg) return textError("file_name is required");

    const windowDays = Math.min(
      Math.max(Number(args.window_days ?? 10) || 10, 1),
      90,
    );
    const topN = Math.min(Math.max(Number(args.top_n ?? 10) || 10, 1), 50);
    const metricArg = String(args.metric ?? "comments").toLowerCase();
    const metricKey =
      metricArg === "likes"
        ? "likesCount"
        : metricArg === "plays" || metricArg === "views"
          ? "playsCount"
          : "commentsCount";
    const resultsPerHandle = Math.min(
      Math.max(Number(args.results_per_handle ?? 20) || 20, 5),
      50,
    );

    const fileRes = await readAgentFileBody(ctx, fileNameArg);
    if ("error" in fileRes) return textError(fileRes.error);
    const handles = extractHandles(fileRes.body);
    if (handles.length === 0) {
      return textError(
        `Found "${fileRes.filename}" but no @handles inside. Body length ${fileRes.body.length}.`,
      );
    }

    const resolved = await resolveApifyKey(ctx.organizationId);
    if ("error" in resolved) return textError(resolved.error);

    // Split into 5-handle batches and scrape in parallel. Each batch
    // runs apify/instagram-scraper which returns the latest N posts
    // per handle. We accept partial - some handles may be private or
    // have no posts in the window.
    const BATCH_SIZE = 5;
    const batches: string[][] = [];
    for (let i = 0; i < handles.length; i += BATCH_SIZE) {
      batches.push(handles.slice(i, i + BATCH_SIZE));
    }
    const actorPath = "apify~instagram-scraper";
    const fetchLimit = batches.flat().length * resultsPerHandle;
    const url =
      `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items` +
      `?limit=${Math.min(fetchLimit, MAX_LIMIT)}`;

    type BatchResult = { items: unknown[]; handles: string[]; error?: string };
    const batchResults: BatchResult[] = await Promise.all(
      batches.map(async (batch): Promise<BatchResult> => {
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${resolved.key}`,
            },
            body: JSON.stringify({
              directUrls: batch.map(
                (h) => `https://www.instagram.com/${h}/`,
              ),
              resultsType: "posts",
              resultsLimit: resultsPerHandle,
              addParentData: false,
            }),
            signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
          });
          if (r.status !== 200 && r.status !== 201) {
            return { items: [], handles: batch, error: `http ${r.status}` };
          }
          const j = await r.json();
          return { items: Array.isArray(j) ? j : [], handles: batch };
        } catch (e) {
          return {
            items: [],
            handles: batch,
            error: (e as Error)?.message ?? "fetch error",
          };
        }
      }),
    );
    const allItems: unknown[] = [];
    for (const br of batchResults) for (const it of br.items) allItems.push(it);

    if (allItems.length === 0) {
      const errs = batchResults
        .map((b) => `${b.handles.join(",")}: ${b.error ?? "0 items"}`)
        .join("; ");
      return textError(`apify_top_reels_from_file: no data - ${errs}`);
    }

    const numOf = (raw: unknown, key: string): number => {
      const o = (raw ?? {}) as Record<string, unknown>;
      // Mirror the field-fallback chain used by every other apify
      // formatter in this file (commentsCount ?? commentCount ?? comments).
      // Singular `commentCount` shows up on some apify/instagram-scraper
      // run shapes; missing it collapses ranking to whichever creator
      // happens to emit the plural variant - same root cause that gave
      // codiesanchez 7/9 in eval 6/7.
      const singularKey =
        key === "commentsCount"
          ? "commentCount"
          : key === "likesCount"
            ? "likeCount"
            : key === "playsCount"
              ? "videoPlayCount"
              : "";
      const v =
        o[key] ??
        (singularKey ? o[singularKey] : undefined) ??
        o[key.replace(/Count$/, "")];
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const handleOf = (raw: unknown): string => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const v =
        (typeof o.ownerUsername === "string" && o.ownerUsername) ||
        (typeof o.username === "string" && o.username) ||
        (typeof o.author === "string" && o.author) ||
        "";
      return String(v).toLowerCase();
    };
    const postTime = (raw: unknown): number => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const t = o.timestamp ?? o.takenAt ?? o.postedAt ?? o.createdAt;
      if (!t) return 0;
      if (typeof t === "number") {
        return t > 1e12 ? t : t * 1000;
      }
      const parsed = Date.parse(String(t));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const inWindow = allItems.filter((it) => {
      const t = postTime(it);
      return t > 0 && t >= cutoff;
    });
    const handlesWithData = new Set(inWindow.map(handleOf).filter(Boolean));

    // Rank by metric desc, cap 2 per creator for diversity.
    const PER_CREATOR_CAP = 2;
    const sortedAll = [...inWindow].sort(
      (a, b) => numOf(b, metricKey) - numOf(a, metricKey),
    );
    const byCreator = new Map<string, number>();
    const picked: unknown[] = [];
    const overflow: unknown[] = [];
    for (const it of sortedAll) {
      const h = handleOf(it);
      const seen = byCreator.get(h) ?? 0;
      if (!h || seen < PER_CREATOR_CAP) {
        picked.push(it);
        if (h) byCreator.set(h, seen + 1);
      } else {
        overflow.push(it);
      }
    }
    const top = [...picked, ...overflow].slice(0, topN);

    const today = new Date();
    const start = new Date(Date.now() - windowMs);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const missing = handles.filter((h) => !handlesWithData.has(h));
    const coverageBrief =
      `ranked_by: ${metricKey}, window: ${fmt(start)} to ${fmt(today)}, ` +
      `source: ${fileRes.filename} via apify/instagram-scraper ` +
      `(${handlesWithData.size}/${handles.length} handles returned posts in window, ` +
      `${inWindow.length} reels in window)`;

    const lines = top.map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const who = handleOf(raw);
      const cap =
        (typeof o.caption === "string" && o.caption) ||
        (typeof o.title === "string" && o.title) ||
        "";
      const m = numOf(raw, metricKey);
      const ts = postTime(raw);
      const dStr = ts > 0 ? new Date(ts).toISOString().slice(0, 10) : "";
      const urlVal =
        (typeof o.url === "string" && o.url) ||
        (typeof o.postUrl === "string" && o.postUrl) ||
        "";
      const head = cap.replace(/\s+/g, " ").slice(0, 100) || "(no caption)";
      return `@${who} - ${m.toLocaleString()} ${metricArg} - "${head}" (${dStr})${
        urlVal ? `\n  ${urlVal}` : ""
      }`;
    });

    const missingNote =
      missing.length > 0
        ? `\n\nNo posts in window for: ${missing.map((h) => `@${h}`).join(", ")}`
        : "";

    return text(
      `${coverageBrief}\n\nTop ${top.length} reels by ${metricArg}:\n${lines.join(
        "\n",
      )}${missingNote}`,
    );
  },
});

/**
 * apify_probe_handle - TEMP DIAGNOSTIC. Operator-only.
 *
 * Single-handle scrape to test "is this handle returning data when
 * isolated?". Built for the marti eval iteration to disambiguate
 * data-ceiling vs code-bug when 5/13 handles came back empty from a
 * multi-handle race scrape.
 *
 * Strict scope:
 *   - registered ONLY when process.env.RAWCLAW_DIAGNOSTICS === "1"
 *   - NOT in MCP_DIRECT_TOOLS allowlist (agent cannot call from chat)
 *   - one fetch, resultsLimit 3, returns counts + first-item shape
 */
if (process.env.RAWCLAW_DIAGNOSTICS === "1") {
  registerTool({
    name: "apify_probe_handle",
    description:
      "DIAGNOSTIC: one apify/instagram-scraper run for a single handle. Returns item count + first-item field names. Operator-only.",
    isWrite: true,
    requiresIntegration: "apify",
    inputSchema: {
      type: "object",
      required: ["handle"],
      properties: {
        handle: {
          type: "string",
          description: "Bare instagram handle (no @), e.g. 'martifox.official'.",
        },
      },
    },
    handler: async (args, ctx) => {
      const handle = String(args.handle ?? "").trim().replace(/^@/, "");
      if (!handle) return textError("handle is required");
      const resolved = await resolveApifyKey(ctx.organizationId);
      if ("error" in resolved) return textError(resolved.error);
      const url =
        "https://api.apify.com/v2/acts/apify~instagram-scraper" +
        "/run-sync-get-dataset-items?limit=3";
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${resolved.key}`,
          },
          body: JSON.stringify({
            directUrls: [`https://www.instagram.com/${handle}/`],
            resultsType: "posts",
            resultsLimit: 3,
            addParentData: false,
          }),
          signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
        });
        const apifyStatus = r.status;
        if (apifyStatus !== 200 && apifyStatus !== 201) {
          const body = await readBodySafe(r);
          return textError(
            `probe @${handle}: http ${apifyStatus} ${body.slice(0, MAX_BODY)}`,
          );
        }
        const j = await r.json();
        const items: unknown[] = Array.isArray(j) ? j : [];
        const itemCount = items.length;
        const first = (items[0] ?? null) as Record<string, unknown> | null;
        const shape = first ? Object.keys(first).slice(0, 30) : [];
        const firstPreview = first
          ? JSON.stringify(first, null, 2).slice(0, 400)
          : "(no items)";
        return text(
          `probe @${handle}: apifyStatus=${apifyStatus} itemCount=${itemCount} shape=[${shape.join(
            ", ",
          )}]\nfirstItem(400c):\n${firstPreview}`,
        );
      } catch (e) {
        const msg = (e as Error)?.message ?? "fetch error";
        return textError(`probe @${handle}: ${msg}`);
      }
    },
  });
}
