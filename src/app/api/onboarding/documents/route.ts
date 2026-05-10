import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

// Accepts only the document classes we surface in the onboarding UI.
// Anything else (arbitrary client-supplied label) gets coerced to "other"
// so the audit row can't carry a free-form string into downstream
// renderers. Mirrors brand-docs/upload's allowlist.
const ALLOWED_TYPES = new Set([
  "logo",
  "guideline",
  "asset",
  "brief",
  "transcript",
  "other",
]);

// Onboarding bucket is "brand-docs" today (see brand-docs/upload/route.ts).
// We accept either Supabase Storage's `/storage/v1/object/...` shape OR
// the self-hosted `/api/storage/<bucket>/...` shape. Both must include
// the bucket name AND the caller's org id in the path so a forged URL
// pointing at another org's bucket / folder can't get persisted.
const ONBOARDING_BUCKET = "brand-docs";

function isValidStorageUrl(rawUrl: unknown, orgId: string): boolean {
  if (typeof rawUrl !== "string" || !rawUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const cloudPrefix = `/storage/v1/object/public/${ONBOARDING_BUCKET}/${orgId}/`;
  const cloudSignedPrefix = `/storage/v1/object/sign/${ONBOARDING_BUCKET}/${orgId}/`;
  const localPrefix = `/api/storage/${ONBOARDING_BUCKET}/${orgId}/`;
  return (
    parsed.pathname.includes(cloudPrefix) ||
    parsed.pathname.includes(cloudSignedPrefix) ||
    parsed.pathname.includes(localPrefix)
  );
}

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = { id: ctx.activeOrgId, userId: ctx.userId };

    const { data: documents } = await supabaseAdmin()
      .from("rgaios_onboarding_documents")
      .select("*")
      .eq("organization_id", user.id);

    return NextResponse.json({ documents: documents || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = { id: ctx.activeOrgId, userId: ctx.userId };

    const { type, storage_url, filename, size } = await req.json();

    // Reject arbitrary type labels - downstream consumers (onboarding UI,
    // RAG ingest classifier) branch on this string. Coercing unknown to
    // "other" keeps it bounded.
    const safeType =
      typeof type === "string" && ALLOWED_TYPES.has(type) ? type : "other";

    // Reject client-supplied URLs that don't match the expected
    // bucket+org prefix. Without this, an operator can post any string
    // (phishing link, another org's signed URL) and have it surfaced
    // through the onboarding UI as an attested upload.
    if (!isValidStorageUrl(storage_url, user.id)) {
      return NextResponse.json(
        {
          error:
            "storage_url must point at this org's onboarding bucket - upload via /api/onboarding/brand-docs/upload first",
        },
        { status: 400 },
      );
    }

    // Cap filename + size sanity. supabase row would still accept
    // pathological values, but unbounded user strings have a habit of
    // showing up in logs / exports / chat preambles later.
    const safeFilename =
      typeof filename === "string" ? filename.slice(0, 300) : "untitled";
    const safeSize =
      typeof size === "number" && Number.isFinite(size) && size >= 0
        ? Math.min(size, 200 * 1024 * 1024)
        : 0;

    const { data: doc, error } = await supabaseAdmin()
      .from("rgaios_onboarding_documents")
      .insert({
        organization_id: user.id,
        type: safeType,
        storage_url,
        filename: safeFilename,
        size: safeSize,
      } as never)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ document: doc });
  } catch (err: unknown) {
    console.error("Document save error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
