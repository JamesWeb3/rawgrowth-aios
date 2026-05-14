import { supabaseAdmin } from "@/lib/supabase/server";
import { uploadToBucket } from "@/lib/storage/local";
import { chunkText } from "@/lib/knowledge/chunker";
import { embedBatch, toPgVector } from "@/lib/knowledge/embedder";

/**
 * Plan §3 + §4. Reusable ingest path for per-agent files. The upload
 * route at /api/agent-files/upload calls this; the hire flow + the
 * default-org seed call this directly with starter MD content from
 * src/lib/agents/starter-content/<role-slug>/<filename>.
 *
 * Storage path is optional - hire-flow seeded files are inline-only
 * (no blob in supabase storage), so we accept null storage_path.
 */

const BUCKET = "agent-files";

export type IngestResult = {
  fileId: string | null;
  chunkCount: number;
  warnings: string[];
  ok: boolean;
};

export async function ingestAgentFile(input: {
  orgId: string;
  agentId: string;
  filename: string;
  content: string;
  mimeType?: string;
  uploadedBy?: string | null;
  storage?: { path: string; bytes: Buffer } | null;
}): Promise<IngestResult> {
  const db = supabaseAdmin();
  const warnings: string[] = [];

  // storage_path is NOT NULL on rgaios_agent_files, so inline-only
  // ingests (hire-flow starter docs) use an `inline://` sentinel that
  // makes the source obvious in queries without needing a real blob.
  let storagePath: string = `inline://${input.agentId}/${input.filename}`;
  if (input.storage) {
    try {
      await uploadToBucket(
        BUCKET,
        input.storage.path,
        input.storage.bytes,
        input.mimeType ?? "application/octet-stream",
      );
      storagePath = input.storage.path;
    } catch (uploadErr) {
      warnings.push(
        `storage upload failed: ${(uploadErr as Error).message}`,
      );
    }
  }

  const { data: inserted, error: metaErr } = await db
    .from("rgaios_agent_files")
    .insert({
      organization_id: input.orgId,
      agent_id: input.agentId,
      filename: input.filename,
      storage_path: storagePath,
      mime_type: input.mimeType ?? "text/markdown",
      size_bytes: Buffer.byteLength(input.content, "utf8"),
      uploaded_by: input.uploadedBy ?? null,
    })
    .select("id")
    .single();
  if (metaErr || !inserted) {
    throw new Error(`ingestAgentFile: ${metaErr?.message ?? "metadata insert failed"}`);
  }
  const fileId = inserted.id as string;

  let chunkCount = 0;
  try {
    if (input.content.trim()) {
      const chunks = chunkText(input.content);
      if (chunks.length > 0) {
        const embeddings = await embedBatch(chunks.map((c) => c.content));
        const rows = chunks.map((c, i) => ({
          file_id: fileId,
          organization_id: input.orgId,
          agent_id: input.agentId,
          chunk_index: c.index,
          content: c.content,
          token_count: Math.round(c.content.length / 4),
          embedding: embeddings[i] ? toPgVector(embeddings[i]) : null,
        }));
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await db
            .from("rgaios_agent_file_chunks")
            .insert(rows.slice(i, i + 500));
          if (error) throw error;
        }
        chunkCount = rows.length;
      }
    }
  } catch (err) {
    warnings.push(`chunk/embed failed: ${(err as Error).message}`);
  }

  // A file row with zero chunks is invisible to RAG but looks like a
  // successful ingest. rgaios_agent_files has no status column, so the
  // cleanest fix is to delete the orphan row rather than leave a
  // phantom file behind. ok=false tells the caller not to count it.
  if (chunkCount === 0) {
    const { error: cleanupErr } = await db
      .from("rgaios_agent_files")
      .delete()
      .eq("id", fileId);
    if (cleanupErr) {
      warnings.push(`orphan file cleanup failed: ${cleanupErr.message}`);
      return { fileId, chunkCount, warnings, ok: false };
    }
    return { fileId: null, chunkCount, warnings, ok: false };
  }

  return { fileId, chunkCount, warnings, ok: true };
}
