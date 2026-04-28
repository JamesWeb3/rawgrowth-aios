/**
 * Minimal Telegram Bot API client. We only need a few endpoints:
 *   - getMe          → validate a bot token + display the bot identity
 *   - setWebhook     → point Telegram at our /api/webhooks/telegram/[id]
 *   - deleteWebhook  → clean up on disconnect
 *   - sendMessage    → reply to the user after a routine fires
 *
 * No SDK dependency — fetch + JSON is enough.
 */

const API_ROOT = "https://api.telegram.org";

type TgResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

async function call<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = (await res.json()) as TgResponse<T>;
  if (!json.ok) {
    throw new Error(
      `Telegram ${method} failed (${json.error_code ?? "?"}): ${json.description ?? "unknown error"}`,
    );
  }
  return json.result as T;
}

export type TgUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export function getMe(token: string) {
  return call<TgUser>(token, "getMe");
}

export function setWebhook(token: string, url: string, secretToken?: string) {
  return call<true>(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message"],
  });
}

export function deleteWebhook(token: string) {
  return call<true>(token, "deleteWebhook");
}

/** The subset of the Telegram Message object we actually use. */
export type TgSentMessage = {
  message_id: number;
  chat: { id: number };
  date: number;
  text?: string;
};

export function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
) {
  return call<TgSentMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  });
}

/**
 * Replace the contents of a message we previously sent. Use this to turn
 * a placeholder ("…") into the real agent reply once it arrives — Telegram
 * animates the swap, so from the user's side it looks like a speech bubble
 * that was thinking and then finished.
 *
 * Retries without parse_mode if Markdown validation fails (common when the
 * model emits stray asterisks or underscores).
 */
export async function editMessageText(
  token: string,
  chatId: number | string,
  messageId: number,
  text: string,
) {
  try {
    return await call<TgSentMessage>(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/parse|markdown|entities/i.test(msg)) {
      return await call<TgSentMessage>(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
      });
    }
    throw err;
  }
}

/**
 * Show a "typing…" bubble in the chat HEADER (not inline). Auto-clears
 * after 5s or when the next message is sent. Use it for instant feedback
 * while the agent thinks — pairs well with the placeholder-then-edit
 * pattern in the webhook handler.
 */
export function sendChatAction(
  token: string,
  chatId: number | string,
  action: "typing" | "upload_photo" = "typing",
) {
  return call<true>(token, "sendChatAction", {
    chat_id: chatId,
    action,
  });
}

// Shape of the inbound webhook payload (only fields we care about).
export type TgPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TgVoice = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
};

export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    caption?: string;
    photo?: TgPhotoSize[];
    voice?: TgVoice;
  };
};

/**
 * Resolve a Telegram file_id to a downloadable URL. Returns the path that
 * Telegram serves the binary at — combine with the bot token to fetch.
 */
export async function getFilePath(token: string, fileId: string): Promise<string> {
  const file = await call<{ file_path?: string }>(token, "getFile", {
    file_id: fileId,
  });
  if (!file.file_path) {
    throw new Error(`Telegram getFile returned no file_path for ${fileId}`);
  }
  return file.file_path;
}

/**
 * Download a Telegram-hosted file as raw bytes. Telegram limits this to
 * 20MB per request — voice notes and Telegram-compressed photos are well
 * under that ceiling.
 */
export async function downloadFile(
  token: string,
  filePath: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const url = `${API_ROOT}/file/bot${token}/${filePath}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Telegram file download failed: ${res.status}`);
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, mimeType };
}
