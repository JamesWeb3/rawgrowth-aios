"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

type AuditRow = {
  id: string;
  ts: string;
  kind: string;
  actor_type: string | null;
  actor_id: string | null;
  detail: Record<string, unknown> | null;
};

/**
 * Live activity feed backed by Supabase Realtime. Subscribes to INSERTs
 * on rgaios_audit_log filtered by organization_id so each VPS only
 * sees its own events. Anon key + URL are baked into the bundle  - 
 * RLS on rgaios_audit_log (0016 + 0015) scopes the subscription to
 * the caller's org.
 *
 * Falls back to initialRows if Realtime is not available (e.g. dev
 * without a configured Supabase project).
 */
export function LiveActivityFeed({
  initialRows,
  organizationId,
}: {
  initialRows: AuditRow[];
  organizationId: string;
}) {
  const [rows, setRows] = useState<AuditRow[]>(initialRows);

  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    // Disable session/token refresh - we only use this client for
    // anon-keyed Realtime, and leaving auth on triggers a duplicate
    // GoTrueClient warning when the auth-side Supabase client also boots.
    return createClient(url, key, {
      realtime: { params: { eventsPerSecond: 10 } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }, []);

  useEffect(() => {
    if (!client) return;
    const channel: RealtimeChannel = client
      .channel(`audit:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "rgaios_audit_log",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          setRows((prev) => [payload.new as AuditRow, ...prev].slice(0, 50));
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [client, organizationId]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No activity yet. Kick a routine or send a Telegram message to see
        the feed come alive.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex items-baseline gap-3 border-b border-[var(--line)] py-2 text-sm"
        >
          <time className="w-24 shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
            {new Date(r.ts).toLocaleTimeString()}
          </time>
          <span
            className={
              "font-mono text-[11px] uppercase tracking-widest " +
              kindTone(r.kind)
            }
          >
            {r.kind}
          </span>
          <span className="text-[var(--text-body)]">
            {summarize(r)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function kindTone(kind: string): string {
  if (kind === "task_executed") return "text-[#aad08f]";
  if (kind === "task_created") return "text-primary";
  if (kind === "chat_reply_failed") return "text-[#f4b27a]";
  if (kind === "chat_memory") return "text-muted-foreground";
  if (kind.startsWith("run_")) return "text-amber-300";
  return "text-primary";
}

function summarize(r: AuditRow): string {
  const d = r.detail ?? {};
  if (typeof d.summary === "string") return d.summary;
  if (r.kind === "task_created" || r.kind === "task_executed") {
    const title = typeof d.title === "string" ? d.title : "";
    const delegated =
      typeof d.delegated_from === "string" || typeof d.delegated_by === "string";
    return delegated
      ? `${r.kind === "task_executed" ? "completed" : "got"} task: "${title}"`
      : `task: "${title}"`;
  }
  if (r.kind === "chat_memory") {
    const fact = typeof d.fact === "string" ? d.fact : "";
    return fact.slice(0, 120);
  }
  if (r.kind === "chat_reply_failed") {
    return typeof d.error === "string" ? d.error.slice(0, 120) : "chat failed";
  }
  if (r.kind.startsWith("run_") || r.kind === "connection_connected" || r.kind === "connection_disconnected") {
    const provider = typeof d.provider === "string" ? d.provider : "";
    const runId =
      typeof d.run_id === "string" ? d.run_id.slice(0, 8) : "";
    return [provider, runId].filter(Boolean).join(" ");
  }
  return r.actor_type === "agent" ? `agent ${r.actor_id ?? ""}` : r.actor_type ?? "";
}
