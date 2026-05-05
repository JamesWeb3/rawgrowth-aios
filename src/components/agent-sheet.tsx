"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

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
import type { Agent, AgentCreateInput } from "@/lib/agents/dto";
import { DEPARTMENTS } from "@/lib/agents/dto";
import { metaFor as deptMeta } from "@/components/departments/departments-view";
import { ToolsPicker, type WritePolicy } from "@/components/agents/tools-picker";
import { ConnectorsPicker } from "@/components/agents/connectors-picker";
import { AgentTelegramBotPanel } from "@/components/agents/agent-telegram-bot-panel";
import { useConfig } from "@/lib/use-config";
import {
  ROLE_TEMPLATE_LABELS,
  getRoleTemplateLabel,
} from "@/lib/agents/role-templates-client";

const NONE = "__none__";

// Quick-hire defaults per Chris's spec: drop-files-and-go flow. The full
// form is still available behind the Advanced toggle, so power users can
// still tune runtime / budget / tools when they need to.
const QUICK_HIRE_RUNTIME: AgentRuntime = "anthropic-cli" as AgentRuntime;
const QUICK_HIRE_BUDGET = 50;

// Map a freeform role text or a role-templates label onto the
// AGENT_ROLES enum used by the constraint on rgaios_agents.role. We only
// have a small set ('marketer', 'sdr', etc.) so anything unknown falls
// back to 'general'. This mirrors agent-blocks.ts L147 - the legacy hire
// path also defaults to 'general' for freeform roles.
function inferRoleEnum(text: string): AgentRole {
  const norm = text.trim().toLowerCase();
  if (!norm) return "general";
  if (norm.includes("ceo")) return "ceo";
  if (norm.includes("cto") || norm.includes("engineer")) return "engineer";
  if (
    norm.includes("market") ||
    norm.includes("copywriter") ||
    norm.includes("content") ||
    norm.includes("social") ||
    norm.includes("media buyer")
  )
    return "marketer";
  if (norm.includes("sdr") || norm.includes("sales")) return "sdr";
  if (
    norm.includes("ops") ||
    norm.includes("operations") ||
    norm.includes("project")
  )
    return "ops";
  if (norm.includes("designer") || norm.includes("design")) return "designer";
  return "general";
}

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) =>
      w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
}

// Short alphanumeric suffix so two "Copywriter" hires don't collide on
// name. Stays under 6 chars to keep org-chart cards readable.
function shortSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

type FormState = {
  name: string;
  title: string;
  role: AgentRole;
  description: string;
  reportsTo: string;
  runtime: AgentRuntime;
  budget: number;
  writePolicy: WritePolicy;
  department: string;
  isDepartmentHead: boolean;
};

