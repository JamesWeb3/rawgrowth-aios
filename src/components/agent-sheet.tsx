"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Pause, Play, Plus, Save, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AGENT_ROLES,
  AGENT_RUNTIMES,
  type AgentRole,
  type AgentRuntime,
} from "@/lib/agents/constants";
import { useAgents } from "@/lib/agents/use-agents";
import type { Agent } from "@/lib/agents/dto";
import { ToolsPicker, type WritePolicy } from "@/components/agents/tools-picker";
import { ConnectorsPicker } from "@/components/agents/connectors-picker";
import { AgentTelegramBotPanel } from "@/components/agents/agent-telegram-bot-panel";
import { useConfig } from "@/lib/use-config";

const NONE = "__none__";

type Department = "marketing" | "sales" | "fulfilment" | "finance";

type FormState = {
  name: string;
  title: string;
  role: AgentRole;
  description: string;
  reportsTo: string;
  runtime: AgentRuntime;
  budget: number;
  writePolicy: WritePolicy;
  department: Department | typeof NONE;
  isDepartmentHead: boolean;
};

function emptyForm(): FormState {
  return {
    name: "",
    title: "",
    role: "general",
    description: "",
    reportsTo: NONE,
    runtime: "claude-sonnet-4-5",
    budget: 500,
    writePolicy: {},
    department: NONE,
    isDepartmentHead: false,
  };
}

function agentToForm(agent: Agent): FormState {
  return {
    name: agent.name,
    title: agent.title,
    role: agent.role,
    description: agent.description,
    reportsTo: agent.reportsTo ?? NONE,
    runtime: agent.runtime,
    budget: agent.budgetMonthlyUsd,
    writePolicy: agent.writePolicy ?? {},
    department: (agent.department ?? NONE) as Department | typeof NONE,
    isDepartmentHead: agent.isDepartmentHead ?? false,
  };
}

type Props =
  | {
      mode?: "create";
      triggerLabel?: string;
      triggerSize?: "sm" | "lg";
      agent?: undefined;
      open?: undefined;
      onOpenChange?: undefined;
    }
  | {
      mode: "edit";
      agent: Agent;
      open: boolean;
      onOpenChange: (open: boolean) => void;
      triggerLabel?: undefined;
      triggerSize?: undefined;
    };

