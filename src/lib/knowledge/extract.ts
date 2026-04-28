/**
 * Extract plain text from an uploaded file buffer. Supports what the §9.3
 * acceptance test hits: PDF, DOCX, MD, TXT, CSV, and image (image returns
 * empty since Claude handles visual context separately).
 *
 * PDF + DOCX parsing is lazy-loaded so the main bundle does not pay the
 * cost when the runtime is only serving dashboard reads. pdf-parse and
 * mammoth are pulled at request time.
 */

type Extracted = {
  text: string;
  warnings: string[];
};

export async function extractText(
  buf: Buffer,
  mimeType: string,
  filename: string,
): Promise<Extracted> {
  const warnings: string[] = [];
  const lower = filename.toLowerCase();

  if (mimeType.startsWith("text/") || lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".csv")) {
    return { text: buf.toString("utf-8"), warnings };
  }

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    try {
      const pdfParse = (await import("pdf-parse")).default as unknown as (
        input: Buffer,
      ) => Promise<{ text: string }>;
      const out = await pdfParse(buf);
      return { text: out.text, warnings };
    } catch (err) {
      warnings.push(`pdf-parse failed: ${(err as Error).message}`);
      return { text: "", warnings };
    }
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    try {
      const mammoth = (await import("mammoth")) as unknown as {
        extractRawText: (arg: { buffer: Buffer }) => Promise<{ value: string }>;
      };
      const out = await mammoth.extractRawText({ buffer: buf });
      return { text: out.value, warnings };
    } catch (err) {
      warnings.push(`mammoth failed: ${(err as Error).message}`);
      return { text: "", warnings };
    }
  }

  if (mimeType.startsWith("image/")) {
    warnings.push("image upload stored without text extraction");
    return { text: "", warnings };
  }

  warnings.push(`unsupported mime type ${mimeType}`);
  return { text: "", warnings };
}
