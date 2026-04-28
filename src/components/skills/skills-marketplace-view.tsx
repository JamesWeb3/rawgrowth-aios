"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import {
  Rocket,
  Palette,
  Component,
  Wrench,
  Megaphone,
  BadgeDollarSign,
  Wallet,
  Search,
  Check,
  Copy,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { jsonFetcher } from "@/lib/swr";
import type { Skill, SkillCategory } from "@/lib/skills/catalog";
import { installCommand } from "@/lib/skills/catalog";
import { useAgents } from "@/lib/agents/use-agents";

const ICONS = {
  rocket: Rocket,
  palette: Palette,
  component: Component,
  wrench: Wrench,
  megaphone: Megaphone,
  "badge-dollar": BadgeDollarSign,
  wallet: Wallet,
};

type Assignment = { agent_id: string; skill_id: string; created_at: string };
type SkillsResponse = {
  catalog: Skill[];
  assignments: Assignment[];
};

export function SkillsMarketplaceView() {
  const { data, isLoading, mutate } = useSWR<SkillsResponse>(
    "/api/skills",
    jsonFetcher,
    { refreshInterval: 15_000 },
  );
  const { agents } = useAgents();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SkillCategory | "all">("all");
  const [openSkillId, setOpenSkillId] = useState<string | null>(null);

  const catalog = data?.catalog ?? [];
  const assignments = data?.assignments ?? [];

  const assignedAgentsBySkill = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of assignments) {
      const arr = map.get(a.skill_id) ?? [];
      arr.push(a.agent_id);
      map.set(a.skill_id, arr);
    }
    return map;
  }, [assignments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((s) => {
      if (category !== "all" && s.category !== category) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.tagline.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    });
  }, [catalog, query, category]);

  const openSkill = openSkillId ? catalog.find((s) => s.id === openSkillId) ?? null : null;
  const openSkillAssigned = openSkillId
    ? assignedAgentsBySkill.get(openSkillId) ?? []
    : [];

  const categories: Array<SkillCategory | "all"> = [
    "all",
    "engineering",
    "marketing",
    "sales",
    "ops",
    "design",
    "ui",
    "finance",
  ];

  return (
    <div className="space-y-6">
      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills by name, tagline, or category…"
            className="pl-9 bg-input/40"
          />
        </div>
        <div className="flex items-center gap-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={
                category === c
                  ? "rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11.5px] font-medium capitalize text-foreground"
                  : "rounded-full border border-border bg-card/40 px-3 py-1 text-[11.5px] font-medium capitalize text-muted-foreground hover:text-foreground"
              }
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading && !data ? (
        <div className="text-[12px] text-muted-foreground">Loading skills…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center text-[13px] text-muted-foreground">
          No skills match that search. Try clearing the filters.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const assignedAgentIds = assignedAgentsBySkill.get(s.id) ?? [];
            const assignedAgents = agents.filter((a) =>
              assignedAgentIds.includes(a.id),
            );
            const Icon = ICONS[s.iconKey];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setOpenSkillId(s.id)}
                className="group text-left"
              >
                <Card className="h-full border-border bg-card/50 transition-colors hover:border-primary/40">
                  <CardContent className="flex h-full flex-col gap-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-primary/10 text-primary">
                        <Icon className="size-5" />
                      </div>
                      <Badge
                        variant="secondary"
                        className="bg-white/5 text-[10px] text-muted-foreground capitalize"
                      >
                        {s.category}
                      </Badge>
                    </div>

                    <div className="flex-1 space-y-1">
                      <h3 className="text-[14px] font-semibold text-foreground">
                        {s.name}
                      </h3>
                      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                        {s.tagline}
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-border pt-3 text-[11.5px]">
                      {assignedAgents.length === 0 ? (
                        <span className="text-muted-foreground">
                          Not assigned to any agent
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-foreground">
                          <Users className="size-3 text-muted-foreground" />
                          {assignedAgents.length} agent
                          {assignedAgents.length === 1 ? "" : "s"} ·{" "}
                          <span className="text-muted-foreground">
                            {assignedAgents
                              .slice(0, 3)
                              .map((a) => a.name)
                              .join(", ")}
                            {assignedAgents.length > 3 ? "…" : ""}
                          </span>
                        </span>
                      )}
                      <span className="text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        Manage →
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      <SkillSheet
        skill={openSkill}
        open={openSkillId !== null}
        onOpenChange={(v) => !v && setOpenSkillId(null)}
        initialAssigned={openSkillAssigned}
        agents={agents}
        onSaved={() => {
          mutate();
          globalMutate("/api/agents");
        }}
      />
    </div>
  );
}

