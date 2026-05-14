import { supabaseAdmin } from "@/lib/supabase/server";
import { createAgent, deleteAgent } from "@/lib/agents/queries";
import { DEFAULT_AGENT_RUNTIME, type AgentRole } from "@/lib/agents/constants";

/**
 * `<agent>` block extraction. Lets Atlas (and any dept-head with the
 * authority) re-org the SUB-AGENT layer in conversation. Pedro's hard
 * rule: agents may NOT create or destroy department heads. Only
 * sub-agents (reports_to set, is_department_head=false).
 *
 * Block format the agent emits in chat:
 *
 *   <agent action="create" name="..." reports_to="<head-name>" role="..." description="...">
 *   </agent>
 *
 *   <agent action="archive" name="<sub-agent-name>">
 *   </agent>
 *
 *   <agent action="update" name="<sub-agent-name>" description="...">
 *   </agent>
 *
 * The route handler calls `extractAndApplyAgentBlocks` after the chat
 * reply lands. Failures are logged and surfaced inline as system
 * messages.
 */

export type AgentBlockResult = {
  ok: boolean;
  action: "create" | "archive" | "update";
  name: string;
  message: string;
  agentId?: string;
};

const AGENT_BLOCK_RE =
  /<agent\b([^>]*)>([\s\S]*?)<\/agent>/gi;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  for (const m of raw.matchAll(re)) {
    out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

type TargetAgent = {
  id: string;
  is_department_head: boolean | null;
  name: string;
};

/** Resolve an existing agent by case-insensitive name within the org. */
async function resolveTargetAgent(
  db: ReturnType<typeof supabaseAdmin>,
  orgId: string,
  name: string,
): Promise<TargetAgent | null> {
  const { data } = await db
    .from("rgaios_agents")
    .select("id, is_department_head, name")
    .eq("organization_id", orgId)
    .ilike("name", name)
    .maybeSingle();
  return data as TargetAgent | null;
}

export async function extractAndApplyAgentBlocks(input: {
  orgId: string;
  speakerAgentId: string;
  reply: string;
}): Promise<AgentBlockResult[]> {
  const { orgId, speakerAgentId, reply } = input;
  const matches = [...reply.matchAll(AGENT_BLOCK_RE)];
  if (matches.length === 0) return [];

  const db = supabaseAdmin();

  // Speaker authority check: only the CEO/Atlas role or department
  // heads may CRUD sub-agents. Plain sub-agents trying to spawn more
  // sub-agents would fan out chaotically; reject silently with a log.
  const { data: speaker } = await db
    .from("rgaios_agents")
    .select("role, is_department_head, name")
    .eq("id", speakerAgentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const sp = speaker as {
    role: string | null;
    is_department_head: boolean | null;
    name: string;
  } | null;
  if (!sp) return [];
  const isAtlas = sp.role === "ceo";
  const isHead = sp.is_department_head === true;
  if (!isAtlas && !isHead) {
    console.warn(
      `[agent-blocks] ${sp.name} is not authorised to CRUD agents (role=${sp.role}, head=${sp.is_department_head})`,
    );
    return [];
  }

  const results: AgentBlockResult[] = [];

  for (const m of matches) {
    const attrs = parseAttrs(m[1]);
    const action = (attrs.action || "create").toLowerCase() as
      | "create"
      | "archive"
      | "update";
    const name = (attrs.name || "").trim();
    if (!name) {
      results.push({
        ok: false,
        action,
        name: "(unnamed)",
        message: "name attribute is required",
      });
      continue;
    }

    try {
      if (action === "create") {
        const reportsToName = (attrs.reports_to || "").trim();
        if (!reportsToName) {
          results.push({
            ok: false,
            action,
            name,
            message:
              "reports_to is required - sub-agents must report to a head",
          });
          continue;
        }
        // Resolve the parent (must be a department head)
        const { data: parent } = await db
          .from("rgaios_agents")
          .select("id, is_department_head, role, department")
          .eq("organization_id", orgId)
          .ilike("name", reportsToName)
          .maybeSingle();
        const p = parent as {
          id: string;
          is_department_head: boolean | null;
          role: string | null;
          department: string | null;
        } | null;
        if (!p) {
          results.push({
            ok: false,
            action,
            name,
            message: `parent "${reportsToName}" not found`,
          });
          continue;
        }
        if (!p.is_department_head && p.role !== "ceo") {
          results.push({
            ok: false,
            action,
            name,
            message: `parent "${reportsToName}" must be a department head or CEO`,
          });
          continue;
        }
        const created = await createAgent(orgId, {
          name,
          // title/description columns are NOT NULL-tolerant in the DTO -
          // an absent attr means "no title yet", stored as empty string.
          title: attrs.title || attrs.role || "",
          // attrs come from free-form chat markup; the agent is instructed
          // to emit one of the AGENT_ROLES values, fall back to "general".
          // The DTO union is the app contract, so narrow here at the boundary.
          role: (attrs.role || "general") as AgentRole,
          reportsTo: p.id,
          description: attrs.description || "",
          // runtime is the MODEL the agent runs on, not a provider id.
          // "anthropic-cli" was a provider/runtime mixup; sub-agents get
          // the same default model as a normal hire.
          runtime: DEFAULT_AGENT_RUNTIME,
          budgetMonthlyUsd: 50,
          department: p.department,
          isDepartmentHead: false, // PEDRO RULE: agents can never spawn heads
          // writePolicy omitted: sub-agents start with the default empty
          // policy (no integration grants). It is a per-tool map, not a
          // scalar - the old "advisory" string was never a valid value.
        });
        results.push({
          ok: true,
          action,
          name,
          message: `Created sub-agent under ${reportsToName}`,
          agentId: created.id,
        });
      } else if (action === "archive") {
        const t = await resolveTargetAgent(db, orgId, name);
        if (!t) {
          results.push({
            ok: false,
            action,
            name,
            message: `agent "${name}" not found`,
          });
          continue;
        }
        if (t.is_department_head) {
          results.push({
            ok: false,
            action,
            name,
            message: `cannot archive "${name}" - it's a department head (heads are protected)`,
          });
          continue;
        }
        await deleteAgent(orgId, t.id);
        results.push({
          ok: true,
          action,
          name: t.name,
          message: "Archived",
          agentId: t.id,
        });
      } else if (action === "update") {
        const t = await resolveTargetAgent(db, orgId, name);
        if (!t) {
          results.push({
            ok: false,
            action,
            name,
            message: `agent "${name}" not found`,
          });
          continue;
        }
        if (t.is_department_head) {
          results.push({
            ok: false,
            action,
            name,
            message: `cannot update "${name}" - it's a department head`,
          });
          continue;
        }
        const patch: Record<string, unknown> = {};
        if (attrs.description) patch.description = attrs.description;
        if (attrs.title) patch.title = attrs.title;
        if (attrs.role) patch.role = attrs.role;
        await db
          .from("rgaios_agents")
          .update(patch as never)
          .eq("organization_id", orgId)
          .eq("id", t.id);
        results.push({
          ok: true,
          action,
          name: t.name,
          message: "Updated",
          agentId: t.id,
        });
      } else {
        results.push({
          ok: false,
          action,
          name,
          message: `unknown action "${action}"`,
        });
      }
    } catch (err) {
      results.push({
        ok: false,
        action,
        name,
        message: (err as Error).message.slice(0, 200),
      });
    }
  }

  // Audit one row per applied block
  for (const r of results) {
    await db.from("rgaios_audit_log").insert({
      organization_id: orgId,
      kind: r.ok ? `agent_${r.action}` : "agent_block_rejected",
      actor_type: "agent",
      actor_id: speakerAgentId,
      detail: {
        action: r.action,
        target: r.name,
        agent_id: r.agentId,
        message: r.message,
      },
    } as never);
  }
  return results;
}
