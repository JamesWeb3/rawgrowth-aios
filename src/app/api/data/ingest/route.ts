import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { ingestCompanyChunk } from "@/lib/knowledge/company-corpus";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/data/ingest
 *
 * Manual data entry into the company corpus. The operator pastes
 * structured data (CRM contact, deal, note, or arbitrary text) and
 * we chunk + embed it into rgaios_company_chunks so every agent can
 * search/cite it via the company_corpus RAG path.
 *
 * Body: { source: "crm_contact" | "crm_deal" | "note" | "other",
 *         label: string, text: string, metadata?: object }
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    source?: string;
    label?: string;
    text?: string;
    metadata?: Record<string, unknown>;
  };

  const text = body.text?.trim();
  if (!text || text.length < 10) {
    return NextResponse.json(
      { error: "text is required (10+ chars)" },
      { status: 400 },
    );
  }
  const source = body.source ?? "manual_entry";
  const label = body.label?.trim() ?? "manual entry";

  const result = await ingestCompanyChunk({
    orgId: ctx.activeOrgId,
    source,
    sourceId: null,
    text,
    metadata: {
      label,
      entered_by: ctx.userId ?? "unknown",
      entered_at: new Date().toISOString(),
      ...(body.metadata ?? {}),
    },
  });

  await supabaseAdmin().from("rgaios_audit_log").insert({
    organization_id: ctx.activeOrgId,
    kind: "data_ingested",
    actor_type: "user",
    actor_id: ctx.userId ?? "unknown",
    detail: {
      source,
      label,
      chunks: result.chunkCount,
      tokens: result.tokenCount,
    },
  } as never);

  return NextResponse.json({
    ok: true,
    chunks: result.chunkCount,
    tokens: result.tokenCount,
  });
}
