import { registerTool, text, textError } from "../registry";
import {
  createAgent,
  deleteAgent,
  listAgentsForOrg,
  updateAgent,
} from "@/lib/agents/queries";
import { AGENT_ROLES, type AgentRole } from "@/lib/agents/constants";
import { addSkillsToAgent, listAssignments } from "@/lib/skills/queries";
import { getSkill, installCommand } from "@/lib/skills/catalog";
import { autoPickSkillsForAgent } from "@/lib/skills/rank";

/**
 * MCP tools for the agent lifecycle. Let clients create, list, update, and
 * fire agents from inside Claude Code — no need to bounce to the web UI
 * for every tweak.
 *
 * In self-hosted mode the `runtime` column is ignored (no autonomous
 * executor runs) but we still accept a value for forward-compat with the
 * hosted product. Default to claude-sonnet-4-5 so creates always work.
 */

const VALID_ROLES = AGENT_ROLES.map((r) => r.value) as readonly string[];

// ─── agents_list ───────────────────────────────────────────────────

registerTool({
  name: "agents_list",
  description:
    "List every agent in this organization. Returns name, title, role, and status for each.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async (_args, ctx) => {
    const [agents, assignments] = await Promise.all([
      listAgentsForOrg(ctx.organizationId),
      listAssignments(ctx.organizationId),
    ]);
    if (agents.length === 0) {
      return text(
        "No agents yet. Create one with `agents_create` — minimum required is `name`.",
      );
    }
    const skillsByAgent = new Map<string, string[]>();
    const uniqueSkillIds = new Set<string>();
    for (const a of assignments) {
      const skill = getSkill(a.skill_id);
      if (!skill) continue;
      uniqueSkillIds.add(skill.id);
      const arr = skillsByAgent.get(a.agent_id) ?? [];
      arr.push(skill.name);
      skillsByAgent.set(a.agent_id, arr);
    }

    const lines = [
      `Found ${agents.length} agent(s):`,
      "",
      ...agents.map((a) => {
        const skills = skillsByAgent.get(a.id) ?? [];
        const skillsLine = skills.length
          ? ` · skills: ${skills.join(", ")}`
          : "";
        return `- **${a.name}**${a.title ? ` — ${a.title}` : ""} · role: ${a.role} · status: ${a.status}${skillsLine} · id: \`${a.id}\``;
      }),
    ];

    if (uniqueSkillIds.size > 0) {
      lines.push("");
      lines.push(
        "**Skill install check.** These skills are assigned to agents in this org. Before acting as an agent, verify each skill exists in `~/.claude/skills/` on this laptop. If missing, offer to run the install command for the user. One-time per laptop.",
      );
      lines.push("");
      for (const id of uniqueSkillIds) {
        const s = getSkill(id);
        if (!s) continue;
        lines.push(`- **${s.name}** → directory \`~/.claude/skills/${s.sourceSkill}\``);
        lines.push(`  install: \`${installCommand(s)}\``);
      }
    }

    return text(lines.join("\n"));
  },
});

// ─── agents_create ─────────────────────────────────────────────────

