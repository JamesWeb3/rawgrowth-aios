/**
 * Rawgrowth AIOS v3 brand tokens. Mirrors the CSS custom properties in
 * src/app/globals.css but exports them as plain TS values so non-CSS
 * surfaces (email templates, server-rendered SVGs, Node scripts, tests)
 * can consume them without parsing CSS.
 *
 * Palette sourced from rawgrowth.ai: deep near-black background, emerald
 * primary #0CBF6A, soft atmospheric greens, white-alpha text. If Chris
 * delivers an updated Figma file, update BOTH this file and globals.css
 * in the same PR.
 */

export const COLORS = {
  brand: {
    bg: "#060b08",
    surface: "#0a1210",
    surface2: "#0d1814",
    primary: "#0cbf6a",
    primaryDark: "#0a9452",
    primarySoft: "rgba(12, 191, 106, 0.08)",
    primaryRing: "rgba(12, 191, 106, 0.25)",
  },
  text: {
    strong: "rgba(255, 255, 255, 0.92)",
    body: "rgba(255, 255, 255, 0.7)",
    muted: "rgba(255, 255, 255, 0.5)",
    faint: "rgba(255, 255, 255, 0.35)",
  },
  line: {
    soft: "rgba(255, 255, 255, 0.06)",
    strong: "rgba(255, 255, 255, 0.1)",
  },
  destructive: "#dc4b4b",
} as const;

export const RADIUS = {
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.75rem",
  xl: "1rem",
  pill: "999rem",
} as const;

export const SPACING = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.5rem",
  "2xl": "2rem",
  "3xl": "3rem",
} as const;

export const FONT_STACK = {
  sans: '"Inter", "Helvetica Neue", system-ui, sans-serif',
  serif: '"Fraunces", "Playfair Display", "Georgia", serif',
  mono: '"JetBrains Mono", "Menlo", ui-monospace, monospace',
} as const;

/**
 * Tailwind class names banned by brief §12 rule "no default Tailwind
 * blue/indigo, no flat shadows, no transition-all". Enforced at build
 * time via the ESLint rule in src/lib/brand/eslint-banned-classes.mjs.
 *
 * Use brand tokens instead: text-primary, bg-brand-surface, ring-primary/50.
 */
export const BANNED_TAILWIND_CLASSES = [
  // Default Tailwind blues / indigos / skies  -  the "looks like a template" tell.
  /\b(?:text|bg|border|ring|from|to|via)-(?:blue|indigo|sky|violet)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/,
  // Flat / generic shadows.
  /\bshadow(?:-sm|-md|)\b/,
  // transition-all catches any property, usually lazier than naming one.
  /\btransition-all\b/,
] as const;

/**
 * Banned words from brief §12. Matched case-insensitively at word
 * boundaries. Enforced at build time via eslint-banned-words and at
 * runtime by the telegram_reply MCP middleware (D12).
 */
export const BANNED_WORDS = [
  "game-changer",
  "unlock",
  "leverage",
  "utilize",
  "deep dive",
  "revolutionary",
  "cutting-edge",
  "synergy",
  "streamline",
  "empower",
  "certainly",
] as const;
