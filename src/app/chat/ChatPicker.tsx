"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AgentChatTab } from "@/components/agents/AgentChatTab";
import { Crown, Bot } from "lucide-react";

type Agent = {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  department: string | null;
  isDepartmentHead: boolean;
};

const DEPT_LABEL: Record<string, string> = {
  marketing: "Marketing",
  sales: "Sales",
  fulfilment: "Fulfilment",
  finance: "Finance",
  development: "Engineering",
};

export function ChatPicker({
  agents,
  initialAgentId,
}: {
  agents: Agent[];
  initialAgentId: string | null;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(initialAgentId);
  const active = agents.find((a) => a.id === activeId) ?? null;

  function pick(id: string) {
    setActiveId(id);
    const params = new URLSearchParams(search.toString());
    params.set("agent", id);
    router.replace(`/chat?${params.toString()}`, { scroll: false });
  }

  // Group agents: CEO first, then dept heads grouped by dept, then sub-agents.
  const ceo = agents.find((a) => a.role === "ceo");
  const byDept = new Map<string, Agent[]>();
  for (const a of agents) {
    if (a.role === "ceo") continue;
    const key = a.department ?? "_other";
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key)!.push(a);
  }
  // Sort each dept: head first, then subs alpha
  for (const list of byDept.values()) {
    list.sort((a, b) => {
      if (a.isDepartmentHead !== b.isDepartmentHead) {
        return a.isDepartmentHead ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }
  const sortedDepts = [...byDept.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  if (agents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/30 p-10 text-center">
        <Bot className="mx-auto size-8 text-primary/60" strokeWidth={1.4} />
        <p className="mt-3 text-sm font-medium text-foreground">No agents yet</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Hire your first agent on /agents to start chatting.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* Picker rail */}
      <aside className="space-y-4 rounded-md border border-border bg-card/30 p-3">
        {ceo && (
          <div>
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
              Coordinator
            </div>
            <AgentRow agent={ceo} active={activeId === ceo.id} onPick={pick} />
          </div>
        )}
        {sortedDepts.map(([dept, list]) => (
          <div key={dept}>
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
              {DEPT_LABEL[dept] ?? dept}
            </div>
            <div className="space-y-0.5">
              {list.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  active={activeId === a.id}
                  onPick={pick}
                />
              ))}
            </div>
          </div>
        ))}
      </aside>

      {/* Chat surface */}
      <div className="overflow-hidden rounded-md border border-border bg-card/30">
        {active ? (
          <AgentChatTab
            key={active.id}
            agentId={active.id}
            agentName={active.name}
            agentRole={active.role ?? "general"}
            agentTitle={active.title ?? undefined}
          />
        ) : (
          <div className="flex h-[640px] items-center justify-center text-[13px] text-muted-foreground">
            Pick an agent on the left to start.
          </div>
        )}
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  active,
  onPick,
}: {
  agent: Agent;
  active: boolean;
  onPick: (id: string) => void;
}) {
  const Icon = agent.role === "ceo" ? Crown : Bot;
  return (
    <button
      type="button"
      onClick={() => onPick(agent.id)}
      className={
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors " +
        (active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground")
      }
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.6} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium">{agent.name}</div>
        {agent.title && (
          <div className="truncate text-[10px] opacity-70">{agent.title}</div>
        )}
      </div>
      {agent.isDepartmentHead && (
        <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-primary">
          Head
        </span>
      )}
    </button>
  );
}
