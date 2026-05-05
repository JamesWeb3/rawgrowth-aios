import { NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ingestCompanyChunk } from "@/lib/knowledge/company-corpus";

export const runtime = "nodejs";
export const maxDuration = 30;

const STORAGE_BUCKET = "knowledge";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB - generous for logos / brand PDFs

const ALLOWED_BUCKETS = new Set([
  "brand",
  "content",
  "marketing",
  "sales",
  "fulfilment",
  "finance",
  "customer",
  "other",
]);

/**
 * POST /api/files/upload
 *
 * Org-wide bucketed file uploads (Chris's "files they can drop in" view).
 * Stores blobs in the same `knowledge` bucket as legacy /knowledge so
 * existing readers keep working, but tags rows with a `bucket` column so
 * the picker rail can group them by department / brand / content / etc.
 *
 * For markdown / text content we ALSO mirror into the company corpus so
 * agents can RAG over it. Binary uploads (logos, PDFs, palette swatches)
 * skip corpus indexing - they're for humans to drop in, not for retrieval.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;

  const form = await req.formData();
  const file = form.get("file");
  const bucket = String(form.get("bucket") ?? "other").trim().toLowerCase();
  const title = String(form.get("title") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json(
      { error: `unknown bucket: ${bucket}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${file.size} > ${MAX_BYTES})` },
      { status: 413 },
    );
  }

  const mimeType = file.type || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());
  const safeTitle = title || file.name;
  const db = supabaseAdmin();

  // 1. Insert row to grab id for storage path.
  const { data: inserted, error: insertErr } = await db
    .from("rgaios_knowledge_files")
    .insert({
      organization_id: orgId,
      title: safeTitle,
      tags: [],
      storage_path: "",
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      bucket,
    })
    .select("*")
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  // 2. Upload bytes to the existing `knowledge` storage bucket. Path
  //    convention: <orgId>/files/<bucket>/<id>-<safeName>.
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `${orgId}/files/${bucket}/${inserted.id}-${safeName}`;
  const { error: uploadErr } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: true });
  if (uploadErr) {
    await db.from("rgaios_knowledge_files").delete().eq("id", inserted.id);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  // 3. Patch the storage_path so reads can find the blob later.
  const { data: finalised, error: updateErr } = await db
    .from("rgaios_knowledge_files")
    .update({ storage_path: path })
    .eq("id", inserted.id)
    .select("*")
    .single();
  if (updateErr || !finalised) {
    return NextResponse.json(
      { error: updateErr?.message ?? "update failed" },
      { status: 500 },
    );
  }

  // 4. Best-effort corpus mirror for text-ish content.
  const isText =
    /^text\//i.test(mimeType) ||
    /\.(md|markdown|txt|csv|json)$/i.test(file.name);
  let chunks = 0;
  if (isText) {
    try {
      const text = bytes.toString("utf8");
      if (text.trim().length > 0) {
        const ingestResult = await ingestCompanyChunk({
          orgId,
          source: "knowledge_file",
          sourceId: finalised.id,
          text,
          metadata: {
            title: safeTitle,
            bucket,
            kind: "files_upload",
          },
        });
        chunks = ingestResult.chunkCount;
      }
    } catch (err) {
      console.warn("[files] corpus ingest failed:", (err as Error).message);
    }
  }

  return NextResponse.json(
    { ok: true, file: finalised, chunks },
    { status: 201 },
  );
}
