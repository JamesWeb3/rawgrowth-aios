/**
 * ESLint rule: fail the build if source contains any of the 11 banned
 * words from brief §12. Matches in string literals, template literals,
 * and JSX text. Case-insensitive, word-boundary aware.
 *
 * Complement to the runtime banned-words filter in the telegram_reply
 * MCP middleware (D12): this catches them at code-write time so the
 * LLM-output filter is a second line of defense, not the only one.
 */

const BANNED_WORDS = [
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
];

function buildPattern() {
  const escaped = BANNED_WORDS.map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
  );
  return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
}

const BANNED_RE = buildPattern();

function checkText(ctx, node, text) {
  if (typeof text !== "string" || !text) return;
  const match = text.match(BANNED_RE);
  if (!match) return;
  ctx.report({
    node,
    message: `Banned brand-voice word in source: "${match[0]}". Brief §12 blocks this exact list. Pick a different word or rewrite the line.`,
  });
}

const bannedWords = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block the 11 banned brand-voice words from brief §12 (game-changer, unlock, leverage, utilize, deep dive, revolutionary, cutting-edge, synergy, streamline, empower, certainly).",
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
      JSXText(node) {
        checkText(ctx, node, node.value);
      },
    };
  },
};

export default {
  rules: {
    "banned-words": bannedWords,
  },
};
