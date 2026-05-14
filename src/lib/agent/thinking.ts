/**
 * Reasoning-trace extraction.
 *
 * Agents are instructed by the REASONING PROTOCOL block in preamble.ts to
 * open every reply with a <thinking>...</thinking> block - the ReAct
 * "Thought" step: the same model that writes the answer first states its
 * real plan for the turn (what the operator wants, delegate-or-answer, why).
 *
 * This module pulls that block back out so the surfaces can:
 *   - strip it from the operator-visible reply (it must never render raw),
 *   - surface it as a separate "thinking" trace line (dashboard SSE event /
 *     Telegram italic prefix / rgaios_audit_log row for /trace).
 *
 * It is the response-side equivalent of the old pre-reply Haiku guess in
 * the chat route, except it is the agent's ACTUAL reasoning rather than a
 * separate model guessing at intent.
 */

import { supabaseAdmin } from "@/lib/supabase/server";

const THINKING_RE = /<thinking>\s*([\s\S]*?)\s*<\/thinking>/i;

export type ExtractedThinking = {
  /** The reasoning text, trimmed + collapsed, or null if no block found. */
  thinking: string | null;
  /** The reply with the <thinking> block removed and edges trimmed. */
  visibleReply: string;
};

/**
 * Pull the first <thinking> block out of a model reply.
 *
 * - Only the FIRST block is treated as the reasoning trace; any further
 *   blocks are still stripped from the visible reply so stray XML never
 *   leaks, but they are not surfaced.
 * - Newlines inside the block collapse to single spaces - the trace
 *   renders as one line in chat / Telegram / audit.
 * - Caps the surfaced text at 600 chars so a runaway block can't blow up
 *   an audit row or a Telegram message.
 */
export function extractThinking(reply: string): ExtractedThinking {
  if (!reply) return { thinking: null, visibleReply: reply ?? "" };

  const m = reply.match(THINKING_RE);
  if (!m) {
    // Truncation case: the model is told to OPEN every reply with a
    // <thinking> block. If max_tokens cut the reply before the closing
    // </thinking>, THINKING_RE (which needs the close tag) does not
    // match - and the raw `<thinking>` open tag + reasoning would leak
    // into the operator-visible reply. Detect a lone open tag with no
    // close: everything after it is the (truncated) thinking, whatever
    // preceded it is the visible reply.
    const openOnly = reply.match(/<thinking>/i);
    if (openOnly && !/<\/thinking>/i.test(reply)) {
      const idx = openOnly.index ?? 0;
      const raw = reply
        .slice(idx + openOnly[0].length)
        .replace(/\s*\n\s*/g, " ")
        .trim();
      return {
        thinking: raw ? raw.slice(0, 600) : null,
        visibleReply: reply.slice(0, idx).trim(),
      };
    }
    // No thinking markup at all - but still strip any stray lone tag.
    return {
      thinking: null,
      visibleReply: reply.replace(/<\/?thinking>/gi, "").trim(),
    };
  }

  const raw = (m[1] ?? "").replace(/\s*\n\s*/g, " ").trim();
  const thinking = raw ? raw.slice(0, 600) : null;

  // Strip ALL <thinking> blocks (the matched one + any extras) PLUS any
  // stray unpaired <thinking>/</thinking> tag so no raw XML survives
  // into the visible reply.
  const visibleReply = reply
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();

  return { thinking, visibleReply };
}

/**
 * Telegram-surface variant. Pulls the <thinking> block, persists it to
 * rgaios_audit_log (kind chat_thinking) so the /trace timeline shows the
 * Telegram-side reasoning the same way the dashboard chat does, and
 * returns the operator-visible text with a one-line "💭 ..." reasoning
 * prefix. Plain text - no markdown parse_mode dependency.
 *
 * Best-effort: a failed audit insert never blocks the reply, and a reply
 * with no <thinking> block is returned untouched.
 */
export async function surfaceThinkingTelegram(opts: {
  reply: string;
  organizationId: string;
  agentId: string | null;
  messagePreview?: string;
}): Promise<string> {
  const { thinking, visibleReply } = extractThinking(opts.reply);
  if (!thinking) return visibleReply;

  try {
    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: opts.organizationId,
        kind: "chat_thinking",
        actor_type: "agent",
        actor_id: opts.agentId,
        detail: {
          brief: thinking,
          source: "agent",
          surface: "telegram",
          message_preview: (opts.messagePreview ?? "").slice(0, 100),
        },
      } as never);
  } catch {
    // Best-effort - never block the Telegram reply on the trace row.
  }

  return `💭 ${thinking}\n\n${visibleReply}`;
}
