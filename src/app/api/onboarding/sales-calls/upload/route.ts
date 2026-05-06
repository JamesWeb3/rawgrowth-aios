import { NextRequest, NextResponse } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { chunkText } from "@/lib/knowledge/chunker";
import { embedBatch, toPgVector } from "@/lib/knowledge/embedder";
import { supabaseAdmin } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/voice/transcribe";

/**
 * POST /api/onboarding/sales-calls/upload
 *
 * Two intake shapes:
 *   - multipart/form-data with `file`  -  raw audio (mp3/m4a/webm/ogg).
 *     Stored in the `sales-calls` bucket, transcribed via
 *     transcribeAudio(), then chunked + embedded into
 *     rgaios_company_chunks tagged source='sales_call'.
 *   - application/json `{ url }`  -  Loom/Fireflies/Gong link. Detected
 *     by hostname; persisted with status='error' for now since the
 *     per-provider transcript fetchers aren't wired yet (Plan §12 TODO).
 *
 * Returns `{ ok, salesCallId, transcriptPreview }` on success, or
 * `{ ok: false, salesCallId, error }` on transcription failure (the
 * row is still inserted so the operator can retry).
 *
 * GET returns the per-org call list for the uploader UI.
 */

export const runtime = "nodejs";
// Whisper on a 30-min mp3 takes 60-90s on a CX22; leave headroom.
export const maxDuration = 300;

const BUCKET = "sales-calls";
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB
const TRANSCRIBE_BUDGET_MS = 290_000; // ~5 min, fits the 300s route cap.

/**
 * First-call bucket auto-provision. wire-supabase.sh creates the bucket
 * on self-hosted bootstrap, but Supabase Cloud projects (the hosted
 * Vercel deploy at rawclaw-rose) were provisioned by hand and the
 * sales-calls bucket was missed. Without this guard the route 500s
 * with "Bucket not found" on every upload until ops adds the bucket
 * manually. The guard is idempotent: createBucket no-ops if present.
 */
let _bucketEnsured = false;
async function ensureBucket(
  db: ReturnType<typeof supabaseAdmin>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (_bucketEnsured) return { ok: true };
  const { data: existing } = await db.storage.getBucket(BUCKET);
  if (existing) {
    _bucketEnsured = true;
    return { ok: true };
  }
  const { error } = await db.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES,
  });
  if (error && !/already exists/i.test(error.message)) {
    return { ok: false, error: error.message };
  }
  _bucketEnsured = true;
  return { ok: true };
}

const ALLOWED_AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
]);

type UrlSource = "loom" | "fireflies" | "gong" | "other_url";