function emptyForm(): FormState {
  return {
    name: "",
    title: "",
    role: "general",
    description: "",
    reportsTo: NONE,
    runtime: "claude-sonnet-4-6",
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
    department: agent.department ?? NONE,
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

  // Quick-hire form (create mode only). The Advanced toggle reveals the
  // full FormState below for operators who still want to tune runtime /
  // budget / tools / reports-to.
  const [quickRole, setQuickRole] = useState("");
  const [quickDept, setQuickDept] = useState<string>(NONE);
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Reset form when the sheet opens for a new agent (edit mode) or when
  // closing. React 19 pattern: track the trigger key in state and reset
  // during render so we avoid a set-state-in-effect cascade. We intentionally
  // do not include the full agent identity in the trigger to avoid stomping
  // edits mid-typing when the store rehydrates the same object.
  const triggerKey = `${open ? "1" : "0"}:${isEdit ? props.agent.id : "new"}`;
  const [prevTriggerKey, setPrevTriggerKey] = useState(triggerKey);
  if (prevTriggerKey !== triggerKey) {
    setPrevTriggerKey(triggerKey);
    if (open) {
      setForm(isEdit ? agentToForm(props.agent) : emptyForm());
      setError(null);
      setQuickRole("");
      setQuickDept(NONE);
      setShowAdvanced(false);
    }
  }

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

  // Resolve the dept-head id so freshly-hired agents auto-report to the
  // right manager. Falls back to null (top-level) when the dept has no
  // head yet - the operator can fix this later in Advanced.
  const findDeptHeadId = (dept: string): string | null => {
    if (dept === NONE) return null;
    const head = agents.find(
      (a) => a.department === dept && a.isDepartmentHead,
    );
    return head?.id ?? null;
  };

  const handleQuickSubmit = async () => {
    setError(null);
    const roleText = quickRole.trim();
    if (!roleText) {
      setError("Tell me what kind of agent.");
      return;
    }

    // Match against the role-templates catalog first (case-insensitive).
    // A hit gives us the canonical label (e.g. "Copywriter") which
    // autoTrainAgent picks back up server-side to wire system_prompt +
    // skills + starter files.
    const canonicalLabel = getRoleTemplateLabel(roleText);

    const dept = quickDept === NONE ? null : quickDept;
    const titleText = canonicalLabel ?? titleCase(roleText);
    const deptLabel = dept ? deptMeta(dept).label : "the team";
    const description = canonicalLabel
      ? "" // server-side auto-train fills system_prompt; description stays empty
      : `${titleText} for ${deptLabel}.`;
    // We send `role` to the API as the freeform catalog label (e.g.
    // "Copywriter") so autoTrainAgent can resolve it. The DB enum value
    // gets reconciled below via updateAgent so legacy queries that group
    // by role keep working.
    const roleForApi = (canonicalLabel ?? roleText.toLowerCase()) as AgentRole;
    const roleEnum = inferRoleEnum(canonicalLabel ?? roleText);

    const name = `${titleText} ${shortSuffix()}`;
    const reportsTo = dept ? findDeptHeadId(dept) : null;

    const payload: AgentCreateInput = {
      name,
      title: titleText,
      role: roleForApi,
      reportsTo,
      description,
      runtime: QUICK_HIRE_RUNTIME,
      budgetMonthlyUsd: QUICK_HIRE_BUDGET,
      writePolicy: {},
      department: dept,
      isDepartmentHead: false,
    };

    setQuickSubmitting(true);
    try {
      const created = await hireAgent(payload);
      // Reconcile: if the freeform label we sent doesn't match the enum
      // we want stored, patch it back. autoTrainAgent already ran with
      // the catalog label, so system_prompt + skills + starter files
      // are wired correctly regardless.
      if (roleEnum !== roleForApi) {
        void updateAgent(created.id, { role: roleEnum });
      }
      const deptText = dept ? deptMeta(dept).label : "the team";
      toast.success(`Hired ${created.name} in ${deptText}`, {
        description: "Drop files into their tab to start training.",
        action: {
          label: "Open files",
          onClick: () => {
            window.location.href = `/agents/${created.id}?tab=files`;
          },
        },
      });
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setQuickSubmitting(false);
    }
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

  const deptOptions = Array.from(
    new Set([
      ...DEPARTMENTS,
      ...agents
        .map((a) => a.department)
        .filter((d): d is string => Boolean(d)),
    ]),
  ).sort();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!isEdit && (
        <SheetTrigger
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-[12px] bg-primary font-medium text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
              : "Tell us what kind of agent. Drop files in their tab to train them."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!isEdit && (
            <div className="mb-5 flex flex-col gap-4">
              <Field
                label="What kind of agent?"
                hint="Try copywriter, SDR, designer, marketing manager. We auto-train known roles."
              >
                <Input
                  value={quickRole}
                  onChange={(e) => setQuickRole(e.target.value)}
                  placeholder="copywriter"
                  className="bg-input/40"
                  list="rawclaw-role-suggestions"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !quickSubmitting) {
                      e.preventDefault();
                      void handleQuickSubmit();
                    }
                  }}
                />
                <datalist id="rawclaw-role-suggestions">
                  {ROLE_TEMPLATE_LABELS.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
              </Field>

              <Field label="Department">
                <Select
                  value={quickDept === NONE ? undefined : quickDept}
                  onValueChange={(v) => setQuickDept(v ?? NONE)}
                >
                  <SelectTrigger className="w-full bg-input/40">
                    <SelectValue placeholder="Pick a department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {deptOptions.map((d) => (
                      <SelectItem key={d} value={d}>
                        {deptMeta(d).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Button
                onClick={() => void handleQuickSubmit()}
                disabled={quickSubmitting || !quickRole.trim()}
                className="h-11 w-full bg-primary text-[13px] font-medium text-white hover:bg-primary/90"
              >
                <Sparkles className="size-4" />
                {quickSubmitting ? "Hiring..." : "Hire"}
              </Button>

              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  // First time opening advanced: port the quick form
                  // values into the full form so progress isn't lost.
                  if (!showAdvanced) {
                    const tmplLabel = getRoleTemplateLabel(quickRole);
                    const titleText =
                      tmplLabel ??
                      (quickRole.trim() ? titleCase(quickRole) : "");
                    const deptLabel =
                      quickDept === NONE ? "the team" : deptMeta(quickDept).label;
                    setForm((prev) => ({
                      ...prev,
                      title: prev.title || titleText,
                      role: inferRoleEnum(quickRole),
                      department: quickDept,
                      description:
                        prev.description ||
                        (quickRole.trim()
                          ? `${titleText} for ${deptLabel}.`
                          : ""),
                      name:
                        prev.name ||
                        (titleText ? `${titleText} ${shortSuffix()}` : ""),
                    }));
                  }
                  setShowAdvanced((v) => !v);
                }}
                className="flex items-center gap-1.5 self-start text-[12px] text-muted-foreground hover:text-foreground"
              >
                {showAdvanced ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                Advanced
              </button>
            </div>
          )}

          <div
            className={cn(
              "flex flex-col gap-5",
              !isEdit && !showAdvanced && "hidden",
            )}
          >
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
                  onValueChange={(v) =>
                    setForm({ ...form, role: (v ?? "general") as AgentRole })
                  }
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
                  value={form.reportsTo === NONE ? undefined : form.reportsTo}
                  onValueChange={(v) =>
                    setForm({ ...form, reportsTo: v ?? NONE })
                  }
                >
                  <SelectTrigger className="w-full bg-input/40">
                    <SelectValue placeholder="No manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No manager</SelectItem>
                    {managerCandidates.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                        {a.title ? `  -  ${a.title}` : ""}
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
                value={form.department === NONE ? undefined : form.department}
                onValueChange={(v) =>
                  setForm({ ...form, department: v ?? NONE })
                }
              >
                <SelectTrigger className="w-full bg-input/40">
                  <SelectValue placeholder="No department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {deptOptions.map((d) => (
                    <SelectItem key={d} value={d}>
                      {deptMeta(d).label}
                    </SelectItem>
                  ))}
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
                      runtime: (v ?? "claude-sonnet-4-6") as AgentRuntime,
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

            {isEdit && error && (
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
              {(isEdit || showAdvanced) && (
                <Button
                  onClick={handleSubmit}
                  size="sm"
                  className="bg-primary text-white hover:bg-primary/90"
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
              )}
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
