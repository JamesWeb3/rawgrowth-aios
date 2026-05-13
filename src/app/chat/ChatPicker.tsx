"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AgentChatTab from "@/components/agents/AgentChatTab";
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
      <div className="rounded-md border border-dashed border-border bg-card/40 p-5 text-center">
        <Bot className="mx-auto size-6 text-muted-foreground" strokeWidth={1.4} />
        <p className="mx-auto mt-3 text-[13px] text-muted-foreground">
          No agents yet. Hire your first agent on /agents to start chatting.
        </p>
      </div>
    );
  }

  return (
    // Fixed-viewport layout so the chat surface gets a bounded height
    // and AgentChatTab's inner `flex-1 overflow-y-auto` resolves
    // correctly. Without an explicit height the chat content stretches
    // to fit the messages (no scroll container) and the input box ends
    // up scrolled below the fold - Chris's 2026-05-12 bug 3.
    // `100svh - 160px` reserves room for the PageShell header + sidebar
    // chrome; tweak the offset if the shell padding changes.
    <div className="grid h-[calc(100svh-160px)] grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* Picker rail */}
      <aside className="space-y-4 overflow-y-auto rounded-md border border-border bg-card/40 p-3">
        {ceo && (
          <div>
            <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
              Coordinator
            </div>
            <AgentRow agent={ceo} active={activeId === ceo.id} onPick={pick} />
          </div>
        )}
        {sortedDepts.map(([dept, list]) => (
          <DeptGroup
            key={dept}
            label={DEPT_LABEL[dept] ?? dept}
            agents={list}
            activeId={activeId}
            onPick={pick}
          />
        ))}
      </aside>

      {/* Chat surface: flex column so the chat tab can flex-1 inside it. */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card/40">
        {active ? (
          <AgentChatTab
            key={active.id}
            agentId={active.id}
            agentName={active.name}
            agentRole={active.role ?? "general"}
            agentTitle={active.title ?? undefined}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
            Pick an agent on the left to start.
          </div>
        )}
      </div>
    </div>
  );
}

// Collapsible department group. Per Chris's bug 3: the picker rail
// fills up fast on orgs with 6+ agents, so each department collapses
// to a header row that the operator clicks to expand.
function DeptGroup({
  label,
  agents,
  activeId,
  onPick,
}: {
  label: string;
  agents: Agent[];
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const containsActive = agents.some((a) => a.id === activeId);
  const [open, setOpen] = useState<boolean>(containsActive);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full items-center justify-between px-2 text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground hover:text-foreground"
      >
        <span>{label}</span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-0.5">
          {agents.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              active={activeId === a.id}
              onPick={onPick}
            />
          ))}
        </div>
      )}
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
