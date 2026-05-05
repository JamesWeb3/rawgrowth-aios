import { redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { FilesClient, type FileRow, type BrandProfileRow } from "./Client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Files - Rawgrowth",
};

/**
 * Unified /files view (Chris May 4 feedback). Replaces the old /brand and
 * /knowledge pages with a single "drop your stuff in here" surface,
 * organised by bucket so brand assets, content drafts, and per-department
 * docs live side by side. The legacy /brand page is still reachable from
 * the header for editing the generated brand profile markdown.
 */
export default async function FilesPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const orgId = ctx.activeOrgId;

  const db = supabaseAdmin();

  const [{ data: filesRaw }, { data: brandProfile }] = await Promise.all([
    db
      .from("rgaios_knowledge_files")
      .select(
        "id, title, tags, storage_path, mime_type, size_bytes, uploaded_at, bucket",
      )
      .eq("organization_id", orgId)
      .order("uploaded_at", { ascending: false }),
    db
      .from("rgaios_brand_profiles")
      .select("id, version, status, generated_at, approved_at")
      .eq("organization_id", orgId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const files: FileRow[] = (filesRaw ?? []).map((f) => ({
    id: f.id,
    title: f.title,
    tags: f.tags ?? [],
    storage_path: f.storage_path,
    mime_type: f.mime_type,
    size_bytes: f.size_bytes,
    uploaded_at: f.uploaded_at,
    bucket: (f.bucket ?? "other") as FileRow["bucket"],
  }));

  const profile: BrandProfileRow | null = brandProfile
    ? {
        id: brandProfile.id,
        version: brandProfile.version,
        status: brandProfile.status,
        generated_at: brandProfile.generated_at,
        approved_at: brandProfile.approved_at,
      }
    : null;

  return (
    <PageShell
      title="Files"
      description="Drop in logos, palettes, brand profiles, content drafts, and per-department docs. Agents can read text files; binary assets are kept for your team."
    >
      <FilesClient initialFiles={files} brandProfile={profile} />
    </PageShell>
  );
}
