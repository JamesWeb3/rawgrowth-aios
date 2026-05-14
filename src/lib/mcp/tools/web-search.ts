import { registerTool, text, textError } from "../registry";

/**
 * Web search MCP tool. Agents had no way to reach the open web - every
 * other tool reads internal corpora, Composio apps, or scrape actors.
 * This wires a first-class `web_search` so an agent can pull live facts
 * (news, docs, prices) into a turn.
 *
 * Provider note: Tavily is the default backend - a clean JSON search
 * API, one POST to https://api.tavily.com/search, results[] with
 * title/url/content. It is an opt-in provider behind WEB_SEARCH_API_KEY
 * exactly like the embedder's openai/voyage backends: when the key is
 * unset the tool returns a textError hint instead of throwing, so an
 * un-configured VPS degrades cleanly. The provider call is isolated in
 * one function (runTavily) so a second backend can be slotted in later
 * without touching the handler.
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
// run-sync HTTP call inside a chat turn - keep it well under the
// telegram webhook / dashboard chat budget.
const SEARCH_TIMEOUT_MS = 15_000;
// How many results we ask Tavily for vs how many we render. Pull a
// small generous window, render the top few.
const FETCH_RESULTS = 8;
const RENDER_RESULTS = 5;
// Defensive caps so a runaway provider response can't blow up the
// agent's context window.
const MAX_SNIPPET = 400;
const MAX_OUTPUT = 4_000;
const MAX_BODY = 500;

// Tavily accepts a search_depth ("basic" | "advanced") and a
// time-window via `days`. `recency` is freeform on our side; map the
// common buckets to a day count and ignore anything we don't know
// rather than rejecting the call.
const RECENCY_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

function recencyToDays(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (key in RECENCY_DAYS) return RECENCY_DAYS[key];
  // Freeform numeric like "14" or "30d" - take the leading integer.
  const n = parseInt(key, 10);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 365);
  return undefined;
}

type ProviderResult = {
  title: string;
  url: string;
  snippet: string;
};

async function readBodySafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "(no body)";
  }
}

/**
 * Tavily backend. Returns either a list of normalized results or an
 * error string - never throws. A second provider would implement the
 * same shape and the handler would pick between them.
 */
async function runTavily(
  apiKey: string,
  query: string,
  days: number | undefined,
): Promise<{ results: ProviderResult[] } | { error: string }> {
  const body: Record<string, unknown> = {
    query,
    search_depth: "basic",
    max_results: FETCH_RESULTS,
  };
  if (days !== undefined) body.days = days;

  let res: Response;
  try {
    res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Tavily takes the key as a Bearer token; it also accepts an
        // api_key body field, but the header form keeps the key out of
        // any logged request body.
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      return {
        error: `web_search: Tavily did not respond within ${Math.round(
          SEARCH_TIMEOUT_MS / 1000,
        )}s - try again or narrow the query.`,
      };
    }
    return { error: `web_search: network error - ${e.message}` };
  }

  if (res.status !== 200) {
    const respBody = await readBodySafe(res);
    return {
      error: `web_search: Tavily ${res.status} ${respBody.slice(0, MAX_BODY)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    return { error: `web_search: bad JSON from Tavily - ${(err as Error).message}` };
  }

  const rawResults =
    parsed && typeof parsed === "object" && "results" in parsed
      ? (parsed as { results?: unknown[] }).results
      : undefined;
  const list = Array.isArray(rawResults) ? rawResults : [];

  const s = (v: unknown): string =>
    typeof v === "string" ? v : v == null ? "" : String(v);

  const results: ProviderResult[] = list
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      return {
        title: s(o.title).replace(/\s+/g, " ").trim(),
        url: s(o.url).trim(),
        snippet: s(o.content).replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET),
      };
    })
    .filter((r) => r.url);

  return { results };
}

registerTool({
  name: "web_search",
  description:
    "Search the open web for live facts (news, docs, prices). Required: query. Optional: recency (\"day\"/\"week\"/\"month\"/\"year\" or a day count) to bias toward recent results. Returns the top results with title, url, and a snippet.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query.",
      },
      recency: {
        type: "string",
        description:
          "Optional time bias: \"day\", \"week\", \"month\", \"year\", or a number of days. Ignored if not recognized.",
      },
    },
    required: ["query"],
  },
  handler: async (args) => {
    const query = String(args.query ?? "").trim();
    if (!query) return textError("query is required");

    // Opt-in provider behind one env key, same shape as the embedder's
    // openai/voyage backends: no key set means the feature is simply
    // not configured on this VPS - return a clear hint, do not throw.
    const apiKey = (process.env.WEB_SEARCH_API_KEY ?? "").trim();
    if (!apiKey) {
      return textError(
        "web_search is not configured - set WEB_SEARCH_API_KEY to enable it.",
      );
    }

    const days = recencyToDays(args.recency);

    const outcome = await runTavily(apiKey, query, days);
    if ("error" in outcome) return textError(outcome.error);

    const { results } = outcome;
    if (results.length === 0) {
      return text(`web_search: no results for "${query}".`);
    }

    const blocks = results.slice(0, RENDER_RESULTS).map((r, i) => {
      const title = r.title || "(untitled)";
      const snippet = r.snippet ? `\n  ${r.snippet}` : "";
      return `${i + 1}. ${title}\n  ${r.url}${snippet}`;
    });

    // Cap total output defensively so an oversized provider payload
    // can't flood the agent context. Trim on a line boundary when we
    // can so the tail block stays readable.
    let body = `web_search results for "${query}":\n\n${blocks.join("\n\n")}`;
    if (body.length > MAX_OUTPUT) {
      body = body.slice(0, MAX_OUTPUT);
      const lastBreak = body.lastIndexOf("\n");
      if (lastBreak > MAX_OUTPUT * 0.6) body = body.slice(0, lastBreak);
      body += "\n…(truncated)";
    }

    return text(body);
  },
});

export const WEB_SEARCH_TOOL_REGISTERED = true;
