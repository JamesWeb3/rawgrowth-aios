import { registerTool, text, textError } from "../registry";
import {
  SKILLS_CATALOG,
  getSkill,
  installCommand,
  type Skill,
  type SkillCategory,
} from "@/lib/skills/catalog";
import {
  addSkillsToAgent,
  listSkillsForAgent,
  removeSkillFromAgent,
} from "@/lib/skills/queries";
import { listAgentsForOrg } from "@/lib/agents/queries";

/**
 * MCP tools for the skills marketplace. Let clients browse the catalog and
 * assign/unassign skills to agents from inside Claude Code.
 *
 * Typical flow: caller lists the catalog (optionally filtered by category or
 * a free-text query), picks the best-fitting skills, then calls
 * `skills_assign` with an agent id/name plus the chosen skill ids.
 */

const VALID_CATEGORIES: SkillCategory[] = [
  "engineering",
  "marketing",
  "sales",
  "finance",
  "design",
  "ui",
  "ops",
];

// Resolve either an agent id or a (case-insensitive) agent name to its id.
async function resolveAgentId(
  organizationId: string,
  ref: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const trimmed = ref.trim();
  if (!trimmed) return { error: "agent is required" };
  const agents = await listAgentsForOrg(organizationId);
  const byId = agents.find((a) => a.id === trimmed);
  if (byId) return { id: byId.id, name: byId.name };
  const lc = trimmed.toLowerCase();
  const byName = agents.filter((a) => a.name.toLowerCase() === lc);
  if (byName.length === 1) return { id: byName[0].id, name: byName[0].name };
  if (byName.length > 1) {
    return {
      error: `Multiple agents named "${trimmed}". Pass an id instead: ${byName
        .map((a) => a.id)
        .join(", ")}`,
    };
  }
  return { error: `No agent matched "${trimmed}". Use agents_list to find one.` };
}

// Rudimentary relevance score so "frontend development skills" picks the right
// entries without needing an LLM round-trip.
function scoreSkill(skill: Skill, terms: string[]): number {
  if (terms.length === 0) return 0;
  const haystack = `${skill.name} ${skill.tagline} ${skill.description} ${skill.category}`.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (!t) continue;
    if (skill.name.toLowerCase().includes(t)) score += 4;
    if (skill.tagline.toLowerCase().includes(t)) score += 2;
    if (skill.category === t) score += 3;
    if (haystack.includes(t)) score += 1;
  }
  return score;
}

// ─── skills_catalog_list ───────────────────────────────────────────

registerTool({
  name: "skills_catalog_list",
  description:
    "Browse the RawClaw skills marketplace catalog. Returns each skill's id, name, tagline, and category so you can pick the best fits. Optional: `query` (free-text, ranks matches), `category` (one of: engineering, marketing, sales, finance, design, ui, ops), `limit` (default 25, max 200).",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Free-text search. e.g. 'frontend development', 'cold email', 'analytics'.",
      },
      category: {
        type: "string",
        description: `Filter by category. One of: ${VALID_CATEGORIES.join(", ")}.`,
      },
      limit: { type: "number", description: "Max results. Default 25." },
    },
  },
  handler: async (args) => {
    const query = String(args.query ?? "").trim();
    const category = String(args.category ?? "").trim().toLowerCase();
    const limit = Math.min(
      Math.max(1, Number(args.limit ?? 25) || 25),
      200,
    );

    if (category && !VALID_CATEGORIES.includes(category as SkillCategory)) {
      return textError(
        `category must be one of: ${VALID_CATEGORIES.join(", ")}. Got: ${category}`,
      );
    }

    let results = SKILLS_CATALOG.slice();
    if (category) {
      results = results.filter((s) => s.category === category);
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length > 0) {
      results = results
        .map((s) => ({ s, score: scoreSkill(s, terms) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.s);
    } else {
      results = results.sort((a, b) => a.name.localeCompare(b.name));
    }

    const total = results.length;
    const shown = results.slice(0, limit);

    if (total === 0) {
      return text(
        `No skills matched${query ? ` query "${query}"` : ""}${
          category ? ` in category "${category}"` : ""
        }. There are ${SKILLS_CATALOG.length} skills in the catalog.`,
      );
    }

    const lines = [
      `Found ${total} skill(s)${query ? ` for "${query}"` : ""}${
        category ? ` in ${category}` : ""
      }. Showing ${shown.length}.`,
      "",
      ...shown.map(
        (s) =>
          `- \`${s.id}\` · **${s.name}** · ${s.category} — ${s.tagline}`,
      ),
    ];
    if (total > shown.length) {
      lines.push("", `(${total - shown.length} more — raise \`limit\` to see them.)`);
    }
    return text(lines.join("\n"));
  },
});

