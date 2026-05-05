"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Bell, MessageCircleQuestion, Sparkles, X } from "lucide-react";
import { jsonFetcher } from "@/lib/swr";

type Notification = {
  id: string;
  agent_id: string;
  agent_name: string;
  content: string;
  created_at: string;
  kind: string;
};

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString();
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useSWR<{ notifications: Notification[] }>(
    "/api/notifications/agents",
    jsonFetcher,
    { refreshInterval: 5000 },
  );
  const notifs = data?.notifications ?? [];
  const count = notifs.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          "relative flex size-8 items-center justify-center rounded-md border border-border bg-card/50 transition-colors hover:bg-card " +
          (count > 0 ? "text-primary" : "text-muted-foreground")
        }
        aria-label={`${count} agent notifications`}
      >
        <Bell className="size-4" strokeWidth={1.6} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-9 z-50 w-[360px] overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
                Agent messages ({count})
              </h4>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={1.8} />
              </button>
            </div>
            <ul className="max-h-[420px] divide-y divide-border/40 overflow-y-auto">
              {notifs.length === 0 && (
                <li className="px-4 py-6 text-center">
                  <Sparkles className="mx-auto size-4 text-muted-foreground/50" />
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    No agent messages yet. Atlas pings here when he spots an anomaly.
                  </p>
                </li>
              )}
              {notifs.map((n) => {
                const Icon =
                  n.kind === "data_ask" ? MessageCircleQuestion : Sparkles;
                return (
                  <li key={n.id}>
                    <Link
                      href={`/chat?agent=${n.agent_id}`}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
                    >
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-primary" strokeWidth={1.8} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[12px] font-medium text-foreground">
                            {n.agent_name}
                          </p>
                          <time className="text-[10px] text-muted-foreground">
                            {fmtTs(n.created_at)}
                          </time>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                          {n.content}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {notifs.length > 0 && (
              <Link
                href="/updates"
                onClick={() => setOpen(false)}
                className="block border-t border-border px-4 py-2 text-center text-[11px] font-medium text-primary hover:bg-muted/20"
              >
                See all in Updates →
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
