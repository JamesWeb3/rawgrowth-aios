"use client";

import Link from "next/link";
import useSWR from "swr";
import { Plus } from "lucide-react";

import { jsonFetcher } from "@/lib/swr";
import { getIntegration } from "@/lib/integrations-catalog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type WorkspaceTool = {
  name: string;
  description: string;
  isWrite: boolean;
};
type IntegrationEntry = {
  id: string;
  name: string;
  connected: boolean;
  hasWriteTools: boolean;
  toolCount: number;
};
type CatalogResponse = {
  integrations: IntegrationEntry[];
  workspace: WorkspaceTool[];
};

export type WritePolicy = Record<
  string,
  "direct" | "requires_approval" | "draft_only"
>;

const POLICY_OPTIONS: Array<{
  value: "direct" | "requires_approval" | "draft_only";
  label: string;
}> = [
  { value: "direct", label: "Direct" },
  { value: "requires_approval", label: "Requires approval" },
  { value: "draft_only", label: "Draft only" },
];

export function ToolsPicker({
  value,
  onChange,
}: {
  value: WritePolicy;
  onChange: (v: WritePolicy) => void;
}) {
  const { data, isLoading } = useSWR<CatalogResponse>(
    "/api/agents/tool-catalog",
    jsonFetcher,
  );

  function toggle(key: string, defaultPolicy: "direct" | "requires_approval") {
    const next: WritePolicy = { ...value };
    if (key in next) delete next[key];
    else next[key] = defaultPolicy;
    onChange(next);
  }

  function setPolicy(
    key: string,
    policy: "direct" | "requires_approval" | "draft_only",
  ) {
    onChange({ ...value, [key]: policy });
  }

  if (isLoading && !data) {
    return (
      <div className="text-[12px] text-muted-foreground">Loading tools…</div>
    );
  }

  const integrations = data?.integrations ?? [];
  const workspace = data?.workspace ?? [];

  return (
    <div className="space-y-3">
      {integrations.map((it) => {
        const catalog = getIntegration(it.id);
        const Icon = catalog?.Icon;
        const brand = catalog?.brand ?? "#888";
        const enabled = it.id in value;
        const policy = value[it.id] ?? "direct";
        return (
          <div
            key={it.id}
            className="flex items-center gap-3 rounded-md border border-border bg-card/30 px-3 py-2.5"
          >
            <input
              type="checkbox"
              checked={enabled}
              disabled={!it.connected}
              onChange={() =>
                toggle(it.id, it.hasWriteTools ? "requires_approval" : "direct")
              }
              className="size-3.5 accent-primary disabled:opacity-40"
            />
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border"
              style={{ backgroundColor: `${brand}1a` }}
            >
              {Icon ? (
                <Icon
                  className="size-4"
                  style={{ color: brand === "#FFFFFF" ? "#fff" : brand }}
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-foreground">
                {it.name}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {it.connected
                  ? `${it.toolCount} tool${it.toolCount === 1 ? "" : "s"} available`
                  : "Not connected"}
              </div>
            </div>
            {enabled && it.hasWriteTools && (
              <Select
                value={policy}
                onValueChange={(v) =>
                  setPolicy(
                    it.id,
                    (v ?? "direct") as
                      | "direct"
                      | "requires_approval"
                      | "draft_only",
                  )
                }
              >
                <SelectTrigger className="h-7 w-40 bg-input/40 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      })}

      {workspace.length > 0 && (
        <div className="rounded-md border border-border bg-card/30">
          <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[1px] text-muted-foreground">
            Workspace
          </div>
          <div className="divide-y divide-border">
            {workspace.map((t) => {
              const enabled = t.name in value;
              const policy = value[t.name] ?? "direct";
              return (
                <div key={t.name} className="flex items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() =>
                      toggle(t.name, t.isWrite ? "requires_approval" : "direct")
                    }
                    className="mt-0.5 size-3.5 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-foreground">
                      {t.name}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                      {t.description}
                    </p>
                  </div>
                  {enabled && t.isWrite && (
                    <Select
                      value={policy}
                      onValueChange={(v) =>
                        setPolicy(
                          t.name,
                          (v ?? "direct") as
                            | "direct"
                            | "requires_approval"
                            | "draft_only",
                        )
                      }
                    >
                      <SelectTrigger className="h-7 w-40 bg-input/40 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POLICY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Link
        href="/integrations"
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-card/30 px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Plus className="size-3.5" />
        Add more integrations
      </Link>
    </div>
  );
}
