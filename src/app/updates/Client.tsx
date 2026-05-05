"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  RotateCcw,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { jsonFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type ActivityEvent = {
  id: string;
  ts: string;
  kind: string;
  actor_type: string | null;
  actor_id: string | null;
  detail: Record<string, unknown> | null;
};

type Insight = {
  id: string;
  department: string | null;
  severity: string;
  title: string;
  reason: string | null;
  suggested_action: string | null;
  status: string;
  agent_name: string | null;
  generated_by_agent_id: string | null;
  loop_count: number;
  created_at: string;
};

const KIND_META: Record<
  string,
  { label: string; tone: string; Icon: typeof AlertTriangle }
> = {
  insight_created:       { label: "Anomaly detected",         tone: "text-destructive",  Icon: AlertTriangle    },
  insight_approved:      { label: "Operator approved plan",   tone: "text-primary",      Icon: Check            },
  insight_auto_approved: { label: "Atlas auto-approved",      tone: "text-primary",      Icon: Zap              },
  insight_retried:       { label: "Retry - new angle",        tone: "text-amber-300",    Icon: RotateCcw        },
  insight_resolved:      { label: "Metric recovered",         tone: "text-emerald-400",  Icon: TrendingUp       },
  insight_escalated:     { label: "Escalated to human",       tone: "text-destructive",  Icon: AlertTriangle    },
  insight_rejected:      { label: "Operator rejected plan",   tone: "text-muted-foreground", Icon: X            },
  insight_reviewed:      { label: "Atlas reviewed batch",     tone: "text-primary",      Icon: ClipboardCheck   },
  task_created:          { label: "Task spawned",             tone: "text-primary",      Icon: ListChecks       },
  task_executed:         { label: "Task ran",                 tone: "text-emerald-400",  Icon: CheckCircle2     },
  data_ingested:         { label: "Corpus updated",           tone: "text-muted-foreground", Icon: Sparkles     },
  shared_memory_added:   { label: "Shared memory",            tone: "text-muted-foreground", Icon: Sparkles     },
};

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function extractAsk(action: string | null): string | null {
  if (!action) return null;
  const m = action.match(/Question for you[:\*]+\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

export function UpdatesView() {
  const [tab, setTab] = useState<"activity" | "asks">("asks");

  const { data: activity } = useSWR<{ events: ActivityEvent[] }>(
    "/api/activity?limit=80",
    jsonFetcher,
    { refreshInterval: 4000 },
  );
  const { data: insights, mutate: mutateInsights } = useSWR<{
    insights: Insight[];
  }>("/api/insights", jsonFetcher, { refreshInterval: 5000 });

  const events = activity?.events ?? [];
  const allInsights = insights?.insights ?? [];
  const asks = allInsights.filter(
    (i) =>
      (i.status === "open" || i.status === "executing") &&
      extractAsk(i.suggested_action),
  );

  // Counters for the header stat row
  const exec = allInsights.filter((i) => i.status === "executing").length;
  const resolved = events.filter((e) => e.kind === "insight_resolved").length;
  const retries = events.filter((e) => e.kind === "insight_retried").length;
  const reviews = events.filter((e) => e.kind === "insight_reviewed").length;

  return (
    <div className="space-y-4 overflow-x-hidden">
      {/* Run Atlas now */}
      <RunAtlasButton onDone={() => mutateInsights()} />

      {/* stat strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat
          label="Needs your call"
          value={asks.length}
          tone={asks.length > 0 ? "warn" : "muted"}
        />
        <Stat
          label="Executing"
          value={exec}
          tone={exec > 0 ? "good" : "muted"}
        />
        <Stat
          label="Resolved"
          value={resolved}
          tone="good"
        />
        <Stat
          label="Retries"
          value={retries}
          tone="muted"
        />
        <Stat
          label="Reviews"
          value={reviews}
          tone={reviews > 0 ? "good" : "muted"}
        />
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border bg-card/40 p-1">
        <TabBtn
          active={tab === "asks"}
          onClick={() => setTab("asks")}
          label="Needs your call"
          count={asks.length}
          tone={asks.length > 0 ? "warn" : undefined}
        />
        <TabBtn
          active={tab === "activity"}
          onClick={() => setTab("activity")}
          label="Activity"
          count={events.length}
        />
      </div>

      {tab === "asks" ? (
        <AsksList asks={asks} onRefresh={mutateInsights} />
      ) : (
        <ActivityList events={events} />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "muted";
}) {
  const tonClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-300"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
        {label}
      </p>
      <p className={"mt-1 font-serif text-[26px] leading-none tracking-tight " + tonClass}>
        {value}
      </p>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: "warn";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex flex-1 items-center justify-center gap-2 rounded px-4 py-2 text-[12px] font-medium transition-colors " +
        (active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground")
      }
    >
      {label}
      {count > 0 && (
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
            (active
              ? "bg-primary/20 text-primary"
              : tone === "warn"
                ? "bg-amber-400/20 text-amber-300"
                : "bg-muted/40 text-muted-foreground")
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

function AsksList({
  asks,
  onRefresh,
}: {
  asks: Insight[];
  onRefresh: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function approve(id: string) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/insights/${id}/approve`, { method: "POST" });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        tasks?: Array<{ title: string; assigneeName: string }>;
        error?: string;
      };
      if (!r.ok || !body.ok) throw new Error(body.error || "approve failed");
      toast.success(
        `Plan executing - ${body.tasks?.length ?? 0} task${(body.tasks?.length ?? 0) === 1 ? "" : "s"} spawned`,
      );
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!confirm("Reject this plan?")) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/insights/${id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "operator rejected" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Rejected");
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (asks.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-card/40 p-6 text-center">
        <Sparkles className="size-4 text-primary/50" />
        <p className="text-[12px] text-muted-foreground">
          No questions right now. Atlas and the dept heads will post here when they need a decision.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
        {asks.length} question{asks.length === 1 ? "" : "s"} waiting for your call
      </p>
      <ul className="space-y-4">
      {asks.map((ins) => {
        const ask = extractAsk(ins.suggested_action) ?? "";
        const tone =
          ins.severity === "critical"
            ? "border-destructive/40 bg-destructive/5"
            : ins.severity === "warning"
              ? "border-amber-400/40 bg-amber-400/5"
              : "border-border bg-card/40";
        return (
          <li
            key={ins.id}
            className={"rounded-md border p-5 " + tone}
          >
            <div className="flex items-start gap-3">
              <MessageCircleQuestion
                className="mt-0.5 size-4 shrink-0 text-primary"
                strokeWidth={1.6}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {ins.agent_name ?? "Agent"} ·{" "}
                  {ins.department ?? "cross-dept"}
                  {ins.loop_count > 0 ? ` · attempt ${ins.loop_count + 1}` : ""}
                  {" · "}
                  <span className="text-foreground">{ins.title}</span>
                </p>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                  {ask}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
              <Button
                size="sm"
                onClick={() => approve(ins.id)}
                disabled={busyId === ins.id}
              >
                {busyId === ins.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" strokeWidth={2} />
                )}
                Yes - approve plan
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => reject(ins.id)}
                disabled={busyId === ins.id}
              >
                <X className="size-3.5" strokeWidth={2} />
                No - reject
              </Button>
              {ins.generated_by_agent_id && (
                <Link
                  href={`/chat?agent=${ins.generated_by_agent_id}&prefill=${encodeURIComponent("About: " + ins.title + " - ")}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <ChevronRight className="size-3.5" strokeWidth={1.8} />
                  Discuss with {ins.agent_name ?? "agent"}
                </Link>
              )}
            </div>
          </li>
        );
      })}
      </ul>
    </div>
  );
}

type ActivityFilter = "all" | "agents" | "tasks" | "anomalies" | "system";

const FILTERS: Array<{ id: ActivityFilter; label: string; kinds: string[] }> = [
  { id: "all", label: "All", kinds: [] },
  { id: "anomalies", label: "Anomalies", kinds: ["insight_created","insight_approved","insight_auto_approved","insight_retried","insight_resolved","insight_escalated","insight_rejected"] },
  { id: "tasks", label: "Tasks", kinds: ["task_created","task_executed"] },
  { id: "agents", label: "Memory", kinds: ["chat_memory","shared_memory_added","data_ingested"] },
  { id: "system", label: "System", kinds: ["claude_max_token_refreshed","autonomous_settings_updated"] },
];

function ActivityList({ events }: { events: ActivityEvent[] }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const filtered = active.kinds.length === 0
    ? events
    : events.filter((e) => active.kinds.includes(e.kind));

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/40 p-5 text-center">
        <p className="text-[12px] text-muted-foreground">
          No activity yet. As soon as an agent runs, you will see it stream in.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const isActive = filter === f.id;
          const count = f.kinds.length === 0 ? events.length : events.filter((e) => f.kinds.includes(e.kind)).length;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors " +
                (isActive
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card/40 text-muted-foreground hover:border-primary/30 hover:text-foreground")
              }
            >
              {f.label}
              <span className="font-mono text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <ol className="space-y-2">
        {filtered.map((e) => {
          const meta =
            KIND_META[e.kind] ?? {
              label: e.kind.replace(/_/g, " "),
              tone: "text-muted-foreground",
              Icon: Sparkles,
            };
          const Icon = meta.Icon;
          const detail = e.detail ?? {};
          const summary =
            (detail.title as string | undefined) ??
            (detail.metric as string | undefined) ??
            (detail.message as string | undefined) ??
            (detail.routine_id
              ? `routine ${(detail.routine_id as string).slice(0, 8)}`
              : "");
          const isOpen = expandedId === e.id;
          const hasDetail = Object.keys(detail).length > 0;
          const reply = (detail as { reply_excerpt?: string }).reply_excerpt;
          const tasksSpawned = (detail as { tasks_spawned?: number }).tasks_spawned;
          const taskIds = (detail as { task_ids?: string[] }).task_ids;
          const insightId = (detail as { insight_id?: string }).insight_id;

          return (
            <li
              key={e.id}
              className="rounded-md border border-border bg-card/40 transition-colors hover:border-primary/30"
            >
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : e.id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left"
              >
                <Icon
                  className={"mt-0.5 size-4 shrink-0 " + meta.tone}
                  strokeWidth={1.8}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={"text-[12px] font-medium " + meta.tone}>
                      {meta.label}
                    </p>
                    <time className="shrink-0 text-[10px] text-muted-foreground">
                      {fmtTs(e.ts)}
                    </time>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {e.actor_type === "agent" ? "agent" : (e.actor_type ?? "system")}
                    {summary ? ` · ${summary}` : ""}
                  </p>
                </div>
                {hasDetail && (
                  <ChevronRight
                    className={
                      "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform " +
                      (isOpen ? "rotate-90" : "")
                    }
                    strokeWidth={1.8}
                  />
                )}
              </button>

              {isOpen && hasDetail && (
                <div className="space-y-4 border-t border-border/60 px-5 py-4">
                  {/* HUMAN-READABLE summary block (no jargon, no raw ids) */}
                  <HumanSummary kind={e.kind} detail={detail} actorType={e.actor_type} />

                  {/* Review check-off list (only on insight_reviewed) */}
                  {e.kind === "insight_reviewed" && (
                    <ReviewCheckoff detail={detail} />
                  )}

                  {/* Quick-link badges - compact, only the meaningful ones */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    {(detail as { routine_id?: string }).routine_id && (
                      <Link
                        href={`/tasks/${(detail as { routine_id?: string }).routine_id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card/50 px-2 py-0.5 text-primary hover:border-primary/40"
                      >
                        Open task →
                      </Link>
                    )}
                    {insightId && (
                      <span className="rounded-md border border-border bg-card/50 px-2 py-0.5 text-muted-foreground">
                        on anomaly
                      </span>
                    )}
                    {typeof tasksSpawned === "number" && tasksSpawned > 0 && (
                      <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">
                        {tasksSpawned} task{tasksSpawned === 1 ? "" : "s"} spawned
                      </span>
                    )}
                    {(detail as { attempt?: number }).attempt && (
                      <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-300">
                        iteration {(detail as { attempt?: number }).attempt}
                      </span>
                    )}
                  </div>

                  {/* Reply / output preview */}
                  {reply && (
                    <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                      <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-primary">
                        What the agent said
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
                        {reply}
                      </p>
                    </div>
                  )}

                  {/* Spawned task chips */}
                  {Array.isArray(taskIds) && taskIds.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                        Spawned sub-tasks
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {taskIds.slice(0, 6).map((id) => (
                          <Link
                            key={id}
                            href={`/tasks/${id}`}
                            className="rounded-md border border-border bg-card/50 px-2.5 py-1 font-mono text-[10px] text-primary hover:border-primary/40"
                          >
                            {id.slice(0, 8)}
                          </Link>
                        ))}
                        {taskIds.length > 6 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{taskIds.length - 6} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Raw JSON dump - DEV ONLY, collapsed by default */}
                  <details className="group">
                    <summary className="cursor-pointer text-[10px] uppercase tracking-[1.5px] text-muted-foreground/60 hover:text-muted-foreground">
                      Developer payload (raw JSON)
                    </summary>
                    <pre className="mt-1.5 overflow-x-auto rounded-md border border-border/40 bg-muted/10 p-2.5 font-mono text-[10px] leading-relaxed text-foreground/80">
                      {JSON.stringify(detail, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {filtered.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-card/40 p-5 text-center">
          <p className="text-[12px] text-muted-foreground">
            No events match this filter yet.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Human-readable single-paragraph summary of an audit event.
 * Replaces "agent_id: 3ba8cedb-..." raw ids with prose the operator
 * actually understands.
 */
function HumanSummary({
  kind,
  detail,
  actorType,
}: {
  kind: string;
  detail: Record<string, unknown>;
  actorType: string | null;
}) {
  const title = (detail.title as string | undefined) ?? "";
  const metric = (detail.metric as string | undefined) ?? "";
  const severity = (detail.severity as string | undefined) ?? "";
  const dept = (detail.department as string | undefined) ?? "";
  const attempt = (detail.attempt as number | undefined);
  const tasks = (detail.tasks_spawned as number | undefined) ?? 0;
  const message = (detail.message as string | undefined) ?? "";
  const actor = actorType === "user" ? "You" : actorType === "agent" ? "An agent" : "The system";

  let summary = "";
  switch (kind) {
    case "insight_created":
      summary = `${actor} flagged a ${severity || "metric"} anomaly${dept ? ` in ${dept}` : ""}: "${title}". A drill-down plan was drafted and is waiting for approval.`;
      break;
    case "insight_approved":
      summary = `${actor} approved the plan for "${title || "this anomaly"}" - ${tasks} sub-task${tasks === 1 ? "" : "s"} just spawned for the dept head to coordinate.`;
      break;
    case "insight_auto_approved":
      summary = `Atlas auto-approved the plan (autonomous mode = on). Sub-tasks fired without operator gate.`;
      break;
    case "insight_retried":
      summary = `Previous plan didn't move "${metric || "the metric"}". Atlas tried iteration ${attempt ?? "N"} with a different angle.`;
      break;
    case "insight_resolved":
      summary = `Metric "${metric || title}" recovered. Anomaly auto-closed by the loop check.`;
      break;
    case "insight_escalated":
      summary = `Loop hit max iterations without recovering "${metric || title}". Escalated to human.`;
      break;
    case "insight_rejected":
      summary = `${actor} rejected the proposed plan${message ? ` (${message})` : ""}.`;
      break;
    case "insight_reviewed": {
      const verdict = (detail.verdict as string | undefined) ?? "";
      const scores = (detail.scores as Array<{ score: number }> | undefined) ?? [];
      const passed = scores.filter((s) => s.score >= 3).length;
      summary = `Atlas reviewed ${scores.length} task${scores.length === 1 ? "" : "s"}: ${passed}/${scores.length} delivered. Verdict: ${verdict || "pending"}.`;
      break;
    }
    case "task_created":
      summary = `Task spawned: "${title}". Routed to its assignee for execution.`;
      break;
    case "task_executed":
      summary = `Task ran end-to-end: "${title}". Output captured.`;
      break;
    case "data_ingested":
      summary = `${actor} added ${(detail.chunks as number | undefined) ?? "?"} chunks to the company corpus (${(detail.source as string | undefined) ?? "manual"}). Searchable by every agent now.`;
      break;
    case "shared_memory_added":
      summary = `New shared org fact added. All peer agents see it on their next reply.`;
      break;
    case "claude_max_token_refreshed":
      summary = `Auth token rotated automatically. No action needed.`;
      break;
    case "autonomous_settings_updated":
      summary = `Autonomous mode settings changed (mode/iterations).`;
      break;
    default:
      summary = message || `Event: ${kind.replace(/_/g, " ")}.`;
  }

  return (
    <p className="text-[12.5px] leading-relaxed text-foreground">
      {summary}
    </p>
  );
}

/**
 * Per-task check-off list. Renders one row per scored task.
 * Click a row -> expands and shows the per-task feedback line.
 *   score >= 3 -> CheckCircle2 (good)
 *   score 1-2  -> AlertTriangle (warn)
 */
type ReviewScore = {
  routine_id: string;
  score: number;
  feedback: string;
};

function ReviewCheckoff({ detail }: { detail: Record<string, unknown> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const scores = (detail.scores as ReviewScore[] | undefined) ?? [];
  const verdict = (detail.verdict as string | undefined) ?? "";
  if (scores.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Review ran but no per-task scores were captured.
      </p>
    );
  }
  const passed = scores.filter((s) => s.score >= 3).length;
  const verdictTone =
    verdict === "PASS"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
      : "border-amber-400/40 bg-amber-400/10 text-amber-300";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
          Per-task scorecard ({passed}/{scores.length} delivered)
        </p>
        {verdict && (
          <span
            className={
              "rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
              verdictTone
            }
          >
            {verdict}
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {scores.map((s) => {
          const ok = s.score >= 3;
          const isOpen = openId === s.routine_id;
          const Icon = ok ? CheckCircle2 : AlertTriangle;
          const tone = ok ? "text-emerald-400" : "text-amber-300";
          return (
            <li
              key={s.routine_id}
              className="rounded-md border border-border bg-card/40"
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : s.routine_id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left"
              >
                <Icon
                  className={"size-4 shrink-0 " + tone}
                  strokeWidth={1.8}
                />
                <span className="flex-1 truncate font-mono text-[11px] text-foreground">
                  task {s.routine_id.slice(0, 8)}
                </span>
                <span className={"text-[11px] font-semibold " + tone}>
                  {s.score}/5
                </span>
                <ChevronRight
                  className={
                    "size-3.5 shrink-0 text-muted-foreground transition-transform " +
                    (isOpen ? "rotate-90" : "")
                  }
                  strokeWidth={1.6}
                />
              </button>
              {isOpen && (
                <div className="border-t border-border/40 px-3 py-2">
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    {s.feedback || "(no feedback captured)"}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RunAtlasButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  async function run() {
    setRunning(true);
    try {
      const r = await fetch("/api/insights?sweep=true", { method: "POST" });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        created?: number;
        retried?: number;
        resolved?: number;
        escalated?: number;
        error?: string;
      };
      if (!r.ok || !body.ok) throw new Error(body.error || "sweep failed");
      const parts: string[] = [];
      if (body.created) parts.push(`${body.created} new`);
      if (body.retried) parts.push(`${body.retried} retried`);
      if (body.resolved) parts.push(`${body.resolved} resolved`);
      if (body.escalated) parts.push(`${body.escalated} escalated`);
      toast.success(parts.length ? `Atlas swept: ${parts.join(", ")}` : "Atlas swept - no changes");
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/40 px-4 py-3">
      <div>
        <p className="text-[12px] font-medium text-foreground">Atlas autoresearch</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Sweep all 5 depts now: detect anomalies, council debate, draft plans, retry stuck loops.
        </p>
      </div>
      <Button onClick={run} disabled={running} size="sm">
        {running ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Atlas thinking...
          </>
        ) : (
          <>
            <Sparkles className="size-3.5" />
            Run Atlas now
          </>
        )}
      </Button>
    </div>
  );
}
