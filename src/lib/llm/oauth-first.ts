import { getConnection } from "@/lib/connections/queries";
import { tryDecryptSecret } from "@/lib/crypto";
import {
  chatComplete,
  type ChatRequest,
  type ChatResponse,
} from "@/lib/llm/provider";

/**
 * OAuth-first LLM dispatcher. Pedro's rule: API keys are secondary.
 * Order:
 *   1. Claude Max OAuth — read encrypted access_token from
 *      rgaios_connections (provider_config_key='claude-max'). Sign in
 *      at /connections, no env vars to manage.
 *   2. ANTHROPIC_API_KEY — fallback for non-interactive paths (cron,
 *      drain server, CI). Operator-set.
 *   3. OPENAI_API_KEY — final fallback.
 *
 * If no path is wired, throws a 503-shaped error so callers can
 * surface a clear "Connect Claude Max at /connections" toast instead
 * of a generic 5xx.
 */

export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      "No LLM provider configured. Connect Claude Max at /connections, or set ANTHROPIC_API_KEY / OPENAI_API_KEY in the environment.",
    );
    this.name = "LlmNotConfiguredError";
  }
}

async function getClaudeOauthToken(orgId: string): Promise<string | null> {
  const conn = await getConnection(orgId, "claude-max");
  if (!conn || conn.status !== "connected") return null;
  const meta = (conn.metadata ?? {}) as { access_token?: string };
  if (!meta.access_token) return null;
  const token = tryDecryptSecret(meta.access_token);
  return token || null;
}

export async function chatCompleteOAuthFirst(
  orgId: string,
  req: Omit<ChatRequest, "provider" | "claudeMaxOauthToken">,
): Promise<ChatResponse> {
  const token = await getClaudeOauthToken(orgId);
  if (token) {
    return chatComplete({
      ...req,
      provider: "claude-max-oauth",
      claudeMaxOauthToken: token,
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return chatComplete({ ...req, provider: "anthropic-api" });
  }

  if (process.env.OPENAI_API_KEY) {
    return chatComplete({ ...req, provider: "openai" });
  }

  throw new LlmNotConfiguredError();
}
