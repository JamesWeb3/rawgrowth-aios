import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * MCP prompts layer  -  turns the org's active routines into prompts Claude
 * Code (or any MCP client) can pick from. Each prompt's `text` embeds:
 *
 *   • the routine's description/instructions
 *   • the id of the oldest pending run (if any) so Claude can claim it
 *   • a reminder of the two-step complete/fail tool calls
 *
 * Prompts are generated per-request from the DB  -  no in-memory registry,
 * no caching, so routine edits reflect immediately.
 */

export type McpPrompt = {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
};

export type McpPromptMessage = {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
};

function slugForName(routineId: string, title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `routine.${base || routineId.slice(0, 8)}`;
}

export async function listPromptsForOrg(
  organizationId: string,
): Promise<McpPrompt[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_routines")
    .select("id, title, description, status")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) return [];

  return (data ?? []).map((r) => ({
    name: slugForName(r.id, r.title),
    description: (r.description ?? r.title).slice(0, 180),
  }));
}

export async function getPromptForOrg(
  organizationId: string,
  promptName: string,
): Promise<{
  description: string;
  messages: McpPromptMessage[];
} | null> {
  const { data: routines, error } = await supabaseAdmin()
    .from("rgaios_routines")
    .select("id, title, description")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  if (error || !routines) return null;

  const match = routines.find((r) => slugForName(r.id, r.title) === promptName);
  if (!match) return null;

  // Surface the oldest pending run so Claude can claim it directly.
  const { data: pending } = await supabaseAdmin()
    .from("rgaios_routine_runs")
    .select("id, source, input_payload, created_at")
    .eq("organization_id", organizationId)
    .eq("routine_id", match.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const pendingBlock = pending
    ? [
        "A pending run is already queued:",
        `- run_id: \`${pending.id}\``,
        `- source: ${pending.source}`,
        `- queued: ${pending.created_at}`,
        "",
        pending.input_payload && Object.keys(pending.input_payload).length > 0
          ? "Input payload:\n```json\n" +
            JSON.stringify(pending.input_payload, null, 2) +
            "\n```"
          : "(no input payload)",
        "",
        "Call `runs_claim` with that run_id before doing any work, and call `runs_complete` when finished.",
      ].join("\n")
    : "No pending run is queued. Create one by doing the work directly and calling the MCP `runs_complete` tool with a new run_id if you want it tracked, or skip tracking.";

  const text = [
    `You are executing the routine: **${match.title}**.`,
    "",
    "## Instructions",
    match.description ?? "(no instructions recorded)",
    "",
    "## Run handling",
    pendingBlock,
  ].join("\n");

  return {
    description: (match.description ?? match.title).slice(0, 180),
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}
