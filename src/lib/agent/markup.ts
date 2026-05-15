/**
 * Orchestration-markup strip helpers shared by the executor, the
 * dashboard chat path, the thinking-extraction surface, and the
 * chat-task mirror.
 *
 * Moved out of `@/lib/runs/executor` (where it originally lived) to
 * break the import cycle `executor.ts` ↔ `thinking.ts` and to give
 * the bare-JSON scanner a single source of truth - the same shape
 * detection appeared inline in agent-commands.ts and was diverging
 * (different `args` predicates, different fence handling).
 *
 * The strip is COSMETIC. None of these helpers execute a command,
 * persist a routine, or fire a delegated run; they only remove the
 * raw markup so it doesn't leak into operator-visible text.
 */

/**
 * Tags an agent's reply can carry. The dashboard chat route parses
 * and acts on these; the executor + chat mirror must NOT act on
 * them (a delegated run is not a command surface) so the strip is
 * the only thing those surfaces do.
 */
export const ORCHESTRATION_TAGS = [
  "command",
  "need",
  "task",
  "shared_memory",
  "agent",
] as const;

/**
 * Walk forward from `start` (which must point at an opening `{`)
 * counting brace depth - respecting strings + escapes - until the
 * matching close brace. Returns the exclusive end index, or null
 * if no matching close is found (truncated / malformed input).
 *
 * Shared with extractBareJsonCommands in agent-commands.ts so both
 * the extractor and the stripper agree on object boundaries.
 */
export function scanBalancedObject(
  src: string,
  start: number,
): { end: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return { end: i + 1 };
    }
  }
  return null;
}

export type BareJsonShape = "tool_call" | "agent_invoke" | "routine_create";

/**
 * Classify a parsed JSON object against the three command shapes
 * the agent surfaces recognise. Returns the shape or null when it
 * is plain data (e.g. an Apify result payload).
 *
 * Single source of truth - the extractor (which DISPATCHES the
 * command) and the stripper (which only REMOVES it) must agree on
 * what counts as a command, otherwise one of them silently lets a
 * shape leak through.
 */
export function classifyBareJsonObject(
  parsed: unknown,
): BareJsonShape | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.tool === "string" &&
    obj.tool.trim() !== "" &&
    obj.args !== undefined &&
    obj.args !== null &&
    typeof obj.args === "object" &&
    !Array.isArray(obj.args)
  ) {
    return "tool_call";
  }
  if (typeof obj.agent === "string" && typeof obj.task === "string") {
    return "agent_invoke";
  }
  if (
    typeof obj.title === "string" &&
    typeof obj.description === "string" &&
    typeof obj.assignee === "string"
  ) {
    return "routine_create";
  }
  return null;
}

/**
 * Strip ```json fence tokens that may wrap a bare JSON span. Used
 * before JSON.parse so a fenced object still classifies.
 */
export function stripJsonFence(span: string): string {
  return span
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

/**
 * Remove bare-JSON command shapes (tool_call / agent_invoke /
 * routine_create) the model dumped into the visible text. Also
 * swallows an adjacent ```json``` fence wrapping the span so the
 * fence tokens don't survive alone.
 *
 * Cosmetic-only: the command's intent is intentionally lost, never
 * dispatched. extractAndExecuteCommands (the dispatch surface) runs
 * a separate scan that uses the SAME classifyBareJsonObject.
 */
export function stripBareJsonCommands(text: string): string {
  // Fast-bail: no `{` -> nothing to scan. Saves a per-turn balanced
  // scan on every clean prose reply.
  if (!text.includes("{")) return text;

  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) break;
    const match = scanBalancedObject(text, open);
    if (!match) break;
    const span = text.slice(open, match.end);
    cursor = match.end;
    const stripped = stripJsonFence(span);
    // Cheap prefilter before JSON.parse - if no command-shape key
    // is anywhere in the span, skip the parse. Big result payloads
    // (apify hits, gmail bodies) trigger the scan but never parse.
    if (!/"tool"\s*:|"agent"\s*:|"title"\s*:/.test(stripped)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      continue;
    }
    if (!classifyBareJsonObject(parsed)) continue;
    // Widen the range to swallow a wrapping ```json fence if one is
    // adjacent - stray fence tokens look like leaked markup.
    let start = open;
    let end = match.end;
    const fenceOpen = text
      .slice(Math.max(0, open - 12), open)
      .match(/```(?:json)?\s*\n?$/);
    if (fenceOpen) start -= fenceOpen[0].length;
    const fenceClose = text.slice(end, end + 4).match(/^\n?```/);
    if (fenceClose) end += fenceClose[0].length;
    ranges.push({ start, end });
  }
  if (ranges.length === 0) return text;
  let out = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    out = out.slice(0, ranges[i].start) + out.slice(ranges[i].end);
  }
  return out;
}

/**
 * Strip every paired orchestration tag block + any stray unpaired
 * open/close tag + every bare-JSON command shape from the input.
 * The visible result is trimmed.
 */
export function stripOrchestrationMarkup(text: string): string {
  let out = text;
  for (const tag of ORCHESTRATION_TAGS) {
    out = out.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"),
      "",
    );
    out = out.replace(new RegExp(`</?${tag}\\b[^>]*>`, "gi"), "");
  }
  out = stripBareJsonCommands(out);
  return out.trim();
}
