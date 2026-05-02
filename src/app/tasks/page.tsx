import Link from "next/link";
import { redirect } from "next/navigation";
import { ListChecks, ArrowRight } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import {
  getAllowedDepartments,
  filterAgentsByDept,
} from "@/lib/auth/dept-acl";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RoutineRow = {
  id: string;
  title: string | null;
  description: string | null;
  assignee_agent_id: string | null;
  status: string | null;
  created_at: string | null;
};
type RunRow = {
  id: string;
  routine_id: string;
  status: string;
  source: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  output_payload: Record<string, unknown> | null;
};
type AgentRow = {
  id: string;
  name: string;
  role: string | null;
  department: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-400/10 text-amber-300",
  running: "bg-primary/10 text-primary",
  succeeded: "bg-[#0f1a0d] text-[#aad08f]",
  failed: "bg-[#1a0b08] text-[#f4b27a]",
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  const ms = Date.now() - t;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default async function TasksPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) redirect("/auth/signin");
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const allowedDepts = await getAllowedDepartments({
    userId: ctx.userId,
    organizationId: orgId,
    isAdmin: ctx.isAdmin,
  });

  const [{ data: routinesRaw }, { data: agentsRaw }] = await Promise.all([
    db
      .from("rgaios_routines")
      .select("id, title, description, assignee_agent_id, status, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("rgaios_agents")
      .select("id, name, role, department")
      .eq("organization_id", orgId),
  ]);
  const allAgents = (agentsRaw ?? []) as AgentRow[];
  const scopedAgents = filterAgentsByDept(allAgents, allowedDepts);
  const allowedAgentIds = new Set(scopedAgents.map((a) => a.id));
  const agentById = new Map(scopedAgents.map((a) => [a.id, a]));

  const routines = ((routinesRaw ?? []) as RoutineRow[]).filter((r) =>
    r.assignee_agent_id ? allowedAgentIds.has(r.assignee_agent_id) : ctx.isAdmin,
  );

  const routineIds = routines.map((r) => r.id);
  const { data: runsRaw } = routineIds.length
    ? await db
        .from("rgaios_routine_runs")
        .select(
          "id, routine_id, status, source, started_at, completed_at, created_at, output_payload",
        )
        .eq("organization_id", orgId)
        .in("routine_id", routineIds)
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] };
  const runs = (runsRaw ?? []) as RunRow[];
  const runsByRoutine = new Map<string, RunRow[]>();
  for (const r of runs) {
    if (!runsByRoutine.has(r.routine_id)) runsByRoutine.set(r.routine_id, []);
    runsByRoutine.get(r.routine_id)!.push(r);
  }

  const total = routines.length;
  const pending = runs.filter((r) => r.status === "pending").length;
  const running = runs.filter((r) => r.status === "running").length;
  const succeeded = runs.filter((r) => r.status === "succeeded").length;
  const failed = runs.filter((r) => r.status === "failed").length;

  return (
    <PageShell
      title="Tasks"
      description="Every routine + run across your AI org. Tasks created via chat (the &lt;task&gt; blocks) land here too."
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total tasks" value={total} />
        <StatCard label="Pending" value={pending} accent="amber" />
        <StatCard label="Running" value={running} accent="sky" />
        <StatCard label="Succeeded" value={succeeded} accent="green" />
        <StatCard label="Failed" value={failed} accent="red" />
      </div>

      <div className="mt-8 space-y-3">
        {total === 0 && (
          <div className="rounded-md border border-dashed border-border bg-card/30 p-10 text-center">
            <ListChecks className="mx-auto size-8 text-primary/60" strokeWidth={1.4} />
            <p className="mt-3 text-sm font-medium text-foreground">
              No tasks yet
            </p>
            <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
              Open any agent → Chat tab → ask them to create a task. The agent
              emits a &lt;task&gt; block, the system creates a routine + run,
              and it lands here.
            </p>
          </div>
        )}

        {routines.map((r) => {
          const agent = r.assignee_agent_id
            ? agentById.get(r.assignee_agent_id)
            : null;
          const taskRuns = runsByRoutine.get(r.id) ?? [];
          const lastRun = taskRuns[0];
          const lastStatus = lastRun?.status ?? "pending";
          return (
            <div
              key={r.id}
              className="rounded-md border border-border bg-card/40 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        "inline-block rounded px-2 py-0.5 text-[10px] uppercase tracking-widest " +
                        (STATUS_STYLE[lastStatus] ??
                          "bg-muted text-muted-foreground")
                      }
                    >
                      {lastStatus}
                    </span>
                    <h3 className="truncate text-[14px] font-medium text-foreground">
                      {r.title ?? "Untitled"}
                    </h3>
                    {agent && (
                      <Link
                        href={`/agents/${agent.id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                      >
                        {agent.name}
                        <ArrowRight className="size-2.5" strokeWidth={2} />
                      </Link>
                    )}
                  </div>
                  {r.description && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
                      {r.description}
                    </p>
                  )}
                  {lastRun?.output_payload &&
                    typeof (lastRun.output_payload as { reply?: string })
                      .reply === "string" && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-primary">
                          Latest output
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-[12px] leading-relaxed text-foreground">
                          {String(
                            (lastRun.output_payload as { reply: string })
                              .reply,
                          )}
                        </pre>
                      </details>
                    )}
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  {fmtRelative(r.created_at)}
                  <div className="mt-0.5 font-mono">{taskRuns.length} run{taskRuns.length === 1 ? "" : "s"}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "amber" | "sky" | "green" | "red";
}) {
  const tone =
    accent === "amber"
      ? "text-amber-300"
      : accent === "sky"
        ? "text-primary"
        : accent === "green"
          ? "text-[#aad08f]"
          : accent === "red"
            ? "text-[#f4b27a]"
            : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card/40 p-4">
      <div className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-serif text-2xl tracking-tight ${tone}`}>
        {value}
      </div>
    </div>
  );
}
