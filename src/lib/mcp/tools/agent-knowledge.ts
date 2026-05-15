import { supabaseAdmin } from "@/lib/supabase/server";
import { embedOne, toPgVector } from "@/lib/knowledge/embedder";
import { registerTool, text, textError } from "../registry";

/**
 * knowledge_query  -  top-K retrieval over the current agent's uploaded
 * files (rgaios_agent_file_chunks, keyed by agent_id). Called by the
 * agent persona mid-conversation to pull grounded context from files
 * the user dropped into the per-agent panel.
 *
 * Registered in ALL deploy modes (unlike the legacy org-wide
 * list_knowledge_files / read_knowledge_file from tools/knowledge.ts,
 * which are hosted-only). Per-agent RAG is a v3 table shape that does
 * not exist in the self-hosted legacy.
 */

registerTool({
  name: "knowledge_query",
  description:
    "Semantic search over the files the user attached to this agent. " +
    "Returns the top-K most relevant chunks with citations. Use this " +
    "BEFORE answering any question where the user's own material " +
    "(brand voice docs, past scripts, sample emails) should drive the reply.",
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: {
      agent_id: {
        type: "string",
        description:
          "Which agent's files to search. Optional - defaults to the calling agent (ctx.agentId), which is what the chat surface always wants.",
      },
      prompt: { type: "string", description: "Natural-language query." },
      top_k: { type: "number", description: "Chunks to return (default 8, max 20)." },
    },
  },
  handler: async (args, ctx) => {
    // Fall back to the calling agent's id - the chat surface ALWAYS
    // wants "search my own files", and forcing the model to pass
    // agent_id from chat dropped Marti's live test on a circular
    // requirement ("knowledge_query wymaga agent_id którego z tego
    // czatu nie mam jak podać"). ctx.agentId is set by the chat
    // dispatch path (agent-commands.ts MCP-direct branch).
    const agentId = String(args.agent_id ?? ctx.agentId ?? "").trim();
    const prompt = String(args.prompt ?? "").trim();
    const topK = Math.min(Math.max(Number(args.top_k ?? 8) || 8, 1), 20);

    if (!prompt) {
      return textError("prompt is required.");
    }
    if (!agentId) {
      return textError(
        "agent_id could not be derived - this surface did not set ctx.agentId. Provide agent_id explicitly.",
      );
    }

    const db = supabaseAdmin();

    // Cross-tenant guard: the agent must belong to the caller's org.
    const { data: agent } = await db
      .from("rgaios_agents")
      .select("id")
      .eq("id", agentId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!agent) return textError("Agent not found in this organization.");

    let queryVector: number[];
    try {
      queryVector = await embedOne(prompt);
    } catch (err) {
      return textError(
        `Embedding failed: ${(err as Error).message}. Check OPENAI_API_KEY.`,
      );
    }

    // pgvector cosine distance via supabase-js rpc would be cleaner, but
    // we can also do it inline using the <-> operator through a raw SQL
    // call. supabase-js doesn't expose raw SQL on the public API; we use
    // .rpc() against a helper function defined alongside the migration.
    // For v3 we piggy-back on a simple top-K via the HTTP REST API's
    // support for the 'order' modifier with vector ops.
    const { data: rows, error } = await db.rpc("rgaios_match_agent_chunks", {
      p_agent_id: agentId,
      p_organization_id: ctx.organizationId,
      p_query: toPgVector(queryVector),
      p_top_k: topK,
    });

    if (error) {
      return textError(`knowledge_query failed: ${error.message}`);
    }

    const results = (rows ?? []) as Array<{
      chunk_id: string;
      file_id: string;
      filename: string;
      chunk_index: number;
      content: string;
      similarity: number;
    }>;

    if (results.length === 0) {
      return text(
        "No relevant chunks found. The agent may have no files attached, or the query did not match the uploaded content.",
      );
    }

    const lines = [
      `Top ${results.length} chunks for agent ${agentId}:`,
      "",
      ...results.map(
        (r, i) =>
          `[${i + 1}] ${r.filename} (chunk ${r.chunk_index}, similarity ${r.similarity.toFixed(3)}):\n${r.content}`,
      ),
    ];
    return text(lines.join("\n\n"));
  },
});

export const AGENT_KNOWLEDGE_TOOLS_REGISTERED = true;
