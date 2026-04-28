"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { useSWRConfig } from "swr";

import { AddSubAgentModal } from "@/components/agents/AddSubAgentModal";
import { TgProvisionModal } from "@/components/tg-provision-modal";
import { wouldCreateCycle } from "@/lib/tree";
import { metaFor as deptMeta } from "@/components/departments/departments-view";

type AgentNode = {
  id: string;
  name: string;
  title: string;
  role: string | null;
  department: string | null;
  reportsTo: string | null;
  isDepartmentHead: boolean;
  telegramStatus: string | null;
};

type NodeData = {
  agent: AgentNode;
  isDropTarget: boolean;
  onAddSub: (
    parentId: string,
    parentName: string,
    parentDepartment: string | null,
  ) => void;
  onAttachTelegram: (
    agentId: string,
    name: string,
    role: "manager" | "sub-agent",
  ) => void;
};

// Default footprint when reactflow hasn't measured a node yet (first paint).
// Matches the min width on the card and a generous vertical estimate.
const DEFAULT_NODE_W = 220;
const DEFAULT_NODE_H = 110;

// ── layout ──────────────────────────────────────────────────────────────
function layout(agents: AgentNode[]): {
  nodes: Node<NodeData>[];
  edges: Edge[];
} {
  // Simple tiered layout: depth in the reports_to tree picks the y band,
  // sibling order picks x. Works up to ~30 nodes; above that we'd need
  // a real layout engine (d3-dag, elk).
  const byParent = new Map<string | null, AgentNode[]>();
  for (const a of agents) {
    const arr = byParent.get(a.reportsTo) ?? [];
    arr.push(a);
    byParent.set(a.reportsTo, arr);
  }

  const pos = new Map<string, { x: number; y: number }>();
  const ROW = 160;
  const COL = 260;
  let cursor = 0;
  function place(parentId: string | null, depth: number) {
    const kids = byParent.get(parentId) ?? [];
    for (const kid of kids) {
      pos.set(kid.id, { x: cursor * COL, y: depth * ROW });
      cursor += 1;
      place(kid.id, depth + 1);
    }
  }
  place(null, 0);

  const nodes: Node<NodeData>[] = agents.map((a) => ({
    id: a.id,
    type: "agentNode",
    position: pos.get(a.id) ?? { x: 0, y: 0 },
    data: {
      agent: a,
      isDropTarget: false,
      // Will be rebound in the client component via a shared ref.
      onAddSub: () => {},
      onAttachTelegram: () => {},
    },
  }));

  const edges: Edge[] = agents
    .filter((a) => a.reportsTo)
    .map((a) => ({
      id: `${a.reportsTo}->${a.id}`,
      source: a.reportsTo!,
      target: a.id,
      type: "smoothstep",
      style: { stroke: "var(--brand-primary)", strokeOpacity: 0.6 },
    }));

  return { nodes, edges };
}

// ── custom node ─────────────────────────────────────────────────────────
function AgentNodeCard({ data }: NodeProps<NodeData>) {
  const { agent, isDropTarget, onAddSub, onAttachTelegram } = data;
  const isManager = !agent.reportsTo;

  // Hover-target outline uses brand primary token, never tailwind palette.
  // We use `outline` (not box-shadow) for the live drop target ring so the
  // brand lint rule that bans flat tailwind shadows stays clean. Only
  // `border-color` and `outline-color` transition - we avoid `transition-all`
  // to keep paint cheap on a graph that may have 20+ cards.
  const outlineClasses = isDropTarget
    ? "border-primary outline outline-2 outline-offset-1 outline-[var(--brand-primary-ring)]"
    : "border-[var(--line-strong)] outline outline-2 outline-offset-1 outline-transparent";

  return (
    <div
      className={
        "min-w-[220px] rounded-md border bg-[var(--brand-surface)] px-4 py-3 text-left shadow-[0_1px_0_rgba(12,191,106,0.08)] transition-[border-color,outline-color] duration-150 cursor-grab active:cursor-grabbing " +
        outlineClasses
      }
      onContextMenu={(e) => {
        e.preventDefault();
        onAddSub(agent.id, agent.name, agent.department);
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0.5 }} />
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-[var(--text-strong)]">
            {agent.name}
          </div>
          <div className="text-xs text-[var(--text-muted)]">{agent.title}</div>
        </div>
        <span
          className={
            "rounded border border-[var(--line-strong)] px-1.5 py-0.5 text-[10px] uppercase tracking-widest " +
            (agent.department ? "text-primary" : "text-[var(--text-muted)]")
          }
        >
          {agent.department ? deptMeta(agent.department).label : "Unassigned"}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            onAttachTelegram(
              agent.id,
              agent.name,
              isManager ? "manager" : "sub-agent",
            )
          }
          className="rounded border border-[var(--line-strong)] px-2 py-1 text-[11px] text-[var(--text-body)] hover:border-primary hover:text-primary"
        >
          {agent.telegramStatus === "connected"
            ? "Telegram ✓"
            : agent.telegramStatus === "pending_token"
              ? "Add to Telegram"
              : "Add to Telegram"}
        </button>
        <button
          type="button"
          onClick={() => onAddSub(agent.id, agent.name, agent.department)}
          className="rounded border border-[var(--line-strong)] px-2 py-1 text-[11px] text-[var(--text-body)] hover:border-primary hover:text-primary"
        >
          + sub-agent
        </button>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0.5 }}
      />
    </div>
  );
}

