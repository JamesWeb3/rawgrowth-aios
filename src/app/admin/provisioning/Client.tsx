"use client";

import { useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Play, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

type Row = {
  id: string;
  owner_email: string | null;
  owner_name: string | null;
  plan_name: string | null;
  status: string;
  vps_url: string | null;
  dashboard_url: string | null;
  error: string | null;
  created_at: string;
};

const STATUS_META: Record<
  string,
  { label: string; tone: string; Icon: typeof CheckCircle2 }
> = {
  queued:      { label: "Queued",        tone: "text-muted-foreground", Icon: Clock          },
  provisioning: { label: "Provisioning", tone: "text-amber-300",        Icon: Loader2        },
  ready:       { label: "Ready",         tone: "text-emerald-400",      Icon: CheckCircle2   },
  error:       { label: "Error",         tone: "text-destructive",      Icon: AlertTriangle  },
};

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function ProvisioningClient({ initial }: { initial: Row[] }) {
  const { data, mutate } = useSWR<{ queue: Row[] }>(
    "/api/admin/provisioning",
    jsonFetcher,
    { fallbackData: { queue: initial }, refreshInterval: 5000 },
  );
  const queue = data?.queue ?? initial;
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const r = await fetch("/api/admin/provision-now", { method: "POST" });
      const body = (await r.json().catch(() => ({}))) as {
        status?: number;
        processed?: number;
        results?: unknown[];
        error?: string;
      };
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      toast.success(
        `Provision tick ran - processed ${body.processed ?? 0} row${body.processed === 1 ? "" : "s"}`,
      );
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const counts = {
    queued: queue.filter((r) => r.status === "queued").length,
    provisioning: queue.filter((r) => r.status === "provisioning").length,
    ready: queue.filter((r) => r.status === "ready").length,
    error: queue.filter((r) => r.status === "error").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/40 px-4 py-3">
        <div className="flex items-center gap-4 text-[12px]">
          <span>
            <span className="text-muted-foreground">Queued:</span>{" "}
            <span className="font-mono text-foreground">{counts.queued}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Provisioning:</span>{" "}
            <span className="font-mono text-amber-300">{counts.provisioning}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Ready:</span>{" "}
            <span className="font-mono text-emerald-400">{counts.ready}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Error:</span>{" "}
            <span className="font-mono text-destructive">{counts.error}</span>
          </span>
        </div>
        <Button onClick={run} disabled={running} size="sm">
          {running ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Running tick
            </>
          ) : (
            <>
              <Play className="size-3.5" />
              Provision now
            </>
          )}
        </Button>
      </div>

      {queue.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/30 p-8 text-center">
          <p className="text-[12px] text-muted-foreground">
            No buyers in queue. Stripe webhook will populate as new payments land.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {queue.map((r) => {
            const meta =
              STATUS_META[r.status] ?? STATUS_META.queued;
            const Icon = meta.Icon;
            return (
              <li
                key={r.id}
                className="rounded-md border border-border bg-card/40 px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={
                      "mt-0.5 size-4 shrink-0 " +
                      meta.tone +
                      (r.status === "provisioning" ? " animate-spin" : "")
                    }
                    strokeWidth={1.8}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[13px] font-medium text-foreground">
                        {r.owner_name ?? r.owner_email ?? "(anonymous)"}
                      </p>
                      <time className="shrink-0 text-[10px] text-muted-foreground">
                        {fmtTs(r.created_at)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.plan_name ?? "no plan"}
                      {r.owner_email ? ` · ${r.owner_email}` : ""}
                    </p>
                    <p className={"mt-1 text-[11px] " + meta.tone}>
                      {meta.label}
                      {r.dashboard_url ? (
                        <>
                          {" · "}
                          <a
                            href={r.dashboard_url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:no-underline"
                          >
                            open dashboard
                          </a>
                        </>
                      ) : null}
                    </p>
                    {r.error && (
                      <p className="mt-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 font-mono text-[10px] text-destructive">
                        {r.error}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                      portal: /portal/{r.id}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