function detectUrlSource(url: string): UrlSource | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("loom.com")) return "loom";
    if (host.includes("fireflies.ai")) return "fireflies";
    if (host.includes("gong.io")) return "gong";
    return "other_url";
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = ctx.activeOrgId;
    const db = supabaseAdmin();

    const contentType = req.headers.get("content-type") || "";

    // ─── Branch 1: URL paste ────────────────────────────────────────
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as { url?: string };
      const url = (body.url ?? "").trim();
      if (!url) {
        return NextResponse.json({ error: "Missing url" }, { status: 400 });
      }
      const sourceType = detectUrlSource(url);
      if (!sourceType) {
        return NextResponse.json(
          { error: "Invalid URL" },
          { status: 400 },
        );
      }

      // Per-provider transcript fetchers aren't wired yet. Persist the
      // row so the operator can see the URL and retry once the fetcher
      // ships. TODO(§12): Loom transcript JSON scrape + Fireflies API
      // + Gong API.
      const { data: row, error } = await db
        .from("rgaios_sales_calls")
        .insert({
          organization_id: orgId,
          source_type: sourceType,
          source_url: url,
          status: "error",
          error: "url ingestion not yet implemented",
        })
        .select("id, source_type, source_url, status, error, created_at")
        .single();
      if (error || !row) {
        return NextResponse.json(
          { error: error?.message ?? "insert failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({
        ok: false,
        salesCallId: row.id,
        salesCall: row,
        error: row.error,
      });
    }

    // ─── Branch 2: audio file upload ────────────────────────────────
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large (max 200 MB)" },
        { status: 413 },
      );
    }
    const mime = (file.type || "application/octet-stream").toLowerCase();
    if (!ALLOWED_AUDIO_MIMES.has(mime) && !mime.startsWith("audio/")) {
      return NextResponse.json(
        { error: `Unsupported audio type: ${mime}` },
        { status: 415 },
      );
    }

    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const storagePath = `${orgId}/${Date.now()}-${safeName}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const ensure = await ensureBucket(db);
    if (!ensure.ok) {
      console.error("[sales-calls/upload] bucket ensure failed:", ensure.error);
      return NextResponse.json(
        { error: `Storage not ready: ${ensure.error}` },
        { status: 503 },
      );
    }

    const { error: uploadErr } = await db.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: mime,
        upsert: false,
      });
    if (uploadErr) {
      console.error("[sales-calls/upload] storage error:", uploadErr);
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    // Insert pending row first so we have an id for chunk metadata.
    const { data: inserted, error: insertErr } = await db
      .from("rgaios_sales_calls")
      .insert({
        organization_id: orgId,
        source_type: "audio_upload",
        filename: file.name,
        status: "pending",
        metadata: { storage_path: storagePath, mime, size_bytes: file.size },
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: insertErr?.message ?? "insert failed" },
        { status: 500 },
      );
    }
    const salesCallId = inserted.id;

    // Flip to 'transcribing' so a concurrent list-fetch reflects state.
    await db
      .from("rgaios_sales_calls")
      .update({ status: "transcribing" })
      .eq("id", salesCallId);

    let transcript = "";
    try {
      const result = await transcribeAudio(bytes, mime, TRANSCRIBE_BUDGET_MS);
      transcript = result.text.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : "transcription failed";
      console.error("[sales-calls/upload] transcribe error:", message);
      await db
        .from("rgaios_sales_calls")
        .update({ status: "error", error: message })
        .eq("id", salesCallId);
      return NextResponse.json(
        { ok: false, salesCallId, error: message },
        { status: 500 },
      );
    }

    if (!transcript) {
      await db
        .from("rgaios_sales_calls")
        .update({ status: "error", error: "empty transcript" })
        .eq("id", salesCallId);
      return NextResponse.json(
        { ok: false, salesCallId, error: "empty transcript" },
        { status: 500 },
      );
    }

    // Chunk + embed into the company-wide corpus.
    let chunkCount = 0;
    const warnings: string[] = [];
    try {
      const chunks = chunkText(transcript);
      if (chunks.length > 0) {
        const embeddings = await embedBatch(chunks.map((c) => c.content));
        const rows = chunks.map((c, i) => ({
          organization_id: orgId,
          source: "sales_call",
          source_id: salesCallId,
          chunk_index: c.index,
          content: c.content,
          token_count: Math.round(c.content.length / 4),
          embedding: embeddings[i] ? toPgVector(embeddings[i]) : null,
          metadata: {
            sales_call_id: salesCallId,
            filename: file.name,
            source: "sales_call",
          },
        }));
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await db
            .from("rgaios_company_chunks")
            .insert(rows.slice(i, i + 500));
          if (error) throw error;
        }
        chunkCount = rows.length;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "chunk/embed failed";
      console.error("[sales-calls/upload] embed error:", message);
      warnings.push(`chunk/embed failed: ${message}`);
    }

    // Persist transcript + ready status.
    const { data: ready, error: updateErr } = await db
      .from("rgaios_sales_calls")
      .update({
        status: "ready",
        transcript,
        metadata: {
          storage_path: storagePath,
          mime,
          size_bytes: file.size,
          chunk_count: chunkCount,
        },
      })
      .eq("id", salesCallId)
      .select("id, source_type, filename, status, created_at")
      .single();
    if (updateErr) {
      return NextResponse.json(
        { error: updateErr.message, salesCallId },
        { status: 500 },
      );
    }

    const transcriptPreview = transcript.slice(0, 240);
    return NextResponse.json({
      ok: true,
      salesCallId,
      salesCall: ready,
      transcriptPreview,
      chunkCount,
      warnings,
    });
  } catch (err: unknown) {
    console.error("[sales-calls/upload] error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = ctx.activeOrgId;

    const { data: salesCalls } = await supabaseAdmin()
      .from("rgaios_sales_calls")
      .select(
        "id, source_type, source_url, filename, status, error, created_at",
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    return NextResponse.json({ salesCalls: salesCalls ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
