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
const RUN_TIMEOUT_MS = 120_000;
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

registerTool({
  name: "apify_run_actor",
  description:
    "Run an Apify actor synchronously and get its dataset items. Use for scraping tasks (Instagram Reels Scraper, etc.).",
  isWrite: true,
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

    const resolved = await resolveApifyKey(ctx.organizationId);
    if ("error" in resolved) return textError(resolved.error);

    const url =
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items` +
      `?token=${encodeURIComponent(resolved.key)}&limit=${limit}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runInput),
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      });
    } catch (err) {
      return textError(`apify_run_actor: ${(err as Error).message}`);
    }

    if (res.status !== 200 && res.status !== 201) {
      let respBody = "";
      try {
        respBody = await res.text();
      } catch {
        respBody = "(no body)";
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

    const items = Array.isArray(parsed) ? parsed.slice(0, limit) : [];
    const preview = items
      .slice(0, 5)
      .map((it, i) => `[${i}] ${JSON.stringify(it).slice(0, 300)}`)
      .join("\n");

    return text(
      `Actor ${actorId} returned ${items.length} item(s).\n${preview}`,
    );
  },
});

registerTool({
  name: "apify_list_actor_runs",
  description:
    "List recent runs of an Apify actor to check status/results.",
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

    const url =
      `https://api.apify.com/v2/acts/${actorId}/runs` +
      `?token=${encodeURIComponent(resolved.key)}&limit=${limit}&desc=true`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      });
    } catch (err) {
      return textError(`apify_list_actor_runs: ${(err as Error).message}`);
    }

    if (res.status !== 200) {
      let respBody = "";
      try {
        respBody = await res.text();
      } catch {
        respBody = "(no body)";
      }
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
