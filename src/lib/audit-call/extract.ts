import { chatCompleteOAuthFirst } from "@/lib/llm/oauth-first";
import { BANNED_WORDS } from "@/lib/brand/tokens";

/**
 * Audit-call paste flow (Plan §12, Chris brief). Reads a raw discovery /
 * audit-call transcript and returns a structured plan the dashboard
 * renders as cards: a one-paragraph company summary, the top pain
 * points, the operating gaps, and a list of suggested agents to hire.
 *
 * Why a separate module from sales-calls/extract-insights:
 *   - Different output shape (agents to hire, not deal signals).
 *   - Different downstream wiring (pre-creates rgaios_agents draft rows
 *     so the operator can review + promote, vs. surfacing per-call cards).
 *   - Different prompt: discovery framing (what does this company DO,
 *     where is it stuck, who would unblock it), not sales-cycle framing.
 *
 * Contract mirrors extract-insights:
 *   - One chatComplete step, no tool loop.
 *   - Always returns a shape, even on parse failure (`_error` set).
 *   - Provider goes through chatCompleteOAuthFirst, which prefers the
 *     org's Claude Max OAuth token (rgaios_connections, set via
 *     /connections) over any API key in the environment. API keys are
 *     a fallback only.
 */

export type SuggestedAgent = {
  role: string;
  why: string;
  starterFiles: string[];
};

export type AuditCallExtraction = {
  companySummary: string;
  painPoints: string[];
  gaps: string[];
  suggestedAgents: SuggestedAgent[];
  /** Set when JSON parsing or the LLM call failed. */
  _error?: string;
};

// Built once at module load. We pull from BANNED_WORDS so a future edit
// to brand/tokens.ts also lands in the LLM prompt without us forgetting.
// Inlining the literals would also trip the eslint banned-words rule.
const BANNED_LIST_FOR_PROMPT = BANNED_WORDS.join(", ");

const SYSTEM_PROMPT = `You are a discovery-call analyst for an agentic ops studio. You read raw call transcripts where the operator interviews a business owner about what their company does, what hurts, and where the gaps are. You return STRICT JSON - no prose, no fences, no markdown - matching exactly this TypeScript type:

{
  "companySummary": string,                                                       // ONE paragraph (max 600 chars). What the company does, who it serves, the model.
  "painPoints": string[],                                                         // Top 3-5 concrete pains the owner named. Verbatim phrasing when possible.
  "gaps": string[],                                                               // Operating gaps the owner has not solved (people, process, data, channel coverage).
  "suggestedAgents": Array<{ "role": string, "why": string, "starterFiles": string[] }>  // Agent roles that would close the named gaps.
}

Rules:
- Output ONE valid JSON object. NO leading/trailing text. NO code fences.
- companySummary is a single paragraph. No bullet lists inside it.
- painPoints / gaps: max 5 items each, each item max 200 chars.
- suggestedAgents: max 6 entries. role is a short title (e.g. "Copywriter", "SDR", "Media Buyer"). why is one sentence (max 240 chars) tying the role to a specific pain or gap. starterFiles is a list of 0-3 short markdown filenames (e.g. ["aida-framework.md"]) that would seed the role; empty array is fine.
- Stay under 1500 output tokens.
- Do NOT include em-dashes; use " - " or a period.
- Do NOT use any of these banned brand-voice words: ${BANNED_LIST_FOR_PROMPT}.`;

const EMPTY: AuditCallExtraction = {
  companySummary: "",
  painPoints: [],
  gaps: [],
  suggestedAgents: [],
};

const MAX_LIST_ITEMS = 5;
const MAX_AGENT_ITEMS = 6;
const MAX_ITEM_CHARS = 200;
const MAX_AGENT_WHY_CHARS = 240;
const MAX_SUMMARY_CHARS = 600;
const MAX_STARTER_FILES = 3;
const MAX_TRANSCRIPT_CHARS = 60_000;

/**
 * Internal: parse the raw model reply string into the canonical shape.
 * Exported for unit testing - the runtime entry point is `extractAuditCall`.
 */
export function parseAuditCallReply(raw: string): AuditCallExtraction {
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
  const companySummary =
    typeof obj.companySummary === "string"
      ? obj.companySummary.trim().slice(0, MAX_SUMMARY_CHARS)
      : "";

  return {
    companySummary,
    painPoints: clampList(obj.painPoints),
    gaps: clampList(obj.gaps),
    suggestedAgents: clampAgents(obj.suggestedAgents),
  };
}

function clampList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    out.push(t.slice(0, MAX_ITEM_CHARS));
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

function clampAgents(value: unknown): SuggestedAgent[] {
  if (!Array.isArray(value)) return [];
  const out: SuggestedAgent[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const obj = v as Record<string, unknown>;
    const role = typeof obj.role === "string" ? obj.role.trim() : "";
    if (!role) continue;
    const why = typeof obj.why === "string" ? obj.why.trim() : "";
    const filesRaw = Array.isArray(obj.starterFiles) ? obj.starterFiles : [];
    const starterFiles: string[] = [];
    for (const f of filesRaw) {
      if (typeof f !== "string") continue;
      const t = f.trim();
      if (!t) continue;
      starterFiles.push(t.slice(0, 120));
      if (starterFiles.length >= MAX_STARTER_FILES) break;
    }
    out.push({
      role: role.slice(0, 80),
      why: why.slice(0, MAX_AGENT_WHY_CHARS),
      starterFiles,
    });
    if (out.length >= MAX_AGENT_ITEMS) break;
  }
  return out;
}

/**
 * Strip the most common LLM "wrap" patterns (markdown fences, "Here is
 * the JSON:" preambles) and return the inner JSON string. If we can't
 * isolate an object, return the input unchanged so JSON.parse surfaces
 * a clear error message.
 */
function isolateJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw;
}

/**
 * Real entry point. Truncates the transcript to keep us under the
 * model context, fires one chatComplete, and parses the reply. Errors
 * surface in `_error` so the route can persist a "failed" audit row
 * rather than throw.
 */
export async function extractAuditCall(
  organizationId: string,
  transcript: string,
): Promise<AuditCallExtraction> {
  const text = (transcript ?? "").trim();
  if (!text) return { ...EMPTY, _error: "empty transcript" };

  // Hard ceiling matches sales-calls extractor: keep front + tail since
  // openings (what the company does) and closes (asks, next steps) carry
  // the most signal; the middle is summarized away.
  const truncated =
    text.length <= MAX_TRANSCRIPT_CHARS
      ? text
      : `${text.slice(0, MAX_TRANSCRIPT_CHARS / 2)}\n\n[... truncated ...]\n\n${text.slice(-MAX_TRANSCRIPT_CHARS / 2)}`;

  let raw = "";
  try {
    const res = await chatCompleteOAuthFirst(organizationId, {
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

  return parseAuditCallReply(raw);
}