function SkillSheet({
  skill,
  open,
  onOpenChange,
  initialAssigned,
  agents,
  onSaved,
}: {
  skill: Skill | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialAssigned: string[];
  agents: { id: string; name: string; title: string }[];
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset when skill changes
  useMemo(() => {
    setSelected(new Set(initialAssigned));
  }, [initialAssigned, skill?.id]);

  function toggleAgent(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyInstall() {
    if (!skill) return;
    await navigator.clipboard.writeText(installCommand(skill));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function save() {
    if (!skill) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${skill.id}/assignments`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentIds: [...selected] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Save failed");
      }
      toast.success(
        `Updated "${skill.name}"  -  ${selected.size} agent${selected.size === 1 ? "" : "s"}`,
      );
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!skill) return null;
  const Icon = ICONS[skill.iconKey];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-130"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg border border-border bg-primary/10 text-primary">
              <Icon className="size-5.5" />
            </div>
            <div>
              <SheetTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
                {skill.name}
              </SheetTitle>
              <SheetDescription className="text-[12.5px] text-muted-foreground">
                {skill.tagline}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {skill.description}
          </p>

          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
              Install in your Claude Code
            </h4>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-input/40 px-3 py-2 font-mono text-[11.5px] text-foreground">
                {installCommand(skill)}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={copyInstall}
                className="bg-white/5 text-foreground hover:bg-white/10"
              >
                {copied ? (
                  <>
                    <Check className="size-3.5 text-primary" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" /> Copy
                  </>
                )}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Run this in the operator laptop&apos;s Claude Code so the skill
              actually loads at runtime. Assignment below tracks which agents
              this skill is meant for.
            </p>
          </section>

          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
              Assign to agents
            </h4>
            {agents.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background/40 p-4 text-center text-[12px] text-muted-foreground">
                No agents to assign to yet. Hire an agent first.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {agents.map((a) => {
                  const checked = selected.has(a.id);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => toggleAgent(a.id)}
                        className={
                          checked
                            ? "flex w-full items-center gap-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-left"
                            : "flex w-full items-center gap-3 rounded-md border border-border bg-card/40 px-3 py-2 text-left hover:border-primary/30"
                        }
                      >
                        <div
                          className={
                            checked
                              ? "flex size-4.5 items-center justify-center rounded border border-primary bg-primary text-white"
                              : "flex size-4.5 items-center justify-center rounded border border-border bg-background"
                          }
                        >
                          {checked && <Check className="size-3" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-[13px] font-medium text-foreground">
                            {a.name}
                          </div>
                          {a.title && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {a.title}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <SheetFooter className="border-t border-border bg-background px-6 py-4">
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-[11.5px] text-muted-foreground">
              {selected.size} of {agents.length} agent
              {agents.length === 1 ? "" : "s"} selected
            </span>
            <div className="flex gap-2">
              <SheetClose
                render={
                  <Button variant="ghost" size="sm">
                    Cancel
                  </Button>
                }
              />
              <Button
                onClick={save}
                disabled={saving}
                size="sm"
                className="btn-shine bg-primary text-white hover:bg-primary/90"
              >
                {saving ? "Saving…" : "Save assignments"}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
