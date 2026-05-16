import { registerTool, text, textError } from "../registry";
import {
  supersedeSharedMemory,
  archiveSharedMemory,
} from "@/lib/memory/shared";

/**
 * Shared-memory hygiene tools (P0-3 M3). The shared-memory table has
 * supersedes_id + archived_at columns for revision history but no path
 * exposed to agents to USE them. Without this tool an agent that learns
 * a fact is wrong ("client moved off Shopify to Webflow") can only ADD
 * the new fact - the old wrong fact stays live in every preamble until
 * an operator manually deletes it.
 *
 *   mark_memory_superseded    archive an old row + insert a fresh
 *                             replacement linked via supersedes_id.
 *   archive_memory            single-row archive when nothing replaces
 *                             it (the fact stopped being true; nothing
 *                             needs to be stated in its place).
 *
 * Both are isWrite=true so the central approval gate (P0-5) covers
 * them. Read paths (listSharedMemoryForAgent) stay open via the chat
 * preamble - no read tool is added here.
 */

registerTool({
  name: "mark_memory_superseded",
  description:
    "Archive an old shared-memory row and replace it with a fresh fact. " +
    "Use when the org learns the previous fact is wrong or stale (vendor " +
    "swap, owner change, policy update). Pass the old row's id from a " +
    "lookup_my_memory result and the corrected fact in the new_fact " +
    "field. The replacement is linked via supersedes_id so audit can " +
    "trace the revision.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      old_row_id: {
        type: "string",
        description: "UUID of the active rgaios_shared_memory row to archive.",
      },
      new_fact: {
        type: "string",
        description: "The corrected fact. Under 600 chars.",
      },
      importance: {
        type: "number",
        description: "Optional 1-5 importance for the new row. Default 3.",
      },
      scope: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional dept slugs the new fact applies to. Empty / 'all' / '*' = org-wide.",
      },
    },
    required: ["old_row_id", "new_fact"],
  },
  handler: async (args, ctx) => {
    const oldRowId = String(args.old_row_id ?? "").trim();
    const newFact = String(args.new_fact ?? "").trim();
    if (!oldRowId) return textError("old_row_id is required");
    if (!newFact) return textError("new_fact is required");

    const importance =
      typeof args.importance === "number" ? args.importance : undefined;
    const scope = Array.isArray(args.scope)
      ? (args.scope as string[])
      : undefined;

    const result = await supersedeSharedMemory({
      orgId: ctx.organizationId,
      oldRowId,
      newFact,
      importance,
      scope,
      sourceAgentId: ctx.agentId ?? null,
      sourceChatId: null,
    });

    if (!result.archivedOldRow) {
      return textError(
        `mark_memory_superseded: old row ${oldRowId} not found in this org.`,
      );
    }
    if (!result.newRow) {
      return textError(
        `mark_memory_superseded: archived ${oldRowId} but replacement insert failed. The org memory is still cleaner than before, but no replacement fact is live.`,
      );
    }
    return text(
      [
        `Memory superseded.`,
        `archived: ${oldRowId}`,
        `replacement: ${result.newRow.id}`,
        `fact: ${result.newRow.fact.slice(0, 180)}`,
      ].join("\n"),
    );
  },
});

registerTool({
  name: "archive_memory",
  description:
    "Stamp archived_at on a shared-memory row when the fact stopped " +
    "being true and there is nothing to state in its place (vendor " +
    "uninstalled, policy revoked). For corrections that need a " +
    "replacement fact use mark_memory_superseded instead.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      row_id: {
        type: "string",
        description: "UUID of the active rgaios_shared_memory row to archive.",
      },
    },
    required: ["row_id"],
  },
  handler: async (args, ctx) => {
    const rowId = String(args.row_id ?? "").trim();
    if (!rowId) return textError("row_id is required");
    await archiveSharedMemory({ orgId: ctx.organizationId, rowId });
    return text(`Memory row ${rowId} archived.`);
  },
});