function integrationsToPolicy(
  ids: unknown,
): Record<string, "direct" | "requires_approval" | "draft_only"> | undefined {
  if (!Array.isArray(ids)) return undefined;
  const result: Record<string, "direct"> = {};
  for (const raw of ids) {
    const id = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (id) result[id] = "direct";
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

registerTool({
  name: "agents_create",
  description:
    "Hire a new agent. Required: name. Optional: title (e.g. 'Head of Growth'), role (one of: ceo, cto, engineer, marketer, sdr, ops, designer, general — default: general), description (what the agent is responsible for), reports_to (id of another agent), budget_monthly_usd (default 500), integrations (array of connector ids the agent uses — e.g. ['gmail','notion','slack']), department (one of: marketing, sales, fulfilment, finance), skill_ids (optional explicit list of skill catalog ids — if omitted the tool auto-picks 1-3 relevant skills based on role/title/description/department). Pass skill_ids: [] to explicitly skip auto-assignment.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Agent's first name, e.g. 'Atlas'." },
      title: { type: "string", description: "Job title, e.g. 'Head of Growth'." },
      role: {
        type: "string",
        description:
          "One of: ceo, cto, engineer, marketer, sdr, ops, designer, general.",
      },
      description: {
        type: "string",
        description: "What the agent is responsible for. The clearer the better.",
      },
      reports_to: {
        type: "string",
        description: "Optional id of another agent this one reports to.",
      },
      budget_monthly_usd: {
        type: "number",
        description: "Monthly budget cap in USD. Default 500.",
      },
      integrations: {
        type: "array",
        items: { type: "string" },
        description:
          "Connector ids the agent uses. Native: gmail, google-calendar, google-drive, slack, notion, linear, github, asana, canva. Community: shopify, stripe, hubspot, telegram. Any string is accepted for custom MCP servers.",
      },
      department: {
        type: "string",
        description:
          "One of: marketing, sales, fulfilment, finance. Groups this agent under that pillar on the Departments page.",
      },
      skill_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional skill catalog ids to assign at creation (e.g. ['rawclaw-react-patterns','rawclaw-brand-voice']). Omit the field to auto-pick 1-3 based on role/title/description. Pass [] to skip auto-assignment.",
      },
    },
    required: ["name"],
  },
  handler: async (args, ctx) => {
    const name = String(args.name ?? "").trim();
    if (!name) return textError("name is required");

    const role = String(args.role ?? "general") as AgentRole;
    if (!VALID_ROLES.includes(role)) {
      return textError(
        `role must be one of: ${VALID_ROLES.join(", ")}. Got: ${role}`,
      );
    }

    const DEPARTMENTS = ["marketing", "sales", "fulfilment", "finance"] as const;
    type Department = typeof DEPARTMENTS[number];
    let department: Department | null = null;
    if (args.department !== undefined && args.department !== null) {
      const d = String(args.department).toLowerCase();
      if (!DEPARTMENTS.includes(d as Department)) {
        return textError(
          `department must be one of: ${DEPARTMENTS.join(", ")}. Got: ${d}`,
        );
      }
      department = d as Department;
    }

    const writePolicy = integrationsToPolicy(args.integrations);

    const agent = await createAgent(ctx.organizationId, {
      name,
      title: String(args.title ?? "").trim(),
      role,
      reportsTo: args.reports_to ? String(args.reports_to) : null,
      description: String(args.description ?? "").trim(),
      runtime: "claude-sonnet-4-5",
      budgetMonthlyUsd: Number(args.budget_monthly_usd ?? 500),
      department,
      writePolicy,
    });

    // Skills assignment. Three paths:
    //   • caller passed skill_ids: use those verbatim (even if [])
    //   • caller passed nothing: auto-pick 1-3 relevant skills
    //   • auto-pick finds nothing → leave skills empty
    let assignedSkillIds: string[] = [];
    const explicitSkills = args.skill_ids;
    if (Array.isArray(explicitSkills)) {
      const ids = explicitSkills
        .map((v) => String(v ?? "").trim())
        .filter((v) => v.length > 0);
      const unknown = ids.filter((id) => !getSkill(id));
      if (unknown.length > 0) {
        // Agent was already created — don't fail; just skip the unknowns
        // and report. The caller can always assign manually later.
        assignedSkillIds = ids.filter((id) => getSkill(id));
      } else {
        assignedSkillIds = ids;
      }
    } else {
      assignedSkillIds = autoPickSkillsForAgent({
        role: agent.role,
        title: agent.title ?? null,
        description: agent.description ?? null,
        department: agent.department ?? null,
      });
    }

    if (assignedSkillIds.length > 0) {
      await addSkillsToAgent(
        ctx.organizationId,
        agent.id,
        assignedSkillIds,
      );
    }

    const integrations = Object.keys(agent.writePolicy ?? {});
    const skillsLine = assignedSkillIds.length
      ? `- skills: ${assignedSkillIds
          .map((id) => getSkill(id)?.name ?? id)
          .join(", ")}${Array.isArray(explicitSkills) ? "" : " (auto-picked)"}`
      : `- skills: (none — use \`skills_assign\` later if you want some)`;

    return text(
      [
        `Hired **${agent.name}**${agent.title ? ` — ${agent.title}` : ""}.`,
        `- id: \`${agent.id}\``,
        `- role: ${agent.role}`,
        `- status: ${agent.status}`,
        `- budget: $${agent.budgetMonthlyUsd.toLocaleString()}/mo`,
        integrations.length
          ? `- connectors: ${integrations.join(", ")}`
          : `- connectors: (none)`,
        skillsLine,
      ].join("\n"),
    );
  },
});