const nodeTypes = { agentNode: AgentNodeCard };

// ── client component ────────────────────────────────────────────────────
export function AgentTreeClient({
  initialNodes,
}: {
  initialNodes: AgentNode[];
}) {
  const [agents, setAgents] = useState<AgentNode[]>(initialNodes);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [addModalFor, setAddModalFor] = useState<{
    parentId: string;
    parentName: string;
    parentDepartment: string | null;
  } | null>(null);
  const [tgModalFor, setTgModalFor] = useState<{
    agentId: string;
    name: string;
    role: "manager" | "sub-agent";
  } | null>(null);

  // SWR shares the agents cache across the dashboard. After a successful
  // reparent we invalidate `/api/agents` so other panes (departments view,
  // org chart sidebar) refetch instead of showing stale parents.
  const { mutate: globalMutate } = useSWRConfig();

  const onAddSub = useCallback(
    (parentId: string, parentName: string, parentDepartment: string | null) => {
      setAddModalFor({ parentId, parentName, parentDepartment });
    },
    [],
  );
  const onAttachTelegram = useCallback(
    (agentId: string, name: string, role: "manager" | "sub-agent") => {
      setTgModalFor({ agentId, name, role });
    },
    [],
  );

  const graph = useMemo(() => {
    const { nodes, edges } = layout(agents);
    for (const n of nodes) {
      n.data = {
        ...n.data,
        isDropTarget: n.id === hoverTargetId,
        onAddSub,
        onAttachTelegram,
      };
    }
    return { nodes, edges };
  }, [agents, hoverTargetId, onAddSub, onAttachTelegram]);

  // Find the node whose bounding box contains (cx, cy), excluding `selfId`.
  // React Flow exposes `getIntersectingNodes` only via useReactFlow inside a
  // ReactFlowProvider; we don't wrap the component in one yet, so we walk
  // graph.nodes manually. positionAbsolute is preferred over `position` because
  // nested subflows would otherwise resolve relative to a parent node.
  const hitTest = useCallback(
    (cx: number, cy: number, selfId: string): Node<NodeData> | null => {
      for (const candidate of graph.nodes) {
        if (candidate.id === selfId) continue;
        const w = candidate.width ?? DEFAULT_NODE_W;
        const h = candidate.height ?? DEFAULT_NODE_H;
        const p = candidate.positionAbsolute ?? candidate.position;
        if (cx >= p.x && cx <= p.x + w && cy >= p.y && cy <= p.y + h) {
          return candidate;
        }
      }
      return null;
    },
    [graph.nodes],
  );

  // Live highlight while dragging - cheap because hoverTargetId only flips
  // when the pointer crosses a card boundary, which re-renders just two cards.
  const onNodeDrag = useCallback(
    (_event: unknown, dragged: Node<NodeData>) => {
      const w = dragged.width ?? DEFAULT_NODE_W;
      const h = dragged.height ?? DEFAULT_NODE_H;
      const p = dragged.positionAbsolute ?? dragged.position;
      const cx = p.x + w / 2;
      const cy = p.y + h / 2;
      const target = hitTest(cx, cy, dragged.id);
      const nextId = target ? target.id : null;
      setHoverTargetId((prev) => (prev === nextId ? prev : nextId));
    },
    [hitTest],
  );

  // ── drag-to-reorganize ───────────────────────────────────────────────
  // When a node is dropped, find which other node's bounding box contains
  // its centre. If we land on another node, reparent under it. If we land
  // on empty canvas, promote to root. Cycles are blocked locally and on
  // the server. Updates are optimistic; we revert on PATCH failure.
  const onNodeDragStop = useCallback(
    async (_event: unknown, dropped: Node<NodeData>) => {
      // Always clear the live-drag highlight before any early return.
      setHoverTargetId(null);

      const droppedW = dropped.width ?? DEFAULT_NODE_W;
      const droppedH = dropped.height ?? DEFAULT_NODE_H;
      const p = dropped.positionAbsolute ?? dropped.position;
      const cx = p.x + droppedW / 2;
      const cy = p.y + droppedH / 2;
      const target = hitTest(cx, cy, dropped.id);

      const newParentId: string | null = target ? target.id : null;
      const current = agents.find((a) => a.id === dropped.id);
      if (!current) return;
      if (current.reportsTo === newParentId) return;

      // Department Head guard: heads anchor the top of their department, so
      // never let one be dragged under a non-head (or any other agent). They
      // can still be promoted to root by dropping on empty canvas.
      if (current.isDepartmentHead && newParentId !== null) {
        toast.error("Department Heads cannot be reparented under another agent.");
        setAgents((prev) => [...prev]);
        return;
      }

      // Local cycle guard before we even touch the network.
      if (newParentId !== null) {
        const tree = agents.map((a) => ({
          id: a.id,
          parentId: a.reportsTo,
        }));
        if (wouldCreateCycle(tree, dropped.id, newParentId)) {
          toast.error("Cannot reparent: would create a reporting cycle.");
          // Bump state to force the layout to re-snap the dragged node.
          setAgents((prev) => [...prev]);
          return;
        }
      }

      // Optimistic update. Snapshot the prior parent so we can revert.
      const prevParent = current.reportsTo;
      setAgents((prev) =>
        prev.map((a) =>
          a.id === dropped.id ? { ...a, reportsTo: newParentId } : a,
        ),
      );

      try {
        const res = await fetch(`/api/agents/${dropped.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reports_to: newParentId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        // Bust the SWR cache so any panel using useAgents() (departments,
        // sidebar, agent list) picks up the new parent edge on next render.
        await globalMutate("/api/agents");
        toast.success(
          newParentId
            ? `Reassigned to report to ${target?.data.agent.name}.`
            : "Promoted to root.",
        );
      } catch (err) {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === dropped.id ? { ...a, reportsTo: prevParent } : a,
          ),
        );
        toast.error(`Reparent failed: ${(err as Error).message}`);
      }
    },
    [agents, globalMutate, hitTest],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.18, includeHiddenNodes: false }}
        minZoom={0.5}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--line-strong)" gap={24} />
        <Controls />
      </ReactFlow>

      {addModalFor && (
        <AddSubAgentModal
          parentId={addModalFor.parentId}
          parentName={addModalFor.parentName}
          parentDepartment={addModalFor.parentDepartment}
          onClose={() => setAddModalFor(null)}
          onCreated={(created) => {
            setAgents((prev) => [
              ...prev,
              {
                id: created.id,
                name: created.name,
                title: created.title,
                role: created.role ?? null,
                department: created.department ?? null,
                reportsTo: addModalFor.parentId,
                // Sub-agents created from this modal are never heads.
                isDepartmentHead: false,
                telegramStatus: null,
              },
            ]);
            setAddModalFor(null);
          }}
        />
      )}

      {tgModalFor && (
        <TgProvisionModal
          agentId={tgModalFor.agentId}
          agentName={tgModalFor.name}
          agentRole={tgModalFor.role}
          onClose={() => setTgModalFor(null)}
          onConnected={() => {
            setAgents((prev) =>
              prev.map((a) =>
                a.id === tgModalFor.agentId
                  ? { ...a, telegramStatus: "connected" }
                  : a,
              ),
            );
            setTgModalFor(null);
          }}
        />
      )}
    </div>
  );
}
