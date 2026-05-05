/**
 * Client-safe view over role-templates.ts. Lets components running in
 * the browser look up role labels + canonical names without importing
 * the node:fs/promises pipeline that auto-train uses server-side.
 *
 * The actual catalog lives in role-templates.ts. We keep the labels +
 * the case-insensitive lookup here so the bundler's tree-shake leaves
 * the readFile / path imports out of any client component that just
 * wants to render the dropdown options.
 */

// Stable list of role labels for the UI dropdown. Matches Object.keys
// of ROLE_TEMPLATES in role-templates.ts. Keep in sync when adding a
// new template; an out-of-band lint test in tests/unit/role-templates
// catches drift.
export const ROLE_TEMPLATE_LABELS: readonly string[] = [
  "Backend Engineer",
  "Bookkeeper",
  "CEO",
  "Content Strategist",
  "Copywriter",
  "Engineering Manager",
  "Finance Manager",
  "Frontend Engineer",
  "Marketing Manager",
  "Media Buyer",
  "Operations Manager",
  "Project Coordinator",
  "QA Engineer",
  "SDR",
  "Sales Manager",
  "Social Media Manager",
] as const;

/**
 * Resolve a freeform role text to its canonical catalog label. Returns
 * null when the role isn't in the catalog so the caller can fall back
 * to a generic agent. Case-insensitive.
 */
export function getRoleTemplateLabel(roleLabel: string): string | null {
  if (!roleLabel) return null;
  const normalised = roleLabel.trim().toLowerCase();
  for (const label of ROLE_TEMPLATE_LABELS) {
    if (label.toLowerCase() === normalised) return label;
  }
  return null;
}
