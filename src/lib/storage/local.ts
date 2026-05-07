/**
 * Local filesystem storage adapter for self-hosted Rawclaw.
 *
 * Self-hosted ships with postgres + postgrest only — no Supabase
 * Storage server. Routes that called `supabaseAdmin().storage` got
 * an empty `{}` error and the upload silently failed.
 *
 * This adapter writes uploaded bytes under STORAGE_DIR (default
 * /app/storage). Files are served back via /api/storage/[bucket]/[...path]
 * which reads through this same module so paths stay symmetric.
 *
 * Hosted (Supabase Cloud) keeps using supabaseAdmin().storage — see
 * uploadToBucket below for the dispatcher.
 */
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isSelfHosted } from "@/lib/deploy-mode";
import { supabaseAdmin } from "@/lib/supabase/server";

const STORAGE_ROOT = resolve(process.env.STORAGE_DIR ?? "/app/storage");

export type StorageUploadResult = {
  publicUrl: string;
  storagePath: string;
};

/**
 * Upload bytes under bucket/path. Returns a URL the browser can hit
 * to retrieve the file (relative for self-hosted, absolute for cloud).
 */
export async function uploadToBucket(
  bucket: string,
  path: string,
  bytes: Buffer,
  contentType: string,
): Promise<StorageUploadResult> {
  if (isSelfHosted) {
    const fullPath = join(STORAGE_ROOT, bucket, path);
    await fs.mkdir(dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, bytes);
    // Stash the content-type alongside so the read endpoint can echo it.
    await fs.writeFile(
      `${fullPath}.meta`,
      JSON.stringify({ contentType, uploadedAt: new Date().toISOString() }),
    );
    return {
      publicUrl: `/api/storage/${bucket}/${path}`,
      storagePath: path,
    };
  }
  // Hosted / v3: real Supabase Storage.
  const { error } = await supabaseAdmin()
    .storage.from(bucket)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`storage.upload: ${error.message}`);
  const { data } = supabaseAdmin().storage.from(bucket).getPublicUrl(path);
  return { publicUrl: data.publicUrl, storagePath: path };
}

export async function readFromBucket(
  bucket: string,
  path: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!isSelfHosted) {
    const { data, error } = await supabaseAdmin()
      .storage.from(bucket)
      .download(path);
    if (error || !data) return null;
    return {
      bytes: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || "application/octet-stream",
    };
  }
  const fullPath = join(STORAGE_ROOT, bucket, path);
  try {
    const bytes = await fs.readFile(fullPath);
    let contentType = "application/octet-stream";
    try {
      const meta = JSON.parse(await fs.readFile(`${fullPath}.meta`, "utf8"));
      if (typeof meta?.contentType === "string") contentType = meta.contentType;
    } catch {
      // meta missing — use default
    }
    return { bytes, contentType };
  } catch {
    return null;
  }
}

export async function removeFromBucket(
  bucket: string,
  path: string,
): Promise<void> {
  if (!isSelfHosted) {
    await supabaseAdmin().storage.from(bucket).remove([path]);
    return;
  }
  const fullPath = join(STORAGE_ROOT, bucket, path);
  await fs.rm(fullPath, { force: true });
  await fs.rm(`${fullPath}.meta`, { force: true });
}
