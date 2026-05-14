import { supabaseAdmin } from "@/lib/supabase/server";
import { registerTool, text, textError } from "../registry";

/**
 * agent_message / agent_inbox  -  lightweight async peer messaging
 * (A2A-style). The deliberate opposite of agent_invoke: where
 * agent_invoke is a one-shot, blocking, manager->sub-agent delegation
 * that waits for a reply, agent_message just drops a note in the
 * recipient's inbox and returns. No run is enqueued, nothing blocks.
 *
 * The point: a department head can ask a peer a clarifying question
 * without spawning a full delegation run. The peer reads it later with
 * agent_inbox, on its own time.
 *
 * Both tools are org-scoped on ctx.organizationId  -  every query
 * carries `.eq("organization_id", ctx.organizationId)` and a send to an
 * agent outside the org is refused.
 *
 * Caller identity note: ToolContext (src/lib/mcp/types.ts) carries
 * organizationId + an optional userId, but NO calling-agent id. So
 * neither tool can infer "which agent am I" from ctx. agent_inbox
 * takes an explicit `agent_id` arg and agent_message takes a
 * `from_agent` arg  -  same convention as knowledge_query in
 * agent-knowledge.ts, which also has to be told which agent it acts as.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AgentRow = { id: string; name: string };

/**
 * Resolve an agent reference (a UUID or a name) to a row inside the
 * caller's org. Returns null when nothing matches  -  the cross-tenant
 * guard is the `.eq("organization_id", ...)` on every branch, so a
 * guessed id from another org resolves to null just like a typo.
 */
async function resolveAgent(
  db: ReturnType<typeof supabaseAdmin>,
  organizationId: string,
  ref: string,
): Promise<AgentRow | null> {
  if (UUID_RE.test(ref)) {
    const { data } = await db
      .from("rgaios_agents")
      .select("id, name")
      .eq("id", ref)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (data) return data as AgentRow;
    // Fall through: a UUID-shaped string that isn't an agent in this
    // org might still be intended as a (weird) name. Cheap to check.
  }

  const { data: byName } = await db
    .from("rgaios_agents")
    .select("id, name")
    .eq("organization_id", organizationId)
    .ilike("name", ref)
    .limit(2);
  const rows = (byName ?? []) as AgentRow[];
  if (rows.length === 1) return rows[0];
  // 0 matches  -  not found. 2+ matches  -  ambiguous; caller must use
  // the id. Both surface as "not resolvable" to the handler.
  return null;
}

/** Human-readable age string for an ISO timestamp, e.g. "3h ago". */
function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── agent_message ─────────────────────────────────────────────────

registerTool({
  name: "agent_message",
  description:
    "Send an async message to another agent in this organization. " +
    "Non-blocking: the message lands in the recipient's inbox and this " +
    "returns right away  -  it does NOT wait for a reply (that is what " +
    "agent_invoke is for). Use when a peer just needs a heads-up or a " +
    "clarifying question they can answer on their own time. To continue " +
    "an existing exchange, pass the thread_id from the message you are " +
    "replying to.",
  isWrite: true,
  inputSchema: {
    type: "object",
    required: ["from_agent", "to_agent", "body"],
    properties: {
      from_agent: {
        type: "string",
        description:
          "The sending agent, by UUID or unique name. This is the " +
          "calling agent identifying itself  -  ToolContext does not " +
          "carry a calling-agent id, so the sender must be named.",
      },
      to_agent: {
        type: "string",
        description:
          "Recipient agent, by UUID or by name (e.g. 'Atlas'). Names " +
          "are matched case-insensitively; if two agents share a name, " +
          "use the UUID.",
      },
      body: {
        type: "string",
        description: "The message text, in plain English.",
      },
      thread_id: {
        type: "string",
        description:
          "Optional. The thread_id of the message you are replying to, " +
          "so the back-and-forth stays grouped. Omit to start a new thread.",
      },
    },
  },
  handler: async (args, ctx) => {
    const fromAgent = String(args.from_agent ?? "").trim();
    const toAgent = String(args.to_agent ?? "").trim();
    const body = String(args.body ?? "").trim();
    const threadId =
      args.thread_id === undefined || args.thread_id === null
        ? ""
        : String(args.thread_id).trim();

    if (!fromAgent || !toAgent || !body) {
      return textError("from_agent, to_agent and body are required.");
    }
    if (threadId !== "" && !UUID_RE.test(threadId)) {
      return textError(
        "thread_id must be a UUID (the thread_id from the message you are replying to).",
      );
    }

    const db = supabaseAdmin();

    // Both ends must belong to the caller's org. resolveAgent scopes
    // every lookup to ctx.organizationId, so a guessed cross-tenant id
    // resolves to null and the send is refused below.
    const sender = await resolveAgent(db, ctx.organizationId, fromAgent);
    if (!sender) {
      return textError(
        `Could not resolve from_agent "${fromAgent}" to an agent in this organization.`,
      );
    }
    const target = await resolveAgent(db, ctx.organizationId, toAgent);
    if (!target) {
      return textError(
        `Could not resolve to_agent "${toAgent}" to an agent in this organization. ` +
          "Pass a valid agent UUID, or a unique agent name.",
      );
    }

    const row: Record<string, unknown> = {
      organization_id: ctx.organizationId,
      from_agent_id: sender.id,
      to_agent_id: target.id,
      body,
    };
    // A reply reuses the parent's thread_id; a fresh message lets the
    // table default (gen_random_uuid()) mint a new one.
    if (threadId !== "") row.thread_id = threadId;

    // rgaios_agent_messages landed in migration 0072; the generated
    // Supabase types file is regenerated on the next typegen pass, so
    // until then the row payload is cast through `never` the same way
    // the rgaios_audit_log insert in agents.ts is.
    const { data: inserted, error } = await db
      .from("rgaios_agent_messages")
      .insert(row as never)
      .select("id, thread_id")
      .single();
    if (error || !inserted) {
      return textError(
        `Could not send message: ${error?.message ?? "unknown error"}`,
      );
    }
    const sent = inserted as { id: string; thread_id: string };

    return text(
      [
        `Message sent to **${target.name}** (async  -  it is in their inbox now).`,
        `- message id: \`${sent.id}\``,
        `- thread id: \`${sent.thread_id}\`  (pass this as thread_id to reply in the same thread)`,
      ].join("\n"),
    );
  },
});

