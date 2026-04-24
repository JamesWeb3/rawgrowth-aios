/**
 * Minimal Slack Web API client. Mirrors the shape of our telegram
 * client — just a `call()` helper plus a handful of thin wrappers.
 *
 * Uses the bot token we stored at OAuth install time. All calls run
 * server-side (from the client's VPS) using their per-client Slack App.
 */

const WEB_API = "https://slack.com/api";

type SlackResponse<T> = T & {
  ok: boolean;
  error?: string;
  warning?: string;
};

async function call<T extends Record<string, unknown>>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<SlackResponse<T>> {
  const res = await fetch(`${WEB_API}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : "{}",
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as SlackResponse<T>;
  if (!json.ok) {
    throw new Error(
      `Slack ${method} failed: ${json.error ?? "unknown"}${
        json.warning ? ` (warning: ${json.warning})` : ""
      }`,
    );
  }
  return json;
}

export type SlackChannel = {
  id: string;
  name: string;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
  num_members?: number;
  topic?: { value: string };
  purpose?: { value: string };
};

export async function listChannels(
  token: string,
): Promise<SlackChannel[]> {
  const out: SlackChannel[] = [];
  let cursor: string | undefined;
  // Paginate — workspaces with >100 channels shouldn't silently truncate.
  for (let i = 0; i < 20; i++) {
    const r = await call<{
      channels?: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    if (r.channels) out.push(...r.channels);
    cursor = r.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

export async function postMessage(
  token: string,
  input: {
    channel: string;
    text: string;
    thread_ts?: string;
    unfurl_links?: boolean;
  },
): Promise<{ ts: string; channel: string }> {
  const r = await call<{ ts: string; channel: string }>(
    token,
    "chat.postMessage",
    {
      channel: input.channel,
      text: input.text,
      thread_ts: input.thread_ts,
      unfurl_links: input.unfurl_links ?? false,
    },
  );
  return { ts: r.ts, channel: r.channel };
}

/** Open a DM channel with a user id (returns the channel id to post into). */
export async function openDm(
  token: string,
  userId: string,
): Promise<string> {
  const r = await call<{ channel?: { id: string } }>(
    token,
    "conversations.open",
    { users: userId },
  );
  if (!r.channel?.id) throw new Error("conversations.open returned no channel");
  return r.channel.id;
}

export type SlackFile = {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
  transcription?: { preview?: { content?: string }; status?: string };
  // Some file types (e.g. audio/video auto-transcribed) include a
  // `transcript_edits` field or a separate preview URL.
};

export async function getFileInfo(
  token: string,
  fileId: string,
): Promise<SlackFile> {
  const r = await call<{ file?: SlackFile }>(token, "files.info", {
    file: fileId,
  });
  if (!r.file) throw new Error("files.info returned no file");
  return r.file;
}

/** Download the raw content of a Slack file. Respects the bot's OAuth. */
export async function downloadFile(
  token: string,
  url: string,
): Promise<string> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`file fetch ${res.status}`);
  // Text files only for v1 (transcripts are .txt/.vtt/.srt usually).
  return await res.text();
}

/**
 * Verify Slack's X-Slack-Signature header. Called at the top of the
 * Events webhook route before trusting any payload.
 *
 * Per docs: signature = "v0=" + hmac_sha256(signing_secret, "v0:" + ts + ":" + raw_body)
 * Reject if timestamp is > 5 min old (replay-protection).
 */
export async function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const { signingSecret, timestamp, signature, rawBody } = input;
  const tolerance = input.toleranceSeconds ?? 300;
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return false;

  const crypto = await import("node:crypto");
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex")}`;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch {
    return false;
  }
}
