"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  X,
  Sparkles,
  Loader2,
  MessageSquare,
} from "lucide-react";

type Insight = {
  id: string;
  department: string | null;
  kind: string;
  severity: "critical" | "warning" | "info" | "positive";
  metric: string;
  current_value: number | null;
  prior_value: number | null;
  delta_pct: number | null;
  title: string;
  reason: string | null;
  suggested_action: string | null;
  status: string;
  chat_state?: "none" | "queued" | "sent" | "answered";
  agent_name: string | null;
  loop_count?: number;
  created_at: string;
};

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-amber-400/10 text-amber-300 border-amber-400/30",
  info: "bg-muted/40 text-muted-foreground border-border",
  positive: "bg-primary/10 text-primary border-primary/30",
};

const SEVERITY_ICON: Record<
  string,
  { Icon: typeof AlertTriangle; tone: string }
> = {
  critical: { Icon: AlertTriangle, tone: "text-destructive" },
  warning: { Icon: TrendingDown, tone: "text-amber-300" },
  info: { Icon: TrendingDown, tone: "text-muted-foreground" },
  positive: { Icon: TrendingUp, tone: "text-primary" },
};

export function InsightsPanel({
  department,
}: {
  department?: string | null;
}) {
  const url = department
    ? `/api/insights?department=${encodeURIComponent(department)}`
    : "/api/insights";
  const { data, mutate, isLoading } = useSWR<{ insights: Insight[] }>(
    url,
    jsonFetcher,
    { refreshInterval: 30_000 },
  );
  const [generating, setGenerating] = useState(false);
  const [openingChat, setOpeningChat] = useState<string | null>(null);
  const router = useRouter();

  async function openChat(id: string) {
    setOpeningChat(id);
    try {
      const res = await fetch(`/api/insights/${id}/open-chat`, {
        method: "POST",
      });
      const body = (await res.json()) as {
        ok?: boolean;
        agentId?: string;
        queued?: boolean;
        position?: number;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "open-chat failed");
      }
      if (body.queued) {
        toast.message(
          `Queued (#${body.position}) - Atlas will ask after the current question is answered.`,
        );
      } else if (body.agentId) {
        router.push(`/agents/${body.agentId}?tab=chat`);
      }
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOpeningChat(null);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const target = department
        ? `/api/insights?department=${encodeURIComponent(department)}`
        : `/api/insights?sweep=true`;
      const res = await fetch(target, { method: "POST" });
      const body = (await res.json()) as {
        ok?: boolean;
        created?: number;
        skipped?: number;
        errors?: string[];
      };
      if (!res.ok || !body.ok) {
        throw new Error("generate failed");
      }
      toast.success(
        `Created ${body.created ?? 0} insight${body.created === 1 ? "" : "s"}` +
          (body.skipped ? ` (${body.skipped} skipped)` : ""),
      );
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function setStatus(id: string, status: "acknowledged" | "dismissed") {
    try {
      const res = await fetch(`/api/insights/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const insights = data?.insights ?? [];

  return (
    <section id="insights" className="rounded-md border border-border bg-card/40 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <Sparkles className="size-4 text-primary" strokeWidth={1.6} />
            {department
              ? `${department.charAt(0).toUpperCase() + department.slice(1)} insights`
              : "Atlas insights"}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {department
              ? "Anomalies and opportunities for this department, drilled down by the dept head."
              : "Cross-department patterns Atlas spotted in the last 7 days vs the prior 7."}
          </p>
        </div>
        <Button size="sm" onClick={generate} disabled={generating}>
          {generating ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 size-3.5" />
              Run analysis
            </>
          )}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <div className="h-20 animate-pulse rounded-md bg-muted/20" />
          <div className="h-20 animate-pulse rounded-md bg-muted/20" />
        </div>
      )}

      {!isLoading && insights.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-muted/10 p-6 text-center">
          <p className="text-[12px] font-medium text-foreground">
            No anomalies right now
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Hit Run analysis to drill into the last week vs the week before.
            Atlas + the dept heads will flag what changed and propose a
            specific next step.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {insights.map((ins) => {
          const meta = SEVERITY_ICON[ins.severity] ?? SEVERITY_ICON.info;
          const Icon = meta.Icon;
          const muted = ins.status === "acknowledged";
          return (
            <div
              key={ins.id}
              className={
                "rounded-md border p-4 transition-opacity " +
                SEVERITY_TONE[ins.severity] +
                (muted ? " opacity-60" : "")
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className={"size-3.5 " + meta.tone} strokeWidth={2} />
                    <h4 className="text-[13px] font-semibold text-foreground">
                      {ins.title}
                    </h4>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {ins.department ?? "cross-dept"}
                    {ins.agent_name ? ` · drilled by ${ins.agent_name}` : ""}
                    {ins.loop_count && ins.loop_count > 0
                      ? ` · attempt ${ins.loop_count + 1}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!muted && (
                    <button
                      type="button"
                      onClick={() => openChat(ins.id)}
                      disabled={openingChat === ins.id}
                      title={
                        ins.chat_state === "sent"
                          ? "Continue in Atlas chat"
                          : ins.chat_state === "queued"
                            ? "Queued - waiting for current question"
                            : "Send to Atlas chat"
                      }
                      className={
                        "rounded-md p-1 hover:bg-card/50 disabled:opacity-50 " +
                        (ins.chat_state === "queued"
                          ? "text-amber-300"
                          : ins.chat_state === "sent"
                            ? "text-primary"
                            : "text-muted-foreground hover:text-primary")
                      }
                    >
                      {openingChat === ins.id ? (
                        <Loader2
                          className="size-3.5 animate-spin"
                          strokeWidth={1.6}
                        />
                      ) : (
                        <MessageSquare className="size-3.5" strokeWidth={1.6} />
                      )}
                    </button>
                  )}
                  {!muted && (
                    <button
                      type="button"
                      onClick={() => setStatus(ins.id, "acknowledged")}
                      title="Acknowledge"
                      className="rounded-md p-1 text-muted-foreground hover:bg-card/50 hover:text-foreground"
                    >
                      <CheckCircle2 className="size-3.5" strokeWidth={1.6} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setStatus(ins.id, "dismissed")}
                    title="Dismiss for 24h"
                    className="rounded-md p-1 text-muted-foreground hover:bg-card/50 hover:text-destructive"
                  >
                    <X className="size-3.5" strokeWidth={1.6} />
                  </button>
                </div>
              </div>
              {ins.reason && (
                <div className="mt-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Reason
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
                    {ins.reason}
                  </p>
                </div>
              )}
              {ins.suggested_action && (
                <div className="mt-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-primary">
                    Suggested action
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
                    {ins.suggested_action}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
