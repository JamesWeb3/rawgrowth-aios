import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { getFile, fileDownloadUrl } from "@/lib/telegram/client";

/**
 * Voice-to-text for Telegram voice notes. Dual-path by design:
 *
 *   PATH A (primary)  -  Anthropic native audio input via the Messages API.
 *     Single call, no subprocess, no binary dep. Used when ANTHROPIC_API_KEY
 *     is present. This is the Path B commercial-API runtime talking to itself
 *     only for transcription  -  it does not count against the client's Max sub.
 *
 *   PATH B (fallback)  -  whisper.cpp static binary. Used when Anthropic is
 *     unavailable / returns an error / the org opted out of the commercial
 *     key. Binary ships in the Dockerfile at /usr/local/bin/whisper-cli.
 *
 * Either path produces a plain-text transcript. The telegram webhook route
 * injects that transcript back into message.text so the rest of the drain
 * pipeline (chat loop + MCP telegram_reply) stays unchanged.
 */

const WHISPER_BIN = process.env.WHISPER_BIN ?? "/usr/local/bin/whisper-cli";
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ?? "/usr/local/share/whisper/ggml-base.en.bin";

export type TranscribeResult = {
  text: string;
  source: "anthropic" | "whisper";
  durationMs: number;
};

/**
 * Download a Telegram voice file to an in-memory buffer. Exported so the
 * webhook can surface download errors separately from transcription errors.
 */
export async function downloadTelegramVoice(
  botToken: string,
  fileId: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const meta = await getFile(botToken, fileId);
  if (!meta.file_path) throw new Error("Telegram getFile returned no file_path");
  const res = await fetch(fileDownloadUrl(botToken, meta.file_path));
  if (!res.ok) {
    throw new Error(`Telegram file download failed: HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return {
    bytes: Buffer.from(ab),
    mimeType: res.headers.get("content-type") ?? "audio/ogg",
  };
}

/**
 * Path A: Anthropic native audio. The Messages API accepts audio input
 * as base64 with a mime_type. We give it a short, explicit transcription
 * instruction to avoid Claude "helping" by summarising.
 */
async function transcribeViaAnthropic(
  bytes: Buffer,
  mimeType: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });

  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system:
      "Transcribe the user's audio verbatim. Output only the transcript, " +
      "no preamble, no summary, no markdown. Preserve the speaker's wording. " +
      "If the audio is empty or unintelligible, output exactly: [unintelligible]",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: mimeType,
              data: bytes.toString("base64"),
            },
          } as unknown as never,
        ],
      },
    ],
  });

  const textBlock = result.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic returned no text block");
  }
  return textBlock.text.trim();
}

/**
 * Path B: whisper.cpp subprocess. Writes the audio bytes to a temp file,
 * runs `whisper-cli -m <model> -f <audio> -otxt`, reads the resulting
 * <audio>.txt file. Cleans up the temp dir either way.
 */
async function transcribeViaWhisper(bytes: Buffer, mimeType: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rawclaw-voice-"));
  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "audio";
  const audioPath = path.join(dir, `in.${ext}`);
  await writeFile(audioPath, bytes);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        WHISPER_BIN,
        ["-m", WHISPER_MODEL, "-f", audioPath, "-otxt", "-nt"],
        { stdio: "pipe" },
      );
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`whisper-cli exit ${code}: ${stderr.slice(0, 500)}`));
      });
    });

    // whisper-cli -otxt writes <input>.txt next to the input file.
    const { readFile } = await import("node:fs/promises");
    const txt = await readFile(`${audioPath}.txt`, "utf-8");
    return txt.trim() || "[unintelligible]";
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * High-level entry: try Path A, fall back to Path B on failure.
 * Always returns a transcript string; throws only if both fail.
 */
export async function transcribeVoice(
  botToken: string,
  fileId: string,
): Promise<TranscribeResult> {
  const started = Date.now();
  const { bytes, mimeType } = await downloadTelegramVoice(botToken, fileId);

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const text = await transcribeViaAnthropic(bytes, mimeType);
      return { text, source: "anthropic", durationMs: Date.now() - started };
    } catch (err) {
      console.warn(
        "[voice] anthropic transcribe failed, falling back to whisper:",
        (err as Error).message,
      );
    }
  }

  const text = await transcribeViaWhisper(bytes, mimeType);
  return { text, source: "whisper", durationMs: Date.now() - started };
}
