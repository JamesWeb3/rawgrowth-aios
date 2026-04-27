"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import {
  Megaphone,
  BadgeDollarSign,
  PackageCheck,
  Wallet,
  UserRound,
  HelpCircle,
  Code2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgents } from "@/lib/agents/use-agents";
import type { Agent, Department } from "@/lib/agents/dto";
import { DEPARTMENTS } from "@/lib/agents/dto";

type DeptMeta = {
  label: string;
  icon: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  brand: string;
};

// Brand-only palette per CTO brief §P08  -  primary green for active
// departments, muted neutral for the rest. No Tailwind blue/indigo/
// yellow/orange/purple/pink anywhere.
const PRIMARY = "#0cbf6a";
const MUTED = "#94a3b8";

const SEEDED_META: Record<string, DeptMeta> = {
  marketing: { label: "Marketing", icon: Megaphone, brand: PRIMARY },
  sales: { label: "Sales", icon: BadgeDollarSign, brand: PRIMARY },
  fulfilment: { label: "Fulfilment", icon: PackageCheck, brand: MUTED },
  finance: { label: "Finance", icon: Wallet, brand: MUTED },
  development: { label: "Development", icon: Code2, brand: MUTED },
};

const CUSTOM_BRANDS = [PRIMARY, MUTED];

function metaFor(dept: string): DeptMeta {
  if (dept in SEEDED_META) return SEEDED_META[dept];
  // Stable per-slug hue + capitalised label fallback.
  const brand =
    CUSTOM_BRANDS[
      [...dept].reduce((h, c) => (h + c.charCodeAt(0)) % CUSTOM_BRANDS.length, 0)
    ];
  return {
    label: dept.charAt(0).toUpperCase() + dept.slice(1).replace(/_/g, " "),
    icon: UserRound,
    brand,
  };
}

const META = new Proxy(SEEDED_META, {
  get(_target, key: string) {
    return metaFor(key);
  },
}) as Record<string, DeptMeta>;

export function DepartmentsView() {
  const { agents, updateAgent } = useAgents();

  const { grouped, customDepts } = useMemo(() => {
    const buckets: Record<string, Agent[]> = { unassigned: [] };
    for (const d of DEPARTMENTS) buckets[d] = [];
    const custom = new Set<string>();
    for (const a of agents) {
      const key = a.department ?? "unassigned";
      if (!buckets[key]) {
        buckets[key] = [];
        if (key !== "unassigned") custom.add(key);
      }
      buckets[key].push(a);
    }
    return { grouped: buckets, customDepts: Array.from(custom).sort() };
  }, [agents]);

  async function reassign(agent: Agent, dept: Department | null) {
    try {
      await updateAgent(agent.id, { department: dept });
      toast.success(
        dept
          ? `Moved ${agent.name} to ${META[dept].label}`
          : `Unassigned ${agent.name}`,
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-8">
      {grouped.unassigned.length > 0 && (
        <UnassignedSection
          agents={grouped.unassigned}
          onReassign={reassign}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {[...DEPARTMENTS, ...customDepts].map((d) => (
          <DepartmentCard
            key={d}
            department={d}
            agents={grouped[d] ?? []}
            onReassign={reassign}
          />
        ))}
      </div>
    </div>
  );
}

function DepartmentCard({
  department,
  agents,
  onReassign,
}: {
  department: Department;
  agents: Agent[];
  onReassign: (agent: Agent, dept: Department | null) => void;
}) {
  const meta = META[department];
  const Icon = meta.icon;

  return (
    <Card className="border-border bg-card/40">
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex size-10 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: `${meta.brand}1a` }}
            >
              <Icon className="size-5" style={{ color: meta.brand }} />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">
                {meta.label}
              </h3>
              <div className="text-[11.5px] text-muted-foreground">
                {agents.length} agent{agents.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          {agents.length > 0 && (
            <Badge
              variant="secondary"
              className="bg-white/5 text-[10px] text-muted-foreground"
            >
              {agents.length}
            </Badge>
          )}
        </div>

        {agents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background/40 py-6 text-center text-[12px] text-muted-foreground">
            No agents in this department yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {agents.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                onReassign={onReassign}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UnassignedSection({
  agents,
  onReassign,
}: {
  agents: Agent[];
  onReassign: (agent: Agent, dept: Department | null) => void;
}) {
  return (
    <Card className="border-border border-dashed bg-card/30">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
            <HelpCircle className="size-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">
              Unassigned
            </h3>
            <div className="text-[11.5px] text-muted-foreground">
              {agents.length} agent{agents.length === 1 ? "" : "s"} waiting to be
              placed in a department
            </div>
          </div>
        </div>
        <ul className="space-y-2">
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} onReassign={onReassign} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AgentRow({
  agent,
  onReassign,
}: {
  agent: Agent;
  onReassign: (agent: Agent, dept: Department | null) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-primary/10 text-primary">
          <UserRound className="size-3.5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">
            {agent.name}
          </div>
          {agent.title && (
            <div className="truncate text-[11px] text-muted-foreground">
              {agent.title}
            </div>
          )}
        </div>
      </div>
      <Select
        value={agent.department ?? undefined}
        onValueChange={(v) => onReassign(agent, v === "__unassign__" ? null : (v as Department))}
      >
        <SelectTrigger className="h-8 w-36 bg-input/40 text-[12px]">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          {Array.from(new Set([...DEPARTMENTS, ...Object.keys(SEEDED_META)]))
            .sort()
            .map((d) => (
              <SelectItem key={d} value={d}>
                {metaFor(d).label}
              </SelectItem>
            ))}
          {agent.department && (
            <SelectItem value="__unassign__" className="text-muted-foreground">
              Remove from department
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </li>
  );
}
