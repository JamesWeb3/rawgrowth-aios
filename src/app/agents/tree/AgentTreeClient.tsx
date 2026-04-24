"use client";

import { useCallback, useMemo, useState } from "react";
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

import { AddSubAgentModal } from "@/components/agents/AddSubAgentModal";
import { TgProvisionModal } from "@/components/tg-provision-modal";

type AgentNode = {
  id: string;
  name: string;
  title: string;
  role: string | null;
  department: string | null;
  reportsTo: string | null;
  telegramStatus: string | null;
};

type NodeData = {
  agent: AgentNode;
  onAddSub: (parentId: string, parentName: string) => void;
  onAttachTelegram: (
    agentId: string,
    name: string,
    role: "manager" | "sub-agent",
  ) => void;
};

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
  const { agent, onAddSub, onAttachTelegram } = data;
  const isManager = !agent.reportsTo;

  return (
    <div
      className="min-w-[220px] rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface)] px-4 py-3 text-left shadow-[0_1px_0_rgba(12,191,106,0.08)]"
      onContextMenu={(e) => {
        e.preventDefault();
        onAddSub(agent.id, agent.name);
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
        {agent.department && (
          <span className="rounded border border-[var(--line-strong)] px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-primary">
            {agent.department}
          </span>
        )}
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
          onClick={() => onAddSub(agent.id, agent.name)}
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
  const [addModalFor, setAddModalFor] = useState<{
    parentId: string;
    parentName: string;
  } | null>(null);
  const [tgModalFor, setTgModalFor] = useState<{
    agentId: string;
    name: string;
    role: "manager" | "sub-agent";
  } | null>(null);

  const onAddSub = useCallback((parentId: string, parentName: string) => {
    setAddModalFor({ parentId, parentName });
  }, []);
  const onAttachTelegram = useCallback(
    (agentId: string, name: string, role: "manager" | "sub-agent") => {
      setTgModalFor({ agentId, name, role });
    },
    [],
  );

  const graph = useMemo(() => {
    const { nodes, edges } = layout(agents);
    for (const n of nodes) {
      n.data = { ...n.data, onAddSub, onAttachTelegram };
    }
    return { nodes, edges };
  }, [agents, onAddSub, onAttachTelegram]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--line-strong)" gap={24} />
        <Controls />
      </ReactFlow>

      {addModalFor && (
        <AddSubAgentModal
          parentId={addModalFor.parentId}
          parentName={addModalFor.parentName}
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
