import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";

/**
 * Image description via Claude's vision capability over the OAuth path.
 *
 * The simpler integration is: instead of teaching chatReply to accept
 * mixed text + image content blocks (which would mean refactoring the
 * persona preamble injection, history formatting, and handoff sentinel
 * detection), we make ONE focused Anthropic call here that turns the
 * image into a paragraph of text. The webhook then prepends that text
 * to the user's caption (or just sends it standalone) before invoking
 * chatReply normally.
 *
 * Two LLM hops per image — but the second hop reuses everything chatReply
 * already does (persona, voice rules, handoff). Keeps the diff small.
 *
 * OAuth token refresh: piggybacks on loadClaudeMaxAccessToken so the
 * token never expires during normal operation.
 */

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 400;
const CLAUDE_CODE_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";

async function loadClaudeMaxToken(
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("metadata")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "claude-max")
    .maybeSingle();
  if (!data) return null;
  const meta = (data.metadata ?? {}) as { access_token?: string };
  return tryDecryptSecret(meta.access_token);
}

export type DescribeResult =
  | { ok: true; description: string }
  | { ok: false; error: string };

export async function describeImage(input: {
  organizationId: string;
  bytes: Uint8Array;
  mimeType: string;
  /**
   * Optional context — typically the user's Telegram caption — to give
   * the model a hint about what's relevant. Without it the description
   * is generic (every detail), with it we get focused output.
   */
  hint?: string;
}): Promise<DescribeResult> {
  const token = await loadClaudeMaxToken(input.organizationId);
  if (!token) {
    return { ok: false, error: "Claude Max not connected" };
  }

  // Anthropic's image content block expects base64-encoded data + mime.
  const base64 = Buffer.from(input.bytes).toString("base64");
  const supported = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const media = supported.includes(input.mimeType)
    ? input.mimeType
    : "image/jpeg"; // Telegram delivers JPEG by default

  const userText = input.hint
    ? `Describe this image so an assistant can act on it. Caption from sender: ${JSON.stringify(input.hint)}. Focus on: what's in the image, any visible text/numbers, any decisions implied. Plain prose, 1-3 sentences max.`
    : "Describe this image so an assistant can act on it. Plain prose, 1-3 sentences max. Note any visible text, numbers, or decisions implied.";

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: CLAUDE_CODE_PREFIX,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: media, data: base64 },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { ok: false, error: `vision network: ${(err as Error).message}` };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `vision ${res.status}: ${text.slice(0, 300)}` };
  }
  try {
    const parsed = JSON.parse(text) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const out = (parsed.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!.trim())
      .join("\n\n")
      .trim();
    if (!out) {
      return { ok: false, error: "vision returned no text" };
    }
    return { ok: true, description: out };
  } catch {
    return { ok: false, error: `vision non-JSON: ${text.slice(0, 200)}` };
  }
}
