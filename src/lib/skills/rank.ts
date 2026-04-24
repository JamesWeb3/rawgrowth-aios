import { SKILLS_CATALOG, type Skill, type SkillCategory } from "./catalog";

/**
 * Ranking + auto-pick helpers for the RawClaw skills catalog.
 *
 * Two callers:
 *   - `skills_catalog_list` MCP tool — free-text search with a sort
 *   - `agents_create` MCP tool — auto-assigns 1-3 skills to new agents
 *     based on role / title / description / department
 *
 * Keeping the scoring function in one place avoids drift when we tune
 * the match heuristic (and both tools should ideally behave the same).
 */

export function scoreSkill(skill: Skill, terms: string[]): number {
  if (terms.length === 0) return 0;
  const name = skill.name.toLowerCase();
  const tagline = skill.tagline.toLowerCase();
  const haystack =
    `${skill.name} ${skill.tagline} ${skill.description} ${skill.category}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const t = term.trim().toLowerCase();
    if (!t) continue;
    if (name.includes(t)) score += 4;
    if (tagline.includes(t)) score += 2;
    if (skill.category === t) score += 3;
    if (haystack.includes(t)) score += 1;
  }
  return score;
}

/** Rank the whole catalog against a query; highest-scoring first. */
export function rankCatalog(
  query: string,
  category?: SkillCategory,
): Array<{ skill: Skill; score: number }> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = category
    ? SKILLS_CATALOG.filter((s) => s.category === category)
    : SKILLS_CATALOG;
  return pool
    .map((skill) => ({ skill, score: scoreSkill(skill, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ─── agent → skill auto-assignment ───────────────────────────────────

/**
 * Map an agent role to the catalog category most likely to be relevant.
 * Used as a strong signal during auto-pick so e.g. `role=cto` leans
 * toward engineering skills even if the description is terse.
 */
const ROLE_TO_CATEGORY: Record<string, SkillCategory> = {
  ceo: "ops",
  cto: "engineering",
  engineer: "engineering",
  marketer: "marketing",
  sdr: "sales",
  ops: "ops",
  designer: "design",
  // general: no preferred category — fall back to text match only.
};

const MIN_SCORE = 3; // threshold below which we don't auto-assign
const MAX_AUTO_SKILLS = 3; // cap to avoid "10 skills" overload

/**
 * Pick up to 3 skills for a newly-created agent based on its metadata.
 * Returns skill ids (never more than MAX_AUTO_SKILLS, possibly zero if
 * nothing scored above threshold).
 *
 * Inputs are combined into a single query so "Head of Growth" + role
 * `marketer` + description text all contribute to the match.
 */
export function autoPickSkillsForAgent(input: {
  role: string;
  title?: string | null;
  description?: string | null;
  department?: string | null;
}): string[] {
  const roleCategory = ROLE_TO_CATEGORY[input.role];

  // Build a strong query string from everything we know.
  const query = [
    input.role,
    input.title ?? "",
    input.description ?? "",
    input.department ?? "",
    // Echo the category twice so it dominates the score.
    roleCategory ?? "",
    roleCategory ?? "",
  ]
    .join(" ")
    .trim();

  if (!query) return [];

  const ranked = rankCatalog(query);
  // Prefer skills whose category matches the role-derived category —
  // bubble them up within the top slice.
  if (roleCategory) {
    ranked.sort((a, b) => {
      const aMatch = a.skill.category === roleCategory ? 1 : 0;
      const bMatch = b.skill.category === roleCategory ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return b.score - a.score;
    });
  }

  return ranked
    .filter((x) => x.score >= MIN_SCORE)
    .slice(0, MAX_AUTO_SKILLS)
    .map((x) => x.skill.id);
}
