import Link from "next/link";
import { Crown, MessageSquare, GitBranch } from "lucide-react";

import type { Agent } from "@/lib/agents/dto";
import { Badge } from "@/components/ui/badge";

const DEPT_ORDER = ["marketing", "sales", "fulfilment", "finance", "development"] as const;

const DEPT_LABEL: Record<string, string> = {
  marketing: "Marketing",
  sales: "Sales",
  fulfilment: "Fulfilment",
  finance: "Finance",
  development: "Development",
};

export function AgentsByDeptView({ agents }: { agents: Agent[] }) {
  const ceo = agents.find((a) => a.role === "ceo");
  const byDept = new Map<string, Agent[]>();
  for (const a of agents) {
    if (a.role === "ceo") continue;
    const key = a.department ?? "_unassigned";
    const list = byDept.get(key) ?? [];
    list.push(a);
    byDept.set(key, list);
  }
  // Sort each dept: heads first, then sub-agents alphabetically.
  for (const list of byDept.values()) {
    list.sort((a, b) => {
      if (a.isDepartmentHead !== b.isDepartmentHead) return a.isDepartmentHead ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  const orderedDepts: string[] = [
    ...DEPT_ORDER.filter((d) => byDept.has(d)),
    ...Array.from(byDept.keys()).filter((d) => !(DEPT_ORDER as readonly string[]).includes(d) && d !== "_unassigned"),
    ...(byDept.has("_unassigned") ? ["_unassigned"] : []),
  ];

  return (
    <div className="space-y-8">
      {ceo && (
        <section className="rounded-md border border-border bg-card/40 p-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md border border-border bg-primary/10 text-primary">
              <Crown className="size-5" />
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                Coordinator
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Sits above every department, routes work to the right head.
              </p>
            </div>
          </div>
          <AgentLink agent={ceo} accent />
        </section>
      )}

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          <Link href="/agents/tree" className="text-primary hover:underline inline-flex items-center gap-1">
            <GitBranch className="size-3" /> See the full org tree
          </Link>{" "}
          for the connected hierarchy view.
        </p>
      </div>

      {orderedDepts.map((dept) => {
        const list = byDept.get(dept) ?? [];
        const label = dept === "_unassigned"
          ? "Unassigned"
          : DEPT_LABEL[dept] ?? dept.charAt(0).toUpperCase() + dept.slice(1);
        return (
          <section key={dept}>
            <header className="mb-3 flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                  {label}
                </h3>
                <span className="text-[11px] text-muted-foreground/70">
                  {list.length} agent{list.length === 1 ? "" : "s"}
                </span>
              </div>
            </header>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {list.map((a) => (
                <li key={a.id}>
                  <AgentLink agent={a} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AgentLink({ agent, accent = false }: { agent: Agent; accent?: boolean }) {
  const isHead = agent.isDepartmentHead;
  const isCeo = agent.role === "ceo";
  const isTrained =
    Boolean(agent.systemPrompt && agent.systemPrompt.trim().length > 0) ||
    Boolean(agent.description && agent.description.trim().length > 0);
  return (
    <Link
      href={`/agents/${agent.id}`}
      className={
        "block rounded-md border bg-card/40 p-5 transition-colors hover:border-primary/40 " +
        (accent
          ? "border-primary/30"
          : isHead
            ? "border-amber-400/30 hover:border-amber-300/60"
            : "border-border")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {agent.name}
            </span>
            {isCeo && <Crown className="size-3 shrink-0 text-[var(--brand-primary)]" />}
            {isHead && !isCeo && <Crown className="size-3 shrink-0 text-amber-400" />}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {agent.title}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {isCeo ? (
          <Badge variant="secondary" className="bg-[var(--brand-primary)]/15 text-[10px] text-[var(--brand-primary)]">CEO</Badge>
        ) : isHead ? (
          <Badge variant="secondary" className="bg-amber-400/15 text-[10px] text-amber-300">Head</Badge>
        ) : (
          <Badge variant="secondary" className="bg-white/5 text-[10px] text-muted-foreground">Sub-agent</Badge>
        )}
        {isTrained && (
          <Badge variant="secondary" className="gap-1 bg-[var(--brand-primary)]/12 text-[10px] text-[var(--brand-primary)]">
            <span className="size-1 rounded-full bg-[var(--brand-primary)]" />
            Trained
          </Badge>
        )}
      </div>
      <div className="mt-3 flex items-center gap-1 border-t border-border pt-2 text-[12px] text-primary">
        <MessageSquare className="size-3" /> Open chat
      </div>
    </Link>
  );
}
