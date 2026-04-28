/**
 * Recursive text splitter. Produces chunks no larger than CHUNK_SIZE,
 * preferring boundaries in this order: paragraph break → sentence break →
 * whitespace → hard cut.
 *
 * Chars-based (not tokens) so it has no OpenAI dep and never estimates
 * wrong. 900 chars ≈ 225 tokens on English prose, which is comfortable
 * inside text-embedding-3-large's 8k context.
 *
 * Adapted from the LangChain TS RecursiveCharacterTextSplitter pattern,
 * rewritten minimally so we avoid a 200KB dependency for a 60-line function.
 */

const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 120;

const SPLITTERS = ["\n\n", "\n", ". ", " ", ""] as const;

function splitAt(text: string, sep: string): string[] {
  if (sep === "") {
    // Hard cut. Last resort.
    const out: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      out.push(text.slice(i, i + CHUNK_SIZE));
    }
    return out;
  }
  const parts = text.split(sep);
  // Preserve the separator on every part except the last so concat still
  // reproduces the original (approximately) and chunks read naturally.
  return parts.map((p, i) => (i < parts.length - 1 ? p + sep : p));
}

function splitRecursive(text: string, seps: readonly string[]): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const [head, ...rest] = seps;
  const parts = splitAt(text, head).filter((p) => p.length > 0);
  const out: string[] = [];
  let buffer = "";
  for (const p of parts) {
    if (buffer.length + p.length <= CHUNK_SIZE) {
      buffer += p;
      continue;
    }
    if (buffer) out.push(buffer);
    if (p.length > CHUNK_SIZE) {
      if (rest.length === 0) {
        // Last splitter; hard cut.
        for (const piece of splitAt(p, "")) out.push(piece);
      } else {
        for (const piece of splitRecursive(p, rest)) out.push(piece);
      }
      buffer = "";
    } else {
      buffer = p;
    }
  }
  if (buffer) out.push(buffer);
  return out;
}

/**
 * Overlap stitches CHUNK_OVERLAP characters from the end of the previous
 * chunk onto the start of the next, so a fact that straddles a boundary
 * still gets embedded with full context in at least one chunk.
 */
function applyOverlap(chunks: string[]): string[] {
  if (chunks.length < 2) return chunks;
  const out: string[] = [chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    const tail = out[i - 1].slice(-CHUNK_OVERLAP);
    out.push(tail + chunks[i]);
  }
  return out;
}

export type Chunk = {
  index: number;
  content: string;
};

export function chunkText(text: string): Chunk[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  const raw = splitRecursive(cleaned, SPLITTERS);
  const overlapped = applyOverlap(raw);
  return overlapped.map((content, index) => ({ index, content }));
}
