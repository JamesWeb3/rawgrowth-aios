import { NextResponse, type NextRequest } from "next/server";
import { readFromBucket } from "@/lib/storage/local";

export const runtime = "nodejs";

/**
 * GET /api/storage/[bucket]/[...path]
 *
 * Serves bytes uploaded via the local storage adapter (self-hosted
 * mode only; on hosted the publicUrl points at Supabase Storage CDN
 * directly so this route is never hit).
 *
 * Anyone with the URL can read — same as a Supabase Storage public
 * bucket. Don't put anything sensitive behind it.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> },
) {
  const { bucket, path } = await params;
  const fullPath = (path ?? []).join("/");
  const result = await readFromBucket(bucket, fullPath);
  if (!result) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(result.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      "cache-control": "public, max-age=300",
    },
  });
}
