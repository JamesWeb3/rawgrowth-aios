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
    return createClient(url, key, {
      realtime: { params: { eventsPerSecond: 10 } },
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
          <span className="font-mono text-[11px] uppercase tracking-widest text-primary">
            {r.kind}
          </span>
          <span className="text-[var(--text-body)]">
            {typeof r.detail?.summary === "string"
              ? r.detail.summary
              : r.actor_type === "agent"
                ? `agent ${r.actor_id ?? ""}`
                : r.actor_type ?? ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
