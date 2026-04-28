import {
  getKnowledgeFile,
  listKnowledgeFilesForOrg,
  readKnowledgeFileContent,
} from "@/lib/knowledge/queries";
import { registerTool, text, textError } from "../registry";
import { isSelfHosted } from "@/lib/deploy-mode";

/**
 * Knowledge tools  -  read from the org's uploaded markdown files.
 *
 * Only registered in HOSTED mode. Self-hosted clients drag local files
 * into Claude Code's context directly, so we don't need Supabase Storage.
 */

// Skip registration entirely in self-hosted; the rest of this file is dead code there.
if (isSelfHosted) {
  // The file still loads (for module-import side-effects in tools/index.ts),
  // but no tools are registered, so MCP /tools/list won't expose them.
} else {

registerTool({
  name: "list_knowledge_files",
  description:
    "List the organization's uploaded knowledge files (markdown playbooks, SOPs, brand docs). Optionally filter by tags.",
  inputSchema: {
    type: "object",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Only return files that have all of these tags (e.g. ['brand-voice']).",
      },
    },
  },
  handler: async (args, ctx) => {
    const rawTags = args.tags;
    const filterTags: string[] = Array.isArray(rawTags)
      ? rawTags.map(String)
      : [];

    const files = await listKnowledgeFilesForOrg(ctx.organizationId);
    const filtered = filterTags.length
      ? files.filter((f) => filterTags.every((t) => f.tags.includes(t)))
      : files;

    if (filtered.length === 0) {
      return text(
        filterTags.length
          ? `No knowledge files match tags: ${filterTags.join(", ")}`
          : "No knowledge files uploaded yet.",
      );
    }

    const lines = [
      `Found ${filtered.length} knowledge file(s):`,
      "",
      ...filtered.map(
        (f) =>
          `- **${f.title}**  -  id: \`${f.id}\`${
            f.tags.length ? ` · tags: ${f.tags.join(", ")}` : ""
          } · ${new Date(f.uploaded_at).toLocaleDateString()}`,
      ),
    ];
    return text(lines.join("\n"));
  },
});

registerTool({
  name: "read_knowledge_file",
  description:
    "Fetch the full markdown content of a specific knowledge file by id.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Knowledge file id" },
    },
    required: ["id"],
  },
  handler: async (args, ctx) => {
    const id = String(args.id ?? "").trim();
    if (!id) return textError("id is required");

    const file = await getKnowledgeFile(ctx.organizationId, id);
    if (!file) return textError(`Knowledge file ${id} not found`);

    const content = file.storage_path
      ? await readKnowledgeFileContent(file.storage_path)
      : "";

    return text(
      [
        `# ${file.title}`,
        file.tags.length ? `*Tags: ${file.tags.join(", ")}*` : "",
        "",
        "---",
        "",
        content || "_(empty)_",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
});

} // end !isSelfHosted