// ─── skills_for_agent ──────────────────────────────────────────────

registerTool({
  name: "skills_for_agent",
  description:
    "List every skill currently assigned to a given agent. Pass `agent` as either the agent id or an exact name match.",
  inputSchema: {
    type: "object",
    properties: {
      agent: { type: "string", description: "Agent id or exact name." },
    },
    required: ["agent"],
  },
  handler: async (args, ctx) => {
    const resolved = await resolveAgentId(
      ctx.organizationId,
      String(args.agent ?? ""),
    );
    if ("error" in resolved) return textError(resolved.error);

    const skillIds = await listSkillsForAgent(ctx.organizationId, resolved.id);
    if (skillIds.length === 0) {
      return text(
        `**${resolved.name}** has no skills assigned. Use \`skills_catalog_list\` to browse and \`skills_assign\` to attach some.`,
      );
    }
    const lines = [
      `**${resolved.name}** has ${skillIds.length} skill(s):`,
      "",
      ...skillIds.map((id) => {
        const s = getSkill(id);
        return s
          ? `- \`${s.id}\` · **${s.name}** · ${s.category} — ${s.tagline}`
          : `- \`${id}\` · (missing from catalog)`;
      }),
    ];
    return text(lines.join("\n"));
  },
});

// ─── skills_assign ─────────────────────────────────────────────────

registerTool({
  name: "skills_assign",
  description:
    "Assign one or more skills to an agent. Additive — existing skills are kept. Pass `agent` (id or exact name) and `skill_ids` (array of catalog ids from `skills_catalog_list`, e.g. ['rawclaw-react-patterns','rawclaw-frontend-design']).",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      agent: { type: "string", description: "Agent id or exact name." },
      skill_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Skill catalog ids. Get these from `skills_catalog_list`. Unknown ids are rejected.",
      },
    },
    required: ["agent", "skill_ids"],
  },
  handler: async (args, ctx) => {
    const resolved = await resolveAgentId(
      ctx.organizationId,
      String(args.agent ?? ""),
    );
    if ("error" in resolved) return textError(resolved.error);

    const raw = Array.isArray(args.skill_ids) ? args.skill_ids : [];
    const ids = raw
      .map((v) => String(v ?? "").trim())
      .filter((v) => v.length > 0);
    if (ids.length === 0) {
      return textError("skill_ids must be a non-empty array of catalog ids.");
    }

    const unknown = ids.filter((id) => !getSkill(id));
    if (unknown.length > 0) {
      return textError(
        `Unknown skill id(s): ${unknown.join(", ")}. Use \`skills_catalog_list\` to find valid ids.`,
      );
    }

    const added = await addSkillsToAgent(ctx.organizationId, resolved.id, ids);
    const alreadyHad = ids.filter((id) => !added.includes(id));

    const lines = [
      `Assigned ${added.length} new skill(s) to **${resolved.name}**.`,
    ];
    if (added.length > 0) {
      lines.push("");
      lines.push("**Added:**");
      for (const id of added) {
        const s = getSkill(id);
        if (!s) continue;
        lines.push(`- **${s.name}** (\`${s.id}\`) — install on laptop: \`${installCommand(s)}\``);
      }
    }
    if (alreadyHad.length > 0) {
      lines.push("");
      lines.push(
        `Already assigned (skipped): ${alreadyHad
          .map((id) => getSkill(id)?.name ?? id)
          .join(", ")}`,
      );
    }
    return text(lines.join("\n"));
  },
});

// ─── skills_unassign ───────────────────────────────────────────────

registerTool({
  name: "skills_unassign",
  description:
    "Remove a single skill from an agent. No-op if the agent didn't have it. Pass `agent` (id or exact name) and `skill_id`.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      agent: { type: "string", description: "Agent id or exact name." },
      skill_id: { type: "string", description: "Skill catalog id." },
    },
    required: ["agent", "skill_id"],
  },
  handler: async (args, ctx) => {
    const resolved = await resolveAgentId(
      ctx.organizationId,
      String(args.agent ?? ""),
    );
    if ("error" in resolved) return textError(resolved.error);

    const skillId = String(args.skill_id ?? "").trim();
    if (!skillId) return textError("skill_id is required");
    if (!getSkill(skillId)) {
      return textError(`Unknown skill id: ${skillId}`);
    }

    await removeSkillFromAgent(ctx.organizationId, resolved.id, skillId);
    return text(
      `Removed \`${skillId}\` from **${resolved.name}** (no-op if it wasn't assigned).`,
    );
  },
});
