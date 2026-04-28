"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  Bot,
  Crown,
  Cpu,
  Code,
  Megaphone,
  PhoneCall,
  ClipboardList,
  Palette,
  Pencil,
  Network,
} from "lucide-react";
import { SiTelegram } from "react-icons/si";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { AgentSheet } from "@/components/agent-sheet";
import { AGENT_ROLES, type AgentStatus } from "@/lib/agents/constants";
import { useAgents } from "@/lib/agents/use-agents";
import type { Agent } from "@/lib/agents/dto";
import { getConnector } from "@/lib/connectors";
import { jsonFetcher } from "@/lib/swr";

type AgentBotSummary = {
  id: string;
  agent_id: string;
  bot_username: string | null;
};

// ────────────────────────── Role icons ──────────────────────────

const roleIconMap = {
  Crown,
  Cpu,
  Code,
  Megaphone,
  PhoneCall,
  ClipboardList,
  Palette,
  Bot,
} as const;

type RoleIconName = keyof typeof roleIconMap;

function roleMeta(role: Agent["role"]) {
  return (
    AGENT_ROLES.find((r) => r.value === role) ??
    AGENT_ROLES[AGENT_ROLES.length - 1]
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const statusStyle: Record<
  AgentStatus,
  { label: string; className: string; dotClass: string }
> = {
  idle: {
    label: "Idle",
    className: "bg-white/5 text-muted-foreground",
    dotClass: "bg-muted-foreground/60",
  },
  running: {
    label: "Running",
    className: "bg-primary/15 text-primary",
    dotClass: "bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]",
  },
  paused: {
    label: "Paused",
    className: "bg-amber-500/15 text-amber-400",
    dotClass: "bg-amber-400",
  },
  error: {
    label: "Error",
    className: "bg-destructive/15 text-destructive",
    dotClass: "bg-destructive",
  },
};

// ────────────────────────── Tree building ──────────────────────────

type AgentNode = Agent & { children: AgentNode[] };

function buildTree(agents: Agent[]): AgentNode[] {
  const map = new Map<string, AgentNode>();
  for (const a of agents) map.set(a.id, { ...a, children: [] });

  const roots: AgentNode[] = [];
  const seen = new Set<string>();

  for (const a of agents) {
    const node = map.get(a.id);
    if (!node) continue;

    // Cycle guard: follow reportsTo chain; if it loops, treat as root.
    let isCyclic = false;
    if (a.reportsTo) {
      const chain = new Set<string>([a.id]);
      let cursor: string | null = a.reportsTo;
      while (cursor) {
        if (chain.has(cursor)) {
          isCyclic = true;
          break;
        }
        chain.add(cursor);
        const next = agents.find((x) => x.id === cursor);
        cursor = next?.reportsTo ?? null;
      }
    }

    if (a.reportsTo && !isCyclic && map.has(a.reportsTo)) {
      map.get(a.reportsTo)?.children.push(node);
    } else {
      roots.push(node);
    }
    seen.add(a.id);
  }

  // Sort siblings so ordering is stable (alphabetical by name)
  const sortTree = (n: AgentNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortTree);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortTree);

  return roots;
}

// ────────────────────────── Card ──────────────────────────

function AgentCard({
  agent,
  onEdit,
  bot,
}: {
  agent: Agent;
  onEdit: (agent: Agent) => void;
  bot: AgentBotSummary | null;
}) {
  const role = roleMeta(agent.role);
  const Icon = roleIconMap[role.icon as RoleIconName] ?? Bot;
  const status = statusStyle[agent.status];
  const isHead = agent.isDepartmentHead;

  return (
    <button
      type="button"
      onClick={() => onEdit(agent)}
      className={cn(
        "group relative w-60 rounded-xl border bg-card/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-[0_12px_40px_rgba(12,191,106,.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isHead
          ? "border-amber-400/40 hover:border-amber-300/60 shadow-[0_0_0_1px_rgba(251,191,36,.05)_inset]"
          : "border-border hover:border-primary/40",
      )}
    >
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Pencil className="size-3" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg border",
            isHead
              ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
              : "border-border bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-[13px] font-semibold text-foreground">
              {agent.name}
            </div>
            {isHead && (
              <Crown className="size-3 shrink-0 text-amber-400" />
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {agent.title || role.label}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <Badge variant="secondary" className={cn("gap-1", status.className)}>
          <span className={cn("size-1.5 rounded-full", status.dotClass)} />
          {status.label}
        </Badge>
        {isHead && (
          <Badge
            variant="secondary"
            className="bg-amber-400/15 text-[10px] text-amber-300"
          >
            Head
          </Badge>
        )}
        <Badge
          variant="secondary"
          className="bg-white/5 text-[10px] text-muted-foreground"
        >
          {role.label}
        </Badge>
        {bot && (
          <Badge
            variant="secondary"
            title={
              bot.bot_username
                ? `Telegram bot @${bot.bot_username}`
                : "Telegram bot connected"
            }
            className="gap-1 bg-[#26A5E4]/15 text-[10px] text-[#7FCBEB]"
          >
            <SiTelegram className="size-2.5" />
            {bot.bot_username ? `@${bot.bot_username}` : "Bot"}
          </Badge>
        )}
      </div>

      <ConnectorsRow ids={Object.keys(agent.writePolicy ?? {})} />

      <div className="mt-3 flex items-center justify-end">
        <span className="font-mono text-[10px] text-muted-foreground">
          {initials(agent.name)}
        </span>
      </div>
    </button>
  );
}

function ConnectorsRow({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1">
      {ids.slice(0, 6).map((id) => {
        const c = getConnector(id);
        if (c) {
          return (
            <div
              key={id}
              title={c.label}
              className="flex size-5 items-center justify-center rounded border border-border"
              style={{ backgroundColor: `${c.brand}1a` }}
            >
              <c.Icon
                className="size-3"
                style={{ color: c.brand === "#FFFFFF" ? "#fff" : c.brand }}
              />
            </div>
          );
        }
        return (
          <div
            key={id}
            title={id}
            className="flex h-5 items-center rounded border border-border bg-card/40 px-1.5 text-[9px] font-mono text-muted-foreground"
          >
            {id}
          </div>
        );
      })}
      {ids.length > 6 && (
        <div className="text-[9px] font-mono text-muted-foreground">
          +{ids.length - 6}
        </div>
      )}
    </div>
  );
}

// ────────────────────────── Tree renderer ──────────────────────────
//
// Each node renders as a column. When a node has children, a vertical stub
// drops down from the card, then a row of "connector columns" — one per child.
// Each child's connector column contains a horizontal segment (sized to stitch
// into a continuous horizontal bar across siblings) plus a vertical drop into
// the child card.

const CARD_WIDTH = 240; // must match AgentCard width (w-60 = 240px)
const SUBTREE_GAP = 32; // horizontal gap between sibling subtrees

function TreeNode({
  node,
  onEdit,
  botByAgentId,
}: {
  node: AgentNode;
  onEdit: (agent: Agent) => void;
  botByAgentId: Map<string, AgentBotSummary>;
}) {
  const hasChildren = node.children.length > 0;
  const multipleChildren = node.children.length > 1;

  return (
    <div className="flex flex-col items-center">
      <AgentCard
        agent={node}
        onEdit={onEdit}
        bot={botByAgentId.get(node.id) ?? null}
      />

      {hasChildren && (
        <>
          {/* Parent's down-stub */}
          <div className="h-6 w-px bg-border" />

          {/* Children row */}
          <div className="flex items-start">
            {node.children.map((child, i) => {
              const isFirst = i === 0;
              const isLast = i === node.children.length - 1;
              return (
                <div
                  key={child.id}
                  className="flex flex-col items-center"
                  style={{
                    paddingLeft: i === 0 ? 0 : SUBTREE_GAP / 2,
                    paddingRight: isLast ? 0 : SUBTREE_GAP / 2,
                  }}
                >
                  {/* Connector zone above child */}
                  <div className="relative flex h-6 w-full justify-center">
                    {/* Horizontal segment — only when multiple children */}
                    {multipleChildren && (
                      <div
                        className={cn(
                          "absolute top-0 h-px bg-border",
                          isFirst && "left-1/2 right-0",
                          isLast && "left-0 right-1/2",
                          !isFirst && !isLast && "left-0 right-0",
                        )}
                      />
                    )}
                    {/* Vertical drop into child */}
                    <div className="w-px bg-border" />
                  </div>

                  <TreeNode
                    node={child}
                    onEdit={onEdit}
                    botByAgentId={botByAgentId}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────── Top-level component ──────────────────────────

export function OrgChart() {
  const { agents, hasHydrated } = useAgents();

  // Per-Department-Head Telegram bots — surfaced inline on the agent card
  // so the operator can see at a glance which heads are reachable via DM.
  const { data: botsData } = useSWR<{ bots: AgentBotSummary[] }>(
    "/api/connections/agent-telegram",
    jsonFetcher,
    { refreshInterval: 60_000 },
  );
  const botByAgentId = useMemo(() => {
    const m = new Map<string, AgentBotSummary>();
    for (const b of botsData?.bots ?? []) m.set(b.agent_id, b);
    return m;
  }, [botsData]);

  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const editingAgent = useMemo(
    () => agents.find((a) => a.id === editingAgentId) ?? null,
    [agents, editingAgentId],
  );

  const tree = useMemo(() => buildTree(agents), [agents]);
  const runningCount = agents.filter((a) => a.status === "running").length;
  const headsCount = agents.filter((a) => a.isDepartmentHead).length;

  // Auto-fit: when the natural chart width exceeds the visible canvas,
  // scale the whole tree down so it fits without horizontal scrolling.
  // Floor at 0.4 so cards don't get unreadable on dense orgs.
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const recalc = () => {
      const canvas = canvasRef.current;
      const content = contentRef.current;
      if (!canvas || !content) return;
      // Reset transform before measuring so we get the natural size.
      content.style.transform = "none";
      const naturalW = content.scrollWidth;
      const naturalH = content.scrollHeight;
      // 80px = total horizontal padding inside the canvas (p-10 each side).
      const available = canvas.clientWidth - 80;
      const next =
        naturalW <= available ? 1 : Math.max(0.4, available / naturalW);
      setScale(next);
      setContentHeight(naturalH * next);
    };
    recalc();
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(recalc);
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [tree, agents.length]);

  if (!hasHydrated) {
    return (
      <div className="h-105 animate-pulse rounded-2xl border border-border bg-card/20" />
    );
  }

  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No agents yet — your org chart is empty"
        description="Hire your first agent — a CEO at the top, or go straight to individual contributors. You can add reports underneath them later."
        action={<AgentSheet triggerSize="lg" triggerLabel="Hire first agent" />}
      />
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{agents.length}</span>{" "}
            agent{agents.length === 1 ? "" : "s"}
          </span>
          <span className="text-border">•</span>
          <span>
            <span className="font-semibold text-foreground">
              {runningCount}
            </span>{" "}
            running
          </span>
          {headsCount > 0 && (
            <>
              <span className="text-border">•</span>
              <span className="inline-flex items-center gap-1">
                <Crown className="size-3 text-amber-400" />
                <span className="font-semibold text-foreground">
                  {headsCount}
                </span>{" "}
                head{headsCount === 1 ? "" : "s"}
              </span>
            </>
          )}
        </div>
        <AgentSheet />
      </div>

      {/* Chart canvas — auto-scales the tree down to fit the available
          width instead of horizontally scrolling. Wider orgs get smaller
          cards rather than off-screen ones. */}
      <div
        ref={canvasRef}
        className="relative overflow-hidden rounded-2xl border border-border bg-card/30 p-10"
        style={contentHeight !== null ? { minHeight: contentHeight + 80 } : undefined}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/20 to-transparent" />
        {scale < 1 && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-border bg-background/70 px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {Math.round(scale * 100)}%
          </div>
        )}
        <div
          ref={contentRef}
          className="mx-auto flex items-start justify-center gap-8 origin-top"
          style={{
            minWidth: Math.max(CARD_WIDTH, tree.length * (CARD_WIDTH + 64)),
            transform: `scale(${scale})`,
            width: "fit-content",
          }}
        >
          {tree.map((root) => (
            <TreeNode
              key={root.id}
              node={root}
              onEdit={(a) => setEditingAgentId(a.id)}
              botByAgentId={botByAgentId}
            />
          ))}
        </div>
      </div>

      {/* Edit sheet (controlled) */}
      {editingAgent && (
        <AgentSheet
          mode="edit"
          agent={editingAgent}
          open={!!editingAgent}
          onOpenChange={(o) => {
            if (!o) setEditingAgentId(null);
          }}
        />
      )}
    </>
  );
}
