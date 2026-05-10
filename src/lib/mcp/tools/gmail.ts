import { registerTool, text, textError } from "../registry";
import { composioAction } from "../proxy";

/**
 * Gmail tools via Composio executeAction → Google Gmail API.
 *
 * Pedro yanked Nango end-to-end on 2026-05-07 so these now route
 * through Composio's catalog actions:
 *   - GMAIL_FETCH_MAILS         (search / list)
 *   - GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID  (single message)
 *   - GMAIL_CREATE_EMAIL_DRAFT  (draft, safe default)
 *
 * Registered in BOTH hosted and self-hosted modes since the VPS
 * drain has no other way to reach Gmail. Connection lookup goes
 * through provider_config_key = "composio:gmail" in
 * rgaios_connections, written by /api/connections/composio when the
 * client clicks the Gmail card.
 */

{

type GmailMessagesListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  resultSizeEstimate?: number;
};

type GmailDraftResponse = {
  id: string;
  message: { id: string; threadId: string };
};

// ─── Tool: gmail_search (read) ──────────────────────────────────────

registerTool({
  name: "gmail_search",
  description:
    "Search the connected user's Gmail for messages matching a query. Uses Gmail's search syntax: e.g. `from:sarah@acme.com` or `subject:onboarding`.",
  requiresIntegration: "gmail",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Gmail search query (any syntax Gmail's search box accepts).",
      },
      limit: { type: "number", description: "Max results (default 10, max 50)." },
    },
    required: ["query"],
  },
  handler: async (args, ctx) => {
    const query = String(args.query ?? "").trim();
    if (!query) return textError("query is required");
    const limit = Math.min(Number(args.limit ?? 10) || 10, 50);

    const resp = await composioAction<GmailMessagesListResponse>(
      ctx.organizationId,
      "gmail",
      "GMAIL_FETCH_MAILS",
      { query, max_results: limit },
      ctx.userId,
    );
    const hits = resp.messages ?? [];
    if (hits.length === 0) return text(`No Gmail results for "${query}".`);

    return text(
      [
        `Found ${hits.length} message(s) for "${query}".`,
        "Pass any `id` to gmail_get_message for the full content.",
        "",
        ...hits.map((m, i) => `${i + 1}. message_id: \`${m.id}\``),
      ].join("\n"),
    );
  },
});

// ─── Tool: gmail_get_message (read) ─────────────────────────────────

type GmailHeader = { name: string; value: string };
type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  };
};

function decodeGmailBody(msg: GmailMessage): string {
  const direct = msg.payload?.body?.data;
  if (direct) return Buffer.from(direct, "base64url").toString("utf8");

  const text = msg.payload?.parts?.find((p) => p.mimeType === "text/plain")?.body
    ?.data;
  if (text) return Buffer.from(text, "base64url").toString("utf8");

  return msg.snippet ?? "";
}

registerTool({
  name: "gmail_get_message",
  description:
    "Fetch the full content and metadata of a Gmail message by id. Returns from/to/subject/body.",
  requiresIntegration: "gmail",
  inputSchema: {
    type: "object",
    properties: {
      message_id: { type: "string" },
    },
    required: ["message_id"],
  },
  handler: async (args, ctx) => {
    const id = String(args.message_id ?? "").trim();
    if (!id) return textError("message_id is required");

    const msg = await composioAction<GmailMessage>(
      ctx.organizationId,
      "gmail",
      "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      { message_id: id, format: "full" },
      ctx.userId,
    );
    const headers = msg.payload?.headers ?? [];
    const find = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
      "";
    const body = decodeGmailBody(msg);

    return text(
      [
        `**From**: ${find("From")}`,
        `**To**: ${find("To")}`,
        `**Subject**: ${find("Subject")}`,
        `**Date**: ${find("Date")}`,
        "",
        "---",
        "",
        body.slice(0, 8000), // keep token usage sane
      ].join("\n"),
    );
  },
});

// ─── Tool: gmail_draft (write, safe default) ────────────────────────

registerTool({
  name: "gmail_draft",
  description:
    "Compose a draft email in the user's Gmail drafts folder. The user reviews and sends manually. Safe default  -  does NOT send on its own.",
  requiresIntegration: "gmail",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address." },
      subject: { type: "string" },
      body: { type: "string", description: "Plain text body." },
      cc: { type: "string", description: "Optional cc address." },
    },
    required: ["to", "subject", "body"],
  },
  handler: async (args, ctx) => {
    const to = String(args.to ?? "").trim();
    const subject = String(args.subject ?? "").trim();
    const body = String(args.body ?? "");
    const cc = String(args.cc ?? "").trim();
    if (!to || !subject) return textError("to and subject are required");

    // Brief §P09 + §12: brand-voice guard runs before the draft hits
    // Gmail. Filter both subject and body so a banned word in either
    // surface lands an audit row + hard-fails the draft creation.
    const { applyBrandFilter } = await import("@/lib/brand/apply-filter");
    const subjectFiltered = await applyBrandFilter(subject, {
      organizationId: ctx.organizationId,
      surface: "gmail_draft:subject",
    });
    if (!subjectFiltered.ok) return textError(subjectFiltered.error);
    const bodyFiltered = await applyBrandFilter(body, {
      organizationId: ctx.organizationId,
      surface: "gmail_draft:body",
    });
    if (!bodyFiltered.ok) return textError(bodyFiltered.error);

    const resp = await composioAction<GmailDraftResponse>(
      ctx.organizationId,
      "gmail",
      "GMAIL_CREATE_EMAIL_DRAFT",
      {
        recipient_email: to,
        ...(cc ? { cc: [cc] } : {}),
        subject: subjectFiltered.text,
        body: bodyFiltered.text,
        is_html: false,
      },
      ctx.userId,
    );

    const composeUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${resp.message.id}`;
    return text(
      [
        "Draft saved to the user's Gmail drafts folder.",
        `- draft_id: \`${resp.id}\``,
        `- message_id: \`${resp.message.id}\``,
        `- [Open in Gmail](${composeUrl})`,
      ].join("\n"),
    );
  },
});

} // tools registered
