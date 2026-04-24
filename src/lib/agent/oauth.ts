import { createHash, randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

/**
 * Server-side Claude Max OAuth flow.
 *
 * Why server-side? Anthropic binds OAuth access tokens to the IP that
 * exchanges the code for the token. If the user runs `claude setup-token`
 * on their laptop and pastes the resulting token into our dashboard, the
 * token works on their laptop but is rejected as "Invalid bearer token"
 * the moment we try to use it from the VPS.
 *
 * To get a VPS-bound token, the *VPS* has to do the token exchange. So
 * the dashboard server:
 *   1. Generates the PKCE pair locally
 *   2. Hands the user the authorize URL
 *   3. Receives the code the user copy-pastes back from
 *      platform.claude.com/oauth/code/callback
 *   4. Calls Anthropic's /v1/oauth/token endpoint from the VPS itself
 *   5. Stores the resulting access_token (encrypted) in rgaios_connections
 *
 * The state we hand to Anthropic carries the code_verifier — encrypted —
 * so we don't need a DB table for the in-flight half of the flow.
 */

// Public Claude Code OAuth client. Same client_id the `claude` CLI uses;
// confirmed by inspecting the URLs `claude setup-token` prints.
export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_OAUTH_REDIRECT_URI =
  "https://platform.claude.com/oauth/code/callback";
export const CLAUDE_OAUTH_AUTHORIZE_URL =
  "https://claude.com/cai/oauth/authorize";
// Token endpoint Anthropic exposes for the Claude Code OAuth client.
export const CLAUDE_OAUTH_TOKEN_URL =
  "https://console.anthropic.com/v1/oauth/token";
export const CLAUDE_OAUTH_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];

/** PKCE pair — verifier is the secret, challenge is what we send to Anthropic. */
export function makePkcePair(): { verifier: string; challenge: string } {
  // 64 random bytes → ~86 chars base64url. Well within RFC 7636 (43–128).
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

/**
 * Build the URL the user opens in their browser to authorize. Uses
 * Anthropic's hosted callback page so the user simply copies the code
 * Anthropic shows them and pastes it into our dashboard form.
 */
export function buildAuthorizeUrl(input: {
  challenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
    scope: CLAUDE_OAUTH_SCOPES.join(" "),
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
  });
  return `${CLAUDE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Pack the in-flight verifier into the OAuth `state` parameter (encrypted),
 * so we don't need a temporary DB row to bridge start → callback.
 */
export function packState(input: {
  verifier: string;
  organizationId: string;
}): string {
  const payload = JSON.stringify({
    v: input.verifier,
    o: input.organizationId,
    t: Date.now(),
  });
  return encryptSecret(payload);
}

export type UnpackedState = {
  verifier: string;
  organizationId: string;
  issuedAt: number;
};

export function unpackState(state: string): UnpackedState | null {
  try {
    const raw = decryptSecret(state);
    const parsed = JSON.parse(raw) as { v?: string; o?: string; t?: number };
    if (!parsed.v || !parsed.o) return null;
    // Reject states older than 30 minutes — user took too long.
    if (parsed.t && Date.now() - parsed.t > 30 * 60_000) return null;
    return {
      verifier: parsed.v,
      organizationId: parsed.o,
      issuedAt: parsed.t ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * The actual token exchange. THIS is the call that has to happen from
 * the VPS for the token to be usable from the VPS. The Anthropic-issued
 * code is pasted by the user, but we exchange it here, server-side.
 *
 * Anthropic's token endpoint quirks (verified via probe — 2026-04-24):
 *   • Wants application/json, NOT form-urlencoded
 *   • Wants the same `state` param sent on /authorize, in the body
 *     (this is non-standard OAuth but Anthropic enforces it)
 *
 * Pasted codes from platform.claude.com/oauth/code/callback look like
 * `<authorization-code>#<state>` — we split on `#` and use the first half.
 */
export async function exchangeCodeForToken(input: {
  code: string;
  verifier: string;
  state: string;
}): Promise<
  | {
      ok: true;
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    }
  | { ok: false; error: string; status?: number }
> {
  const cleanCode = input.code.split("#")[0]?.trim() ?? "";
  if (!cleanCode) return { ok: false, error: "code is empty" };

  let res: Response;
  try {
    res = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: cleanCode,
        redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
        code_verifier: input.verifier,
        state: input.state,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, error: `network: ${(err as Error).message}` };
  }

  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: text.slice(0, 400),
    };
  }
  try {
    const parsed = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!parsed.access_token) {
      return {
        ok: false,
        error: `token endpoint returned no access_token: ${text.slice(0, 200)}`,
      };
    }
    return {
      ok: true,
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_in: parsed.expires_in,
    };
  } catch {
    return {
      ok: false,
      error: `token endpoint returned non-JSON: ${text.slice(0, 200)}`,
    };
  }
}
