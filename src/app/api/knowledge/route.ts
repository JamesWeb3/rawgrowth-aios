import { NextResponse, type NextRequest } from "next/server";
import {
  createKnowledgeFile,
  listKnowledgeFilesForOrg,
} from "@/lib/knowledge/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";
// Allow slightly larger uploads without timing out the function. Keeps MVP simple.
export const maxDuration = 30;

export async function GET() {
  try {
    const organizationId = (await currentOrganizationId());
    const files = await listKnowledgeFilesForOrg(organizationId);
    return NextResponse.json({ files });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/knowledge
 * Multipart form:
 *   - file: File (markdown content)
 *   - title?: string  (defaults to the uploaded filename)
 *   - tags?: comma-separated string  (e.g. "brand-voice,pricing-sheet")
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    // Basic type sniff — accept markdown, plain text, or unknown (we treat as text)
    const allowedMime = new Set([
      "text/markdown",
      "text/plain",
      "application/octet-stream",
      "",
    ]);
    const mimeType = file.type || "text/markdown";
    if (!allowedMime.has(mimeType)) {
      return NextResponse.json(
        { error: `unsupported mime type: ${mimeType}` },
        { status: 400 },
      );
    }

    const maxBytes = 2 * 1024 * 1024; // 2 MB ceiling for MVP
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `file too large (${file.size} > ${maxBytes})` },
        { status: 413 },
      );
    }

    const content = await file.text();
    const title =
      (form.get("title") as string | null)?.trim() ||
      file.name.replace(/\.(md|markdown|txt)$/i, "");
    const tagsRaw = (form.get("tags") as string | null) ?? "";
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const row = await createKnowledgeFile({
      organizationId: (await currentOrganizationId()),
      title,
      tags,
      content,
      mimeType: "text/markdown",
    });
    return NextResponse.json({ file: row }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
