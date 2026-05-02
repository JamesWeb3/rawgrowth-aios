import { NextResponse, type NextRequest } from "next/server";
import {
  deleteKnowledgeFile,
  getKnowledgeFile,
  readKnowledgeFileContent,
  updateKnowledgeFileTags,
} from "@/lib/knowledge/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { deleteCompanyChunksFor } from "@/lib/knowledge/company-corpus";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const organizationId = (await currentOrganizationId());
    const row = await getKnowledgeFile(organizationId, id);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    const content = row.storage_path
      ? await readKnowledgeFileContent(row.storage_path)
      : "";
    return NextResponse.json({ file: row, content });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const orgId = await currentOrganizationId();
    await deleteKnowledgeFile(orgId, id);
    // Clean up the corpus chunks too. company_chunks has no FK back to
    // knowledge_files, so without this they orphan and keep polluting
    // RAG forever. Best-effort.
    try {
      await deleteCompanyChunksFor({
        orgId,
        source: "knowledge_file",
        sourceId: id,
      });
    } catch (err) {
      console.warn("[knowledge] corpus cleanup failed:", (err as Error).message);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { tags?: string[] };
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ error: "tags[] required" }, { status: 400 });
    }
    const row = await updateKnowledgeFileTags(
      (await currentOrganizationId()),
      id,
      body.tags.map((t) => String(t).trim()).filter(Boolean),
    );
    return NextResponse.json({ file: row });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
