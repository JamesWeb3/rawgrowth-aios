import { chatReply } from "@/lib/agent/chat";

/**
 * Generate a self-contained single-page web app from a natural-language
 * prompt. Output is one HTML document with inline CSS + JS - no
 * external deps - so the operator can preview it in an iframe sandbox
 * without a build step.
 *
 * Routes through chatReply (Claude Max OAuth) so it works on any v3
 * deploy that has the Claude Max connection wired - no separate
 * OPENAI/ANTHROPIC key needed.
 */

const ENGINEERING_BRIEF = `You are the Engineering Manager at the user's AI org. Your job: ship a tiny self-contained web app from a one-line description.

Output rules:
- Return ONE complete HTML document, top to bottom: <!doctype html>...</html>.
- All CSS inline in <style>. All JS inline in <script>. No external <link>, no external <script src>, no fetch() to other origins.
- Use plain DOM APIs. No React/Vue/Tailwind/etc.
- Dark theme background (#0A1210), green accent (#0CBF6A), white text. Match Rawgrowth aesthetic.
- Real working interactivity: buttons fire handlers, inputs persist to localStorage, calculations actually compute.
- One screen, no routing.
- Add a small header with the app title + a one-line description.
- Reasonable empty state if there is no data yet.

Output ONLY the HTML. No markdown fences. No commentary. No "here is your app" preamble. No <task> blocks.`;

export async function generateMiniSaas(input: {
  organizationId: string;
  organizationName: string | null;
  prompt: string;
  agentId?: string;
}): Promise<{ html: string }> {
  const res = await chatReply({
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    chatId: 0,
    userMessage: input.prompt,
    publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    agentId: input.agentId,
    historyOverride: [],
    extraPreamble: ENGINEERING_BRIEF,
    noHandoff: true,
  });
  if (!res.ok) {
    throw new Error(res.error);
  }

  // Strip accidental markdown fences if the model added them anyway.
  let html = res.reply.trim();
  if (html.startsWith("```")) {
    html = html.replace(/^```(?:html)?\s*/, "").replace(/```\s*$/, "");
  }
  if (!html.toLowerCase().includes("<!doctype")) {
    // Fallback wrap so the iframe still renders something instead of
    // a half-broken fragment.
    html = `<!doctype html><html><head><meta charset="utf-8"><title>Mini app</title></head><body>${html}</body></html>`;
  }
  return { html };
}
