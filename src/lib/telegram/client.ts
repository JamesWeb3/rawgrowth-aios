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

export function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
) {
  return call<unknown>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  });
}

/**
 * Show a "typing…" bubble to the user. Auto-clears after 5s or when the
 * next message is sent. Use it the moment a webhook arrives so the user
 * gets immediate visual feedback while the agent thinks.
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
export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
  };
};
