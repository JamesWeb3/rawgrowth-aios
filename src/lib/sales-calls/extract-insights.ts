import { chatComplete } from "@/lib/llm/provider";

/**
 * Post-transcribe LLM step. Reads a sales-call transcript, returns a
 * structured insight bundle the dashboard renders as cards.
 *
 * Contract:
 *   - Single chatComplete call (no agentic loop, no tools).
 *   - Provider resolves via the global LLM_PROVIDER env (same selection
 *     logic every other call site uses).
 *   - maxTokens 1500 (capped via the system prompt itself  -  the
 *     provider abstraction doesn't expose a max_tokens knob, so we
 *     instruct the model to stay terse and JSON-only).
 *   - Always returns a SalesCallInsights shape, even on parse failure;
 *     `_error` carries the reason so the upload route can persist a
 *     row that says "extraction failed" instead of crashing.
 *
 * Cache: the caller checks `rgaios_sales_calls.analyzed_at` before
 * invoking. We don't re-run if already analyzed.
 */

export type SalesCallInsights = {
  objections: string[];
  painPoints: string[];
  buyingSignals: string[];
  stuckPoints: string[];
  productFitGaps: string[];
  suggestedActions: string[];
  /** Set when JSON parsing or the LLM call failed. */
  _error?: string;
};

const SYSTEM_PROMPT = `You are a sales-call analyst. You read raw call transcripts and return a STRICT JSON object - no prose, no fences, no markdown - matching exactly this TypeScript type:

{
  "objections": string[],        // Top 3 objections raised by the prospect. Verbatim quotes when possible.
  "painPoints": string[],        // Top 3 business / personal pain points the prospect mentioned.
  "buyingSignals": string[],     // Positive intent markers (questions about pricing, "when can we start", asks for references, etc.).
  "stuckPoints": string[],       // Moments where the rep struggled, fumbled, or failed to advance the deal.
  "productFitGaps": string[],    // Things the prospect asked for that the rep could not commit to.
  "suggestedActions": string[]   // Concrete owner-able follow-ups (e.g. "Send case study X to prospect by Friday").
}

Rules:
- Output ONE valid JSON object. NO leading/trailing text. NO code fences.
- Each array max 5 items, each item max 200 chars.
- If a category has nothing, return [].
- Stay under 1500 output tokens; be terse.
- Do NOT include em-dashes; use " - " or a period.`;

const EMPTY: SalesCallInsights = {
  objections: [],
  painPoints: [],
  buyingSignals: [],
  stuckPoints: [],
  productFitGaps: [],
  suggestedActions: [],
};

const MAX_ITEMS = 5;
const MAX_ITEM_CHARS = 200;
const MAX_TRANSCRIPT_CHARS = 60_000;

/**
 * Internal: parse a raw model reply string into the canonical insight
 * shape. Exported for unit testing - the real entry point is
 * `extractInsights`, which adds the chatComplete + transcript-truncation
 * wrapper around this.
 */
export function parseInsightReply(raw: string): SalesCallInsights {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ...EMPTY, _error: "empty model reply" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(isolateJson(trimmed));
  } catch (err) {
    const message = err instanceof Error ? err.message : "parse failed";
    return { ...EMPTY, _error: `json parse: ${message}` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...EMPTY, _error: "model did not return an object" };
  }

  const obj = parsed as Record<string, unknown>;
  return {
    objections: clampList(obj.objections),
    painPoints: clampList(obj.painPoints),
    buyingSignals: clampList(obj.buyingSignals),
    stuckPoints: clampList(obj.stuckPoints),
    productFitGaps: clampList(obj.productFitGaps),
    suggestedActions: clampList(obj.suggestedActions),
  };
}

function clampList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    out.push(trimmed.slice(0, MAX_ITEM_CHARS));
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/**
 * Strips the most common LLM "wrap" patterns (markdown fences,
 * `Here is the JSON:` preambles) and returns the inner JSON string.
 * If we can't isolate an object, returns the input unchanged so
 * JSON.parse surfaces a clear error.
 */
function isolateJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw;
}

export async function extractInsights(
  transcript: string,
): Promise<SalesCallInsights> {
  const text = (transcript ?? "").trim();
  if (!text) return { ...EMPTY, _error: "empty transcript" };

  // Hard ceiling so a freak 3-hour call doesn't blow past the model
  // context. We keep the front + tail since openings and closes carry
  // the most signal; the middle is summarized away.
  const truncated =
    text.length <= MAX_TRANSCRIPT_CHARS
      ? text
      : `${text.slice(0, MAX_TRANSCRIPT_CHARS / 2)}\n\n[... truncated ...]\n\n${text.slice(-MAX_TRANSCRIPT_CHARS / 2)}`;

  let raw = "";
  try {
    const res = await chatComplete({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Transcript:\n\n${truncated}\n\nReturn the JSON object now.`,
        },
      ],
      temperature: 0.2,
    });
    raw = res.text.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : "chat failed";
    return { ...EMPTY, _error: message };
  }

  return parseInsightReply(raw);
}
