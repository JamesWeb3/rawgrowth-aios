import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/data/recent
 *
 * Returns the last ~20 manual paste entries + uploaded files from this
 * org's company corpus. Drives the "Recently indexed" rail on /data so
 * the operator can see what's already in there before pasting.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const [pastes, files] = await Promise.all([
    db
      .from("rgaios_audit_log")
      .select("id, detail, ts")
      .eq("organization_id", orgId)
      .eq("kind", "data_ingested")
      .order("ts", { ascending: false })
      .limit(15),
    db
      .from("rgaios_knowledge_files")
      .select("id, title, mime_type, size_bytes, uploaded_at")
      .eq("organization_id", orgId)
      .order("uploaded_at", { ascending: false })
      .limit(15),
  ]);

  type AuditRow = {
    id: string;
    detail: Record<string, unknown> | null;
    // rgaios_audit_log timestamps the row with `ts`, not `created_at`.
    ts: string;
  };
  type FileRow = {
    id: string;
    title: string;
    mime_type: string | null;
    size_bytes: number | null;
    uploaded_at: string;
  };

  const pasteEntries = ((pastes.data ?? []) as AuditRow[]).map((r) => {
    const d = r.detail ?? {};
    return {
      kind: "paste" as const,
      id: r.id,
      label:
        ((d as { label?: string }).label ?? "manual entry") as string,
      source: ((d as { source?: string }).source ?? "manual_entry") as string,
      chunks: ((d as { chunks?: number }).chunks ?? 0) as number,
      tokens: ((d as { tokens?: number }).tokens ?? 0) as number,
      created_at: r.ts,
    };
  });

  const fileEntries = ((files.data ?? []) as FileRow[]).map((r) => ({
    kind: "file" as const,
    id: r.id,
    label: r.title,
    source: r.mime_type ?? "file",
    size_bytes: r.size_bytes,
    created_at: r.uploaded_at,
  }));

  const merged = [...pasteEntries, ...fileEntries]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 25);

  return NextResponse.json({ entries: merged });
}