export function AgentSheet(props: Props) {
  const isEdit = props.mode === "edit";

  const { agents, hireAgent, updateAgent, removeAgent } = useAgents();
  const { isSelfHosted } = useConfig();

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isEdit ? props.open : uncontrolledOpen;
  const setOpen = (v: boolean) => {
    if (isEdit) {
      props.onOpenChange(v);
    } else {
      setUncontrolledOpen(v);
    }
  };

  const [form, setForm] = useState<FormState>(() =>
    isEdit ? agentToForm(props.agent) : emptyForm(),
  );
  const [error, setError] = useState<string | null>(null);

  // Reset form when the sheet opens for a new agent (edit mode) or when closing.
  useEffect(() => {
    if (open) {
      setForm(isEdit ? agentToForm(props.agent) : emptyForm());
      setError(null);
    }
    // We intentionally do not include agent identity in deps to avoid
    // stomping edits mid-typing when the store rehydrates the same object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit ? props.agent.id : null]);

  const managerCandidates = agents.filter(
    (a) => !isEdit || a.id !== props.agent.id, // can't report to self
  );

  const handleSubmit = () => {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      title: form.title.trim(),
      role: form.role,
      description: form.description.trim(),
      reportsTo: form.reportsTo === NONE ? null : form.reportsTo,
      runtime: form.runtime,
      budgetMonthlyUsd: form.budget,
      writePolicy: form.writePolicy,
      department: form.department === NONE ? null : form.department,
      isDepartmentHead: form.isDepartmentHead,
    };
    if (isEdit) {
      void updateAgent(props.agent.id, payload);
    } else {
      void hireAgent(payload);
    }
    setOpen(false);
  };

  const handleFire = () => {
    if (!isEdit) return;
    void removeAgent(props.agent.id);
    setOpen(false);
  };

  const handlePauseToggle = () => {
    if (!isEdit) return;
    void updateAgent(props.agent.id, {
      status: props.agent.status === "paused" ? "idle" : "paused",
    });
  };

  const isPaused = isEdit && props.agent.status === "paused";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!isEdit && (
        <SheetTrigger
          className={cn(
            "btn-shine inline-flex shrink-0 items-center gap-1.5 rounded-[12px] bg-primary font-medium text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            props.triggerSize === "lg"
              ? "h-9 gap-1.5 px-3 text-sm"
              : "h-7 px-2.5 text-[0.8rem]",
          )}
        >
          <Plus
            className={props.triggerSize === "lg" ? "size-4" : "size-3.5"}
          />
          {props.triggerLabel ?? "Hire agent"}
        </SheetTrigger>
      )}
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-130"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
            {isEdit ? "Edit agent" : "Hire an agent"}
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            {isEdit
              ? "Update role, reporting line, runtime, or connectors."
              : "Every agent gets a role, a manager, and a runtime."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-5">
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Atlas"
                className="bg-input/40"
              />
            </Field>

            <Field label="Title" hint="Helps your org chart read cleanly.">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Head of Growth"
                className="bg-input/40"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Role">
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: (v ?? "general") as AgentRole })}
                >
                  <SelectTrigger className="w-full bg-input/40">
                    <SelectValue placeholder="Choose role" />
                  </SelectTrigger>
                  <SelectContent>
                    {AGENT_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Reports to">
                <Select
                  value={form.reportsTo}
                  onValueChange={(v) => setForm({ ...form, reportsTo: v ?? NONE })}
                >
                  <SelectTrigger className="w-full bg-input/40">
                    <SelectValue placeholder="No manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No manager</SelectItem>
                    {managerCandidates.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                        {a.title ? ` — ${a.title}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field
              label="Department"
              hint="Groups this agent under that pillar on the Departments page."
            >
              <Select
                value={form.department}
                onValueChange={(v) =>
                  setForm({ ...form, department: (v ?? NONE) as Department | typeof NONE })
                }
              >
                <SelectTrigger className="w-full bg-input/40">
                  <SelectValue placeholder="No department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="fulfilment">Fulfilment</SelectItem>
                  <SelectItem value="finance">Finance</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Department head"
              hint="Department heads (CMO, CTO, COO, CEO) can be assigned a Telegram bot. Sub-agents cannot."
            >
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-input/40 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={form.isDepartmentHead}
                  onChange={(e) =>
                    setForm({ ...form, isDepartmentHead: e.target.checked })
                  }
                  disabled={form.department === NONE}
                  className="size-4"
                />
                <span className="text-[12.5px] text-foreground">
                  This agent is the head of {form.department === NONE
                    ? "(pick a department first)"
                    : form.department}
                </span>
              </label>
            </Field>

            {isEdit && form.isDepartmentHead && (
              <AgentTelegramBotPanel
                agentId={props.agent.id}
                agentName={form.name || props.agent.name}
              />
            )}

            <Field
              label="Job description"
              hint="What is this agent responsible for? The clearer, the better."
            >
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Writes LinkedIn posts daily in the founder's voice..."
                rows={5}
                className="bg-input/40"
              />
            </Field>

            {!isSelfHosted && (
              <Field label="Runtime" hint="Which model powers this agent.">
                <Select
                  value={form.runtime}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      runtime: (v ?? "claude-sonnet-4-5") as AgentRuntime,
                    })
                  }
                >
                  <SelectTrigger className="w-full bg-input/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGENT_RUNTIMES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        <span className="font-medium">{r.label}</span>
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          {r.provider}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {isSelfHosted ? (
              <Field label="Connectors">
                <ConnectorsPicker
                  value={form.writePolicy}
                  onChange={(writePolicy) => setForm({ ...form, writePolicy })}
                />
              </Field>
            ) : (
              <Field
                label="Tools & integrations"
                hint="Pick which tools this agent can call. For write actions, choose how much oversight you want."
              >
                <ToolsPicker
                  value={form.writePolicy}
                  onChange={(writePolicy) => setForm({ ...form, writePolicy })}
                />
              </Field>
            )}

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="border-t border-border bg-background px-6 py-4">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {isEdit && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePauseToggle}
                    className="text-muted-foreground"
                  >
                    {isPaused ? (
                      <>
                        <Play className="size-3.5" /> Resume
                      </>
                    ) : (
                      <>
                        <Pause className="size-3.5" /> Pause
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleFire}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" /> Fire
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <SheetClose
                render={
                  <Button variant="ghost" size="sm">
                    Cancel
                  </Button>
                }
              />
              <Button
                onClick={handleSubmit}
                size="sm"
                className="btn-shine bg-primary text-white hover:bg-primary/90"
              >
                {isEdit ? (
                  <>
                    <Save className="size-4" /> Save changes
                  </>
                ) : (
                  <>
                    <Plus className="size-4" /> Hire agent
                  </>
                )}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[12px] font-medium text-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