// ─── agents_update ─────────────────────────────────────────────────

registerTool({
  name: "agents_update",
  description:
    "Update an existing agent's fields. Only fields you pass are changed. Use `agents_list` to find the id.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Agent id to update." },
      name: { type: "string" },
      title: { type: "string" },
      role: { type: "string" },
      description: { type: "string" },
      reports_to: {
        type: "string",
        description: "Pass an empty string to clear the reports-to link.",
      },
      budget_monthly_usd: { type: "number" },
      integrations: {
        type: "array",
        items: { type: "string" },
        description:
          "REPLACES the agent's connector list. Pass [] to clear. Valid ids include gmail, google-calendar, google-drive, slack, notion, linear, github, asana, canva, shopify, stripe, hubspot, telegram, or any custom MCP id.",
      },
      status: {
        type: "string",
        description: "One of: idle, running, paused, error.",
      },
      department: {
        type: "string",
        description:
          "One of: marketing, sales, fulfilment, finance. Pass empty string to unassign.",
      },
    },
    required: ["id"],
  },
  handler: async (args, ctx) => {
    const id = String(args.id ?? "").trim();
    if (!id) return textError("id is required");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = String(args.name);
    if (args.title !== undefined) patch.title = String(args.title);
    if (args.role !== undefined) {
      const role = String(args.role);
      if (!VALID_ROLES.includes(role)) {
        return textError(`role must be one of: ${VALID_ROLES.join(", ")}`);
      }
      patch.role = role;
    }
    if (args.description !== undefined) patch.description = String(args.description);
    if (args.reports_to !== undefined) {
      const r = String(args.reports_to).trim();
      patch.reportsTo = r === "" ? null : r;
    }
    if (args.budget_monthly_usd !== undefined) {
      patch.budgetMonthlyUsd = Number(args.budget_monthly_usd);
    }
    if (args.status !== undefined) patch.status = String(args.status);
    if (args.integrations !== undefined) {
      // Explicit replacement — pass [] to clear.
      patch.writePolicy = integrationsToPolicy(args.integrations) ?? {};
    }
    if (args.department !== undefined) {
      const d = String(args.department).trim().toLowerCase();
      const DEPARTMENTS = ["marketing", "sales", "fulfilment", "finance"];
      if (d === "") {
        patch.department = null;
      } else if (!DEPARTMENTS.includes(d)) {
        return textError(`department must be one of: ${DEPARTMENTS.join(", ")}`);
      } else {
        patch.department = d;
      }
    }

    const agent = await updateAgent(ctx.organizationId, id, patch);
    const integrations = Object.keys(agent.writePolicy ?? {});
    return text(
      [
        `Updated **${agent.name}** — role: ${agent.role}, status: ${agent.status}, budget: $${agent.budgetMonthlyUsd}/mo`,
        integrations.length
          ? `Connectors: ${integrations.join(", ")}`
          : `Connectors: (none)`,
      ].join("\n"),
    );
  },
});

// ─── agents_fire ───────────────────────────────────────────────────

registerTool({
  name: "agents_fire",
  description:
    "Permanently delete an agent. Direct reports will have their `reports_to` set to null.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
    },
    required: ["id"],
  },
  handler: async (args, ctx) => {
    const id = String(args.id ?? "").trim();
    if (!id) return textError("id is required");
    await deleteAgent(ctx.organizationId, id);
    return text(`Fired agent \`${id}\`.`);
  },
});
