/**
 * Voice-note transcription via OpenAI Whisper.
 *
 * Anthropic doesn't have a transcription API today, so any audio path
 * (Telegram voice notes, future WhatsApp voice, etc.) goes through
 * OpenAI's /audio/transcriptions endpoint.
 *
 * Cost / latency:
 *   - whisper-1: $0.006 per minute, ~2-5s for short clips
 *   - Accepts OGG/Opus natively (Telegram's voice format)
 *
 * Auth: requires OPENAI_API_KEY in env. If missing, transcribeVoice()
 * returns null so the webhook can degrade gracefully — the caller can
 * surface a "voice notes need OpenAI configured" message rather than
 * silently failing.
 */

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MODEL = "whisper-1";

export type TranscribeResult =
  | { ok: true; text: string; durationSec?: number; language?: string }
  | { ok: false; error: string };

/**
 * Send raw audio bytes to Whisper. mimeType drives the multipart filename
 * extension — Telegram voice is always audio/ogg → .ogg works.
 */
export async function transcribeVoice(input: {
  bytes: Uint8Array;
  mimeType: string;
  language?: string; // ISO 639-1 (e.g. "en", "pl"). Auto-detect when omitted.
}): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "OPENAI_API_KEY is not set on this server. Voice transcription requires it.",
    };
  }

  // Telegram voice → audio/ogg → .ogg. Other audio types fall through to
  // a generic .bin which Whisper still accepts (it sniffs the format).
  const ext = input.mimeType.includes("ogg")
    ? "ogg"
    : input.mimeType.includes("mp3")
      ? "mp3"
      : input.mimeType.includes("wav")
        ? "wav"
        : input.mimeType.includes("m4a")
          ? "m4a"
          : "bin";

  const form = new FormData();
  // node FormData accepts Blob; web Blob ctor accepts BufferSource.
  // Cast through ArrayBuffer to satisfy strict BlobPart typing — the
  // bytes come from a fetch() Response which is always a fresh buffer.
  const blob = new Blob([input.bytes.buffer as ArrayBuffer], { type: input.mimeType });
  form.append("file", blob, `voice.${ext}`);
  form.append("model", MODEL);
  form.append("response_format", "verbose_json");
  if (input.language) form.append("language", input.language);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Whisper network failure: ${(err as Error).message}`,
    };
  }

  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      error: `Whisper ${res.status}: ${text.slice(0, 300)}`,
    };
  }

  try {
    const parsed = JSON.parse(text) as {
      text?: string;
      duration?: number;
      language?: string;
    };
    if (!parsed.text) {
      return { ok: false, error: "Whisper returned no transcript text" };
    }
    return {
      ok: true,
      text: parsed.text.trim(),
      durationSec: parsed.duration,
      language: parsed.language,
    };
  } catch {
    return {
      ok: false,
      error: `Whisper returned non-JSON: ${text.slice(0, 200)}`,
    };
  }
}
