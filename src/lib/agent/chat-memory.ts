/**
 * chat_memory fact extraction.
 *
 * Each chat turn writes one short "fact" row to rgaios_audit_log
 * (kind=chat_memory); the next-turn preamble fetches the last N and
 * injects them as "things you remember". The historical heuristic
 * built that fact from a template (`User asked: "X". I responded
 * with: "Y".` with a 200-char first-sentence slice). For any tool-
 * result reply the slice dropped the numbers, so the preamble re-
 * injected number-stripped lines as ground truth and the next turn
 * filled the gaps from nowhere - the dominant source of cross-turn
 * metric hallucination on the Marti canonical-prompt walks.
 *
 * extractChatMemoryFact replaces that path:
 *   - Calls Haiku to distil ONE concrete fact, with numbers / names /
 *     handles VERBATIM, in a single sentence under 300 chars.
 *   - Returns null on filler turns (Haiku replies NONE), on Haiku
 *     errors, and when ANTHROPIC_API_KEY is absent. Null means SKIP
 *     THE WRITE - the preamble fetcher silently tolerates an empty
 *     set, and a hollow fact is worse than no fact because the next
 *     turn treats it as authoritative.
 *
 * Cost: ~$0.0001/turn at Haiku rates. Latency budget: 6s abort cap,
 * but the call runs after the chat reply has already streamed to the
 * client so it adds zero user-visible delay.
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

/**
 * Pure post-processor for the Haiku reply. Split out from
 * extractChatMemoryFact so the LLM call is the only side effect and
 * unit tests can cover the parsing rules without mocking generateText.
 *
 * Rules:
 *   - Trim, drop a leading/trailing matched quote, cap at 300 chars.
 *   - "NONE" (with optional trailing . or !) means "Haiku saw no
 *     actionable fact in this turn" - return null so the caller skips
 *     the write.
 *   - Empty post-trim string returns null for the same reason.
 *   - Otherwise return the cleaned string.
 */
export function interpretFactReply(raw: string): string | null {
  if (!raw) return null;
  const fact = raw.trim().replace(/^["']|["']$/g, "").slice(0, 300);
  if (!fact || /^NONE[.!]?$/i.test(fact)) return null;
  return fact;
}

export async function extractChatMemoryFact(
  userMessage: string,
  assistantReply: string,
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!userMessage || !assistantReply) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const result = await generateText({
      model: anthropic("claude-haiku-4-5"),
      system:
        "You distil ONE concrete fact learned during a single turn of a user/agent conversation. Reply with one sentence under 200 characters. Include numbers, names, dates, handles VERBATIM from the inputs - never paraphrase them. If nothing actionable was decided or learned (greeting, ack, filler, a generic answer with no specifics), reply with the single word NONE.",
      prompt: `USER: ${userMessage.slice(0, 600)}\n\nAGENT REPLY: ${assistantReply.slice(0, 1200)}`,
      abortSignal: ctrl.signal,
    });
    clearTimeout(timer);
    return interpretFactReply(result.text);
  } catch {
    return null;
  }
}
