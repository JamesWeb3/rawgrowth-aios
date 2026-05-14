import { NextRequest, NextResponse } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { uploadToBucket } from "@/lib/storage/local";
import { chunkText } from "@/lib/knowledge/chunker";
import { embedBatchWithProvider, toPgVector } from "@/lib/knowledge/embedder";
import { extractText } from "@/lib/knowledge/extract";

export const runtime = "nodejs";

const BUCKET = "agent-files";
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB cap per brief §7

/**
 * POST /api/agent-files/upload
 * multipart/form-data { file, agent_id }
 *
 * 1. Enforce org + agent ownership.
 * 2. Upload blob to Supabase Storage bucket 'agent-files' under
 *    <orgId>/<agentId>/<timestamp>-<safeName>.
 * 3. Insert rgaios_agent_files metadata row.
 * 4. Extract text (PDF/DOCX/MD/TXT/CSV), chunk, embed, insert chunks.
 *
 * Returns { file_id, chunk_count, warnings }.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  // Guard against malformed multipart bodies: Next 16 surfaces parser
  // failures as a server-level TypeError that 500s the request, leaks
  // a stack trace, and shows up in the browser as an opaque error
  // toast. Wrapping the parse here turns it into a clean 400 the
  // FileDropZone / AgentChatTab handlers already render to the user.
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `Bad upload body: ${(err as Error).message}` },
      { status: 400 },
    );
  }
  const file = form.get("file");
  const agentId = String(form.get("agent_id") ?? "").trim();
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (!agentId) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 100MB)" }, { status: 413 });
  }

  // Ownership guard.
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const storagePath = `${orgId}/${agentId}/${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    await uploadToBucket(
      BUCKET,
      storagePath,
      bytes,
      file.type || "application/octet-stream",
    );
  } catch (uploadErr) {
    return NextResponse.json(
      { error: (uploadErr as Error).message },
      { status: 500 },
    );
  }

  const { data: inserted, error: metaErr } = await db
    .from("rgaios_agent_files")
    .insert({
      organization_id: orgId,
      agent_id: agentId,
      filename: file.name,
      storage_path: storagePath,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      uploaded_by: ctx.userId,
    })
    .select("id")
    .single();
  if (metaErr || !inserted) {
    return NextResponse.json(
      { error: metaErr?.message ?? "metadata insert failed" },
      { status: 500 },
    );
  }
  const fileId = inserted.id;

  // Extract → chunk → embed → insert. Failures here do NOT fail the upload;
  // the file blob is already stored and visible in the library. Chunks
  // can be backfilled by hitting this endpoint again with the same file.
  const warnings: string[] = [];
  let chunkCount = 0;

  try {
    const { text, warnings: extractWarnings } = await extractText(
      bytes,
      file.type || "application/octet-stream",
      file.name,
    );
    warnings.push(...extractWarnings);

    if (text.trim()) {
      const chunks = chunkText(text);
      const { vectors: embeddings, provider } = await embedBatchWithProvider(
        chunks.map((c) => c.content),
      );
      const rows = chunks.map((c, i) => ({
        file_id: fileId,
        organization_id: orgId,
        agent_id: agentId,
        chunk_index: c.index,
        content: c.content,
        token_count: Math.round(c.content.length / 4),
        embedding: embeddings[i] ? toPgVector(embeddings[i]) : null,
        embedding_provider: provider,
      }));
      // Supabase has a 1000-row cap on single insert; batch if needed.
      // embedding_provider (migration 0073) isn't in the generated
      // Database types yet; cast the batch to bypass the stale
      // inference until the next type regen.
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db
          .from("rgaios_agent_file_chunks")
          .insert(rows.slice(i, i + 500) as never);
        if (error) throw error;
      }
      chunkCount = rows.length;
    }
  } catch (err) {
    warnings.push(`chunk/embed failed: ${(err as Error).message}`);
  }

  return NextResponse.json({ file_id: fileId, chunk_count: chunkCount, warnings });
}
