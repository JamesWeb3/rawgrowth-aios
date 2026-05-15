import { supabaseAdmin } from "@/lib/supabase/server";
import { matchCompanyChunks } from "@/lib/knowledge/company-corpus";
import { BANNED_WORDS } from "@/lib/brand/tokens";
import { registerTool, text, textError } from "../registry";

/**
 * Agent self-context tools. The chatReply preamble in src/lib/agent/preamble.ts
 * used to stuff the entire brand profile, every retrieved RAG chunk and
 * the file inventory into every turn. On long sessions that hits the
 * Anthropic input rate limit before the model even thinks.
 *
 * These three tools let the agent pull each piece on demand instead.
 * The preamble keeps a tiny "table of contents" (length, top filenames,
 * one-sentence voice hint) and points the model at the tool when it
 * needs the full thing.
 *
 *   lookup_brand_voice      → tone markdown + frozen banned-words list
 *                              + framework headings parsed from the profile
 *   lookup_my_files         → list of files attached to a specific agent,
 *                              one-line summary each
 *   lookup_company_fact     → semantic search across the company corpus
 *                              (intake / brand / scrape / sales calls)
 *
 * All three are read-only, scoped by ctx.organizationId, and safe to
 * expose on every agent surface that already lists MCP tools.
 */

// ─── lookup_brand_voice ────────────────────────────────────────────

/**
 * Pull the latest approved brand profile for the org and return
 * (a) the raw voice / tone section if we can find one, (b) the
 * 11-word banned-words list (frozen, sourced from src/lib/brand/tokens.ts
 * and enforced at build + runtime), and (c) any framework-style headings
 * the profile mentions (parsed by markdown-heading sniffing - good
 * enough for surfacing names without re-embedding the whole doc).
 */
registerTool({
  name: "lookup_brand_voice",
  description:
    "Fetch this organisation's brand voice details on demand: the " +
    "approved voice + tone markdown, the frozen banned-words list, " +
    "and the names of any frameworks documented in the brand profile. " +
    "Call this when you need to write copy in the client's voice or " +
    "double-check whether a phrase is allowed - the chat preamble only " +
    "carries a short summary to keep input tokens low.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async (_args, ctx) => {
    const { data, error } = await supabaseAdmin()
      .from("rgaios_brand_profiles")
      .select("content, version, generated_at, status")
      .eq("organization_id", ctx.organizationId)
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return textError(`lookup_brand_voice failed: ${error.message}`);
    }

    const row = data as
      | { content: string | null; version: number | null }
      | null;
    const content = row?.content?.trim() ?? "";

    if (!content) {
      return text(
        "No approved brand profile yet. Banned words still apply:\n" +
          BANNED_WORDS.map((w) => `  - ${w}`).join("\n"),
      );
    }

    // Heuristic voice extraction: pull any block whose heading matches
    // /voice|tone|style/ (case-insensitive). Markdown headings only -
    // the brand-profile generator sticks to them. Falls back to the
    // first 2k characters of the doc if no voice heading is found,
    // which is still way better than dumping the whole thing inline.
    const voiceMd = extractSection(content, /(voice|tone|style)/i) ??
      content.slice(0, 2000);

    // Framework names = any heading that contains "framework" or
    // matches a known short list pattern. Best-effort - returns [] if
    // none found, which is fine.
    const frameworks = listHeadings(content)
      .filter((h) =>
        /(framework|method|playbook|system|formula)/i.test(h),
      )
      .slice(0, 12);

    const lines = [
      `Brand voice (profile v${row?.version ?? "?"}):`,
      "",
      voiceMd,
      "",
      `Banned words (${BANNED_WORDS.length} total - never use):`,
      ...BANNED_WORDS.map((w) => `  - ${w}`),
    ];
    if (frameworks.length > 0) {
      lines.push(
        "",
        "Frameworks documented in this profile (call lookup_company_fact for details on any one):",
        ...frameworks.map((f) => `  - ${f}`),
      );
    }
    return text(lines.join("\n"));
  },
});

// ─── lookup_my_files ───────────────────────────────────────────────

/**
 * List every file attached to a specific agent. Returns filename +
 * a one-line summary built from the first non-empty content chunk
 * (truncated to ~140 chars) so the agent can decide whether to call
 * knowledge_query for the full body.
 *
 * The chat preamble used to enumerate the whole file list on every
 * turn; this tool replaces that for everything past the first 5
 * filenames.
 */
