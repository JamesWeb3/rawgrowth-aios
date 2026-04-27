import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

/**
 * Per-client Slack OAuth helpers.
 *
 * Architecture: each client creates their own Slack App at
 * https://api.slack.com/apps (~5 min guided wizard in our dashboard),
 * pastes the resulting client_id / client_secret / signing_secret into
 * /connections. Their VPS then runs Slack's v2 OAuth install flow
 * against THEIR app, and the bot token Anthropic…er, Slack issues is
 * bound to that client's workspace.
 *
 * This avoids the "shared Slack App + one Events URL" routing problem
 *  -  each client's events land directly on their own VPS because their
 * Slack App was configured to point at their VPS webhook URL.
 *
 * Scope list below matches our Phase 1+2+3 feature set: read channels
 * and messages, write replies, read uploaded files (for transcripts),
 * identify senders.
 */

export const SLACK_BOT_SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "chat:write",
  "files:read",
  "users:read",
  "app_mentions:read",
];

export const SLACK_OAUTH_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_OAUTH_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

/**
 * Pack in-flight state into the `state` param so we don't need a temp
 * DB row. We encrypt the payload  -  the state passes through the user's
 * browser, don't want it to leak the org id in plaintext.
 */
export function packState(input: {
  organizationId: string;
  returnTo?: string;
}): string {
  const payload = JSON.stringify({
    o: input.organizationId,
    r: input.returnTo ?? "/connections",
    n: randomBytes(8).toString("base64url"),
    t: Date.now(),
  });
  return encryptSecret(payload);
}

export type UnpackedState = {
  organizationId: string;
  returnTo: string;
  issuedAt: number;
};

export function unpackState(state: string): UnpackedState | null {
  try {
    const raw = decryptSecret(state);
    const parsed = JSON.parse(raw) as {
      o?: string;
      r?: string;
      t?: number;
    };
    if (!parsed.o) return null;
    // Reject >30 min old  -  user gave up / tab went stale.
    if (parsed.t && Date.now() - parsed.t > 30 * 60_000) return null;
    return {
      organizationId: parsed.o,
      returnTo: parsed.r ?? "/connections",
      issuedAt: parsed.t ?? 0,
    };
  } catch {
    return null;
  }
}

export function buildInstallUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    scope: (input.scopes ?? SLACK_BOT_SCOPES).join(","),
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  return `${SLACK_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange the authorization code Slack sent to our callback for a
 * workspace bot token. Happens server-side on the VPS so the token is
 * bound to that VPS's IP (Slack doesn't actually IP-bind like Anthropic
 * does, but it's still best-practice to do this server-side).
 */
export async function exchangeCodeForToken(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<
  | {
      ok: true;
      access_token: string;
      bot_user_id: string;
      team_id: string;
      team_name: string;
      scope: string;
    }
  | { ok: false; error: string; status?: number }
> {
  let res: Response;
  try {
    const form = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    });
    res = await fetch(SLACK_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, error: `network: ${(err as Error).message}` };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: text.slice(0, 400) };
  }

  let data: {
    ok?: boolean;
    error?: string;
    access_token?: string;
    scope?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  };
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: `non-JSON: ${text.slice(0, 200)}` };
  }
  // Slack returns 200 with { ok: false, error: "..." } for flow errors.
  if (!data.ok) {
    return { ok: false, error: data.error ?? "unknown slack error" };
  }
  if (!data.access_token || !data.bot_user_id || !data.team?.id) {
    return { ok: false, error: "missing expected fields in Slack response" };
  }
  return {
    ok: true,
    access_token: data.access_token,
    bot_user_id: data.bot_user_id,
    team_id: data.team.id,
    team_name: data.team.name ?? data.team.id,
    scope: data.scope ?? "",
  };
}