// ─── agent_inbox ───────────────────────────────────────────────────

registerTool({
  name: "agent_inbox",
  description:
    "Read an agent's inbox  -  the async messages other agents sent it " +
    "via agent_message. Returns each message with sender, thread id, " +
    "body, and age. Pass unread_only to see just the unread ones; doing " +
    "so also marks those messages read. Requires agent_id: ToolContext " +
    "does not carry the calling agent's id, so the caller must say which " +
    "agent's inbox to open (same as knowledge_query).",
  inputSchema: {
    type: "object",
    required: ["agent_id"],
    properties: {
      agent_id: {
        type: "string",
        description:
          "Whose inbox to read. UUID or unique agent name. This is the " +
          "calling agent identifying itself  -  ctx does not provide it.",
      },
      unread_only: {
        type: "boolean",
        description:
          "If true, return only unread messages AND mark them read. " +
          "Default false (returns everything, changes nothing).",
      },
    },
  },
  handler: async (args, ctx) => {
    const agentRef = String(args.agent_id ?? "").trim();
    const unreadOnly = args.unread_only === true;
    if (!agentRef) {
      return textError(
        "agent_id is required (the calling agent's UUID or unique name).",
      );
    }

    const db = supabaseAdmin();

    const me = await resolveAgent(db, ctx.organizationId, agentRef);
    if (!me) {
      return textError(
        `Could not resolve "${agentRef}" to an agent in this organization.`,
      );
    }

    let query = db
      .from("rgaios_agent_messages")
      .select("id, from_agent_id, thread_id, body, read_at, created_at")
      .eq("organization_id", ctx.organizationId)
      .eq("to_agent_id", me.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (unreadOnly) query = query.is("read_at", null);

    const { data: messages, error } = await query;
    if (error) {
      return textError(`Could not read inbox: ${error.message}`);
    }

    type MsgRow = {
      id: string;
      from_agent_id: string;
      thread_id: string;
      body: string;
      read_at: string | null;
      created_at: string;
    };
    const rows = (messages ?? []) as MsgRow[];

    if (rows.length === 0) {
      return text(
        unreadOnly
          ? `**${me.name}** has no unread messages.`
          : `**${me.name}** has an empty inbox.`,
      );
    }

    // Resolve sender names in one round-trip rather than per-row.
    const senderIds = Array.from(new Set(rows.map((m) => m.from_agent_id)));
    const { data: senders } = await db
      .from("rgaios_agents")
      .select("id, name")
      .eq("organization_id", ctx.organizationId)
      .in("id", senderIds);
    const nameById = new Map<string, string>(
      ((senders ?? []) as AgentRow[]).map((s) => [s.id, s.name]),
    );

    // unread_only is also a "mark read" action: flip read_at on the
    // rows we are returning. Scoped to this agent + org so it can never
    // touch another inbox. Best-effort  -  a failure here should not
    // hide messages the caller already has in hand, so we note it but
    // still return the list.
    let markNote = "";
    if (unreadOnly) {
      const ids = rows.map((m) => m.id);
      const { error: markErr } = await db
        .from("rgaios_agent_messages")
        .update({ read_at: new Date().toISOString() } as never)
        .eq("organization_id", ctx.organizationId)
        .eq("to_agent_id", me.id)
        .in("id", ids);
      if (markErr) {
        markNote = `\n\n(note: could not mark these read  -  ${markErr.message})`;
      }
    }

    const header = unreadOnly
      ? `**${me.name}** has ${rows.length} unread message(s) (now marked read):`
      : `**${me.name}**'s inbox  -  ${rows.length} message(s):`;

    const lines = rows.map((m) => {
      const from = nameById.get(m.from_agent_id) ?? `agent ${m.from_agent_id}`;
      const unread = m.read_at === null ? " · unread" : "";
      return [
        `- from **${from}** · ${ageOf(m.created_at)}${unread}`,
        `  thread: \`${m.thread_id}\``,
        `  ${m.body}`,
      ].join("\n");
    });

    return text([header, "", ...lines].join("\n") + markNote);
  },
});

export const AGENT_MESSAGING_TOOLS_REGISTERED = true;
