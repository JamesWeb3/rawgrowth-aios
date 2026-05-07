import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { uploadToBucket, removeFromBucket } from "@/lib/storage/local";

type KnowledgeRow =
  Database["public"]["Tables"]["rgaios_knowledge_files"]["Row"];

const BUCKET = "knowledge";

function storagePathFor(organizationId: string, fileId: string) {
  return `${organizationId}/${fileId}.md`;
}

export async function listKnowledgeFilesForOrg(
  organizationId: string,
): Promise<KnowledgeRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_knowledge_files")
    .select("*")
    .eq("organization_id", organizationId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(`listKnowledgeFiles: ${error.message}`);
  return data ?? [];
}

export async function getKnowledgeFile(
  organizationId: string,
  id: string,
): Promise<KnowledgeRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_knowledge_files")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getKnowledgeFile: ${error.message}`);
  return data;
}

export async function readKnowledgeFileContent(
  storagePath: string,
): Promise<string> {
  const { readFromBucket } = await import("@/lib/storage/local");
  const result = await readFromBucket(BUCKET, storagePath);
  if (!result) throw new Error(`readKnowledgeFileContent: not found ${storagePath}`);
  return result.bytes.toString("utf8");
}

export async function createKnowledgeFile(input: {
  organizationId: string;
  title: string;
  tags: string[];
  content: string;
  mimeType?: string;
}): Promise<KnowledgeRow> {
  const mimeType = input.mimeType ?? "text/markdown";
  const contentBuffer = new TextEncoder().encode(input.content);

  // 1. Insert the row to get an id we can use in the storage path.
  const { data: inserted, error: insertErr } = await supabaseAdmin()
    .from("rgaios_knowledge_files")
    .insert({
      organization_id: input.organizationId,
      title: input.title,
      tags: input.tags,
      storage_path: "", // placeholder, filled after upload
      mime_type: mimeType,
      size_bytes: contentBuffer.byteLength,
    })
    .select("*")
    .single();
  if (insertErr || !inserted) {
    throw new Error(`createKnowledgeFile insert: ${insertErr?.message}`);
  }

  const path = storagePathFor(input.organizationId, inserted.id);

  // 2. Upload the actual bytes (storage adapter dispatches to Supabase
  // Storage on hosted, local FS on self_hosted).
  try {
    await uploadToBucket(BUCKET, path, Buffer.from(contentBuffer), mimeType);
  } catch (err) {
    // Roll back the row if the upload failed.
    await supabaseAdmin()
      .from("rgaios_knowledge_files")
      .delete()
      .eq("id", inserted.id);
    throw new Error(`createKnowledgeFile upload: ${(err as Error).message}`);
  }

  // 3. Patch the storage_path onto the row so future reads know where to go.
  const { data: finalised, error: updateErr } = await supabaseAdmin()
    .from("rgaios_knowledge_files")
    .update({ storage_path: path })
    .eq("id", inserted.id)
    .select("*")
    .single();
  if (updateErr || !finalised) {
    throw new Error(`createKnowledgeFile update: ${updateErr?.message}`);
  }

  return finalised;
}

export async function updateKnowledgeFileTags(
  organizationId: string,
  id: string,
  tags: string[],
): Promise<KnowledgeRow> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_knowledge_files")
    .update({ tags })
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`updateKnowledgeFileTags: ${error?.message}`);
  }
  return data;
}

export async function deleteKnowledgeFile(
  organizationId: string,
  id: string,
): Promise<void> {
  const row = await getKnowledgeFile(organizationId, id);
  if (!row) return;

  // 1. Remove the storage object  -  best-effort (continue even if missing).
  if (row.storage_path) {
    try {
      await removeFromBucket(BUCKET, row.storage_path);
    } catch (err) {
      console.warn("[knowledge] storage remove failed:", (err as Error).message);
    }
  }

  // 2. Delete the row.
  const { error } = await supabaseAdmin()
    .from("rgaios_knowledge_files")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) throw new Error(`deleteKnowledgeFile: ${error.message}`);
}
