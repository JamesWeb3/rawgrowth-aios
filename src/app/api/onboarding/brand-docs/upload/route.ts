import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { uploadToBucket, removeFromBucket } from "@/lib/storage/local";

const ALLOWED_TYPES = new Set(["logo", "guideline", "asset", "other"]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const BUCKET = "brand-docs";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = ctx.activeOrgId;

    const form = await req.formData();
    const file = form.get("file");
    const rawType = String(form.get("type") || "other");
    const type = ALLOWED_TYPES.has(rawType) ? rawType : "other";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large (max 25 MB)" },
        { status: 413 }
      );
    }

    // Store under the user's folder for clean isolation.
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${orgId}/${type}/${Date.now()}-${safeName}`;

    const bytes = Buffer.from(await file.arrayBuffer());
    let publicUrl: string;
    try {
      const upload = await uploadToBucket(
        BUCKET,
        path,
        bytes,
        file.type || "application/octet-stream",
      );
      publicUrl = upload.publicUrl;
    } catch (err) {
      console.error("[brand-docs/upload] storage error:", err);
      return NextResponse.json(
        { error: (err as Error).message ?? "storage failure" },
        { status: 500 },
      );
    }

    const { data: doc, error: insertErr } = await supabaseAdmin()
      .from("rgaios_onboarding_documents")
      .insert({
        organization_id: orgId,
        type,
        storage_url: publicUrl,
        filename: file.name,
        size: file.size,
      })
      .select("id, type, storage_url, filename, size, created_at")
      .single();

    if (insertErr) {
      console.error("[brand-docs/upload] insert error:", insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ document: doc });
  } catch (err: unknown) {
    console.error("[brand-docs/upload] error:", err);
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

    const { data: documents } = await supabaseAdmin()
      .from("rgaios_onboarding_documents")
      .select("id, type, storage_url, filename, size, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    return NextResponse.json({ documents: documents ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = ctx.activeOrgId;

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // Only allow the owner to delete.
    const { data: doc } = await supabaseAdmin()
      .from("rgaios_onboarding_documents")
      .select("id, organization_id, storage_url")
      .eq("id", id)
      .maybeSingle();
    if (!doc || doc.organization_id !== orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Match either Supabase Storage public URL or self-hosted local URL.
    const url = String(doc.storage_url || "");
    const cloudPrefix = `/storage/v1/object/public/${BUCKET}/`;
    const localPrefix = `/api/storage/${BUCKET}/`;
    const path = url.includes(cloudPrefix)
      ? url.split(cloudPrefix)[1]
      : url.includes(localPrefix)
        ? url.split(localPrefix)[1]
        : null;
    if (path) {
      await removeFromBucket(BUCKET, path);
    }

    await supabaseAdmin().from("rgaios_onboarding_documents").delete().eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
