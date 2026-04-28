/**
 * ESLint rule: fail the build if source uses default Tailwind blue/indigo/sky,
 * flat shadows, or transition-all. Enforces brief §12 "no default Tailwind
 * blue/indigo, no flat shadows".
 *
 * Covers:
 *   - className="text-blue-500 ..." string literal
 *   - className={`... bg-indigo-600 ...`} template
 *   - cn("shadow-sm", "...") args
 *
 * Does NOT cover dynamic classes computed at runtime (`bg-${x}-500`);
 * relies on human review for those.
 */

const BANNED_PATTERNS = [
  {
    re: /\b(?:text|bg|border|ring|from|to|via|divide|placeholder|accent|caret|decoration|outline|fill|stroke)-(?:blue|indigo|sky|violet)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/,
    msg: "Default Tailwind blue/indigo/sky/violet is banned by brief §12. Use the brand tokens (text-primary, bg-[--brand-surface], ring-primary/50) instead.",
  },
  {
    re: /\bshadow(?:-sm|-md)?\b(?!-|\.)/,
    msg: "Flat generic shadows are banned by brief §12. Use a named brand shadow or drop the shadow entirely.",
  },
  {
    re: /\btransition-all\b/,
    msg: "transition-all is banned by brief §12 (lazy). Name the specific properties you animate.",
  },
];

function checkText(ctx, node, text) {
  if (typeof text !== "string" || !text) return;
  for (const { re, msg } of BANNED_PATTERNS) {
    const match = text.match(re);
    if (match) {
      ctx.report({ node, message: `${msg} Matched: "${match[0]}"` });
      break;
    }
  }
}

const bannedClasses = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block default Tailwind blue/indigo/sky, flat shadows, and transition-all (brief §12 craft bar).",
    },
    schema: [],
  },
  create(ctx) {
    return {
      Literal(node) {
        if (typeof node.value === "string") checkText(ctx, node, node.value);
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          checkText(ctx, node, quasi.value.cooked);
        }
      },
      JSXAttribute(node) {
        if (node.name?.name !== "className" && node.name?.name !== "class") return;
        const value = node.value;
        if (value?.type === "Literal" && typeof value.value === "string") {
          checkText(ctx, value, value.value);
        }
        if (value?.type === "JSXExpressionContainer") {
          const expr = value.expression;
          if (expr?.type === "Literal" && typeof expr.value === "string") {
            checkText(ctx, expr, expr.value);
          }
          if (expr?.type === "TemplateLiteral") {
            for (const quasi of expr.quasis) {
              checkText(ctx, expr, quasi.value.cooked);
            }
          }
        }
      },
    };
  },
};

export default {
  rules: {
    "banned-tailwind-defaults": bannedClasses,
  },
};
