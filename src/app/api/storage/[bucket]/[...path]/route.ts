import { NextResponse, type NextRequest } from "next/server";
import { readFromBucket } from "@/lib/storage/local";
import { getOrgContext } from "@/lib/auth/admin";

export const runtime = "nodejs";

/**
 * GET /api/storage/[bucket]/[...path]
 *
 * Serves bytes uploaded via the local storage adapter (self-hosted
 * mode only; on hosted the publicUrl points at Supabase Storage CDN
 * directly so this route is never hit).
 *
 * Two guards (security audit C2 + H1):
 *   - Path traversal: refuse any segment that contains "..", a leading
 *     "/" or a backslash. Without this, a request like
 *     /api/storage/agent-files/..%2F..%2F..%2Fetc%2Fpasswd would
 *     resolve through `path.join` and escape STORAGE_ROOT.
 *   - Org gate: every uploader writes under `${orgId}/...` (see
 *     src/app/api/files/upload/route.ts and brand-docs/upload). Refuse
 *     any read where the first segment doesn't match the caller's
 *     active org id. Admin impersonation cookie still flips the
 *     active org via getOrgContext, so support sessions just work.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> },
) {
  const { bucket, path } = await params;
  const segments = path ?? [];

  for (const seg of segments) {
    if (
      !seg ||
      seg === ".." ||
      seg === "." ||
      seg.includes("/") ||
      seg.includes("\\") ||
      seg.includes("\0")
    ) {
      return new NextResponse("Bad path", { status: 400 });
    }
  }
  // Reject bucket value with traversal too (the dynamic segment is a
  // single string but a literal ".." would still be honored by join).
  if (
    !bucket ||
    bucket === ".." ||
    bucket === "." ||
    bucket.includes("/") ||
    bucket.includes("\\") ||
    bucket.includes("\0")
  ) {
    return new NextResponse("Bad bucket", { status: 400 });
  }

  // Org gate. Path layout is `${orgId}/...` for every uploader in this
  // codebase. If the first segment doesn't match the caller's active
  // org, refuse — even though UUID names are unguessable, defense-in
  // -depth keeps an info-disclosure elsewhere from chaining into a
  // cross-tenant file read.
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (segments[0] !== ctx.activeOrgId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const fullPath = segments.join("/");
  const result = await readFromBucket(bucket, fullPath);
  if (!result) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(result.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      // Was `public, max-age=300` — stale Cloudflare/CDN caches were
      // serving cached bytes to other org members. Switch to private
      // since the route now requires auth.
      "cache-control": "private, max-age=300",
    },
  });
}