registerTool({
  name: "lookup_my_files",
  description:
    "List every file attached to a given agent with a one-line " +
    "summary per file. Use this when you need to know what " +
    "reference material you have access to before deciding to call " +
    "knowledge_query for the full text of one. The chat preamble " +
    "only includes a count plus the 5 most recent filenames to save " +
    "input tokens.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      agent_id: {
        type: "string",
        description:
          "The agent whose files you want listed. Optional - defaults to the calling agent (ctx.agentId), which is what chat surfaces always want.",
      },
    },
  },
  handler: async (args, ctx) => {
    // Same ctx.agentId fallback as knowledge_query - Marti's live
    // test surfaced this circular requirement on both tools.
    const agentId = String(args.agent_id ?? ctx.agentId ?? "").trim();
    if (!agentId) {
      return textError(
        "agent_id could not be derived - this surface did not set ctx.agentId. Provide agent_id explicitly.",
      );
    }

    const db = supabaseAdmin();

    // Cross-tenant guard. Service-role bypasses RLS so we re-check
    // the agent belongs to the caller's org explicitly.
    const { data: agent } = await db
      .from("rgaios_agents")
      .select("id, name")
      .eq("id", agentId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!agent) return textError("Agent not found in this organization.");

    const { data: files, error } = await db
      .from("rgaios_agent_files")
      .select("id, filename, mime_type, size_bytes, uploaded_at")
      .eq("organization_id", ctx.organizationId)
      .eq("agent_id", agentId)
      .order("uploaded_at", { ascending: false });

    if (error) {
      return textError(`lookup_my_files failed: ${error.message}`);
    }

    const fileRows = (files ?? []) as Array<{
      id: string;
      filename: string;
      mime_type: string | null;
      size_bytes: number | null;
      uploaded_at: string;
    }>;

    if (fileRows.length === 0) {
      return text(
        `No files attached to agent ${agentId}. Upload some via the agent panel and re-run this tool.`,
      );
    }

    // Pull the first chunk of each file in one round-trip. We grab
    // chunk_index = 0 only because that's almost always the doc
    // intro / first paragraph - good enough for a summary line.
    const fileIds = fileRows.map((f) => f.id);
    const { data: firstChunks } = await db
      .from("rgaios_agent_file_chunks")
      .select("file_id, content")
      .in("file_id", fileIds)
      .eq("chunk_index", 0);
    const summaryByFile = new Map<string, string>();
    for (const c of (firstChunks ?? []) as Array<{
      file_id: string;
      content: string | null;
    }>) {
      const summary = (c.content ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 140);
      if (summary) summaryByFile.set(c.file_id, summary);
    }

    const lines = [
      `Agent ${(agent as { name?: string } | null)?.name ?? agentId} has ${fileRows.length} file${
        fileRows.length === 1 ? "" : "s"
      } attached:`,
      "",
      ...fileRows.map((f, i) => {
        const summary = summaryByFile.get(f.id) ?? "(no preview available)";
        return `${i + 1}. ${f.filename}\n   ${summary}`;
      }),
      "",
      "Need the full text of one? Call knowledge_query with the filename in the prompt.",
    ];
    return text(lines.join("\n"));
  },
});

// ─── lookup_company_fact ───────────────────────────────────────────

/**
 * Semantic search over the cross-source company corpus. Thin wrapper
 * around matchCompanyChunks (same RPC the legacy `company_query` tool
 * uses) but hard-capped at top-3 + tuned for the on-demand use-case:
 * the preamble already injects the top-1 chunk if the similarity is
 * high enough, so this tool exists for the cases where the model
 * needs more depth or a different angle than the prefetched hit.
 */
registerTool({
  name: "lookup_company_fact",
  description:
    "Semantic search across the company corpus (intake answers, " +
    "brand profile, scraped pages, onboarding docs, sales calls) " +
    "and return the top 3 most relevant chunks with source labels. " +
    "Call this whenever you need a specific fact about the client's " +
    "business that wasn't surfaced in the chat preamble - pricing, " +
    "ICP details, past scripts, anything that's part of their record.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "Natural-language search prompt.",
      },
    },
  },
  handler: async (args, ctx) => {
    const query = String(args.query ?? "").trim();
    if (!query) return textError("query is required.");

    let matches;
    try {
      matches = await matchCompanyChunks(ctx.organizationId, query, 3);
    } catch (err) {
      return textError(
        `lookup_company_fact failed: ${(err as Error).message}`,
      );
    }

    if (matches.length === 0) {
      return text(
        `No matches in the company corpus for: ${query}\n\nThe corpus may be empty or your query did not cross the similarity floor. Try rephrasing.`,
      );
    }

    const lines = [
      `Top ${matches.length} match${matches.length === 1 ? "" : "es"} for: ${query}`,
      "",
      ...matches.map((m, i) => {
        const score = (m.similarity * 100).toFixed(1);
        const head = `[${i + 1}] ${m.source} - similarity ${score}%`;
        const body = m.chunkText.slice(0, 600).replace(/\n+/g, " ");
        return `${head}\n${body}`;
      }),
    ];
    return text(lines.join("\n"));
  },
});

export const AGENT_CONTEXT_TOOLS_REGISTERED = true;

// ─── helpers (file-local) ──────────────────────────────────────────

/**
 * Return all level-2/3 markdown headings in `md` (lines starting with
 * `## ` or `### `). Used to surface framework names without parsing
 * the full doc.
 */
function listHeadings(md: string): string[] {
  const headings: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (m) headings.push(m[1]);
  }
  return headings;
}

/**
 * Pull the body of the first markdown section whose heading matches
 * `headingMatcher`. Returns the section text (without the heading
 * itself), trimmed, or null if no match.
 *
 * "Section" = everything from the matched heading line down to the
 * next heading line of equal or shallower depth, capped at 2000 chars
 * so a runaway block doesn't undo the input-token savings.
 */
function extractSection(
  md: string,
  headingMatcher: RegExp,
): string | null {
  const lines = md.split(/\r?\n/);
  let startIdx = -1;
  let startDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (m && headingMatcher.test(m[2])) {
      startIdx = i + 1;
      startDepth = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= startDepth) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n").trim().slice(0, 2000) || null;
}
