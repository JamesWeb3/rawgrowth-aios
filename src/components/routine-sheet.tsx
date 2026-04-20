"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarClock,
  Check,
  Clock3,
  Copy,
  Hand,
  MessageCircle,
  Plus,
  Save,
  Trash2,
  Webhook,
  Wand2,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

import Link from "next/link";

import { useAgents } from "@/lib/agents/use-agents";
import { getIntegration } from "@/lib/integrations-catalog";
import { useConnections } from "@/lib/connections/use-connections";
import {
  INTEGRATION_EVENTS,
  SCHEDULE_PRESETS,
  TRIGGER_KINDS,
  newTrigger,
  type IntegrationEvent,
  type RoutineTrigger,
  type SchedulePreset,
  type TriggerKind,
} from "@/lib/routines/constants";
import { useRoutines } from "@/lib/routines/use-routines";
import type { Routine } from "@/lib/routines/dto";

/** Extract the integration id prefix from an event id: "fathom.meeting.ended" → "fathom". */
function eventIntegrationId(event: string): string {
  const prefix = event.split(".")[0] ?? "";
  // map prefix → catalog id
  if (prefix === "gdrive") return "google-drive";
  return prefix;
}

const NONE = "__none__";

const triggerIcon: Record<TriggerKind, typeof Zap> = {
  schedule: CalendarClock,
  webhook: Webhook,
  integration: Zap,
  manual: Hand,
  telegram: MessageCircle,
};

type FormState = {
  title: string;
  description: string;
  assigneeAgentId: string;
  triggers: RoutineTrigger[];
};

function emptyForm(): FormState {
  return {
    title: "",
    description: "",
    assigneeAgentId: NONE,
    triggers: [newTrigger("manual")],
  };
}

function routineToForm(r: Routine): FormState {
  return {
    title: r.title,
    description: r.description,
    assigneeAgentId: r.assigneeAgentId ?? NONE,
    triggers: r.triggers,
  };
}

type Props =
  | {
      mode?: "create";
      triggerLabel?: string;
      triggerSize?: "sm" | "lg";
      routine?: undefined;
      open?: undefined;
      onOpenChange?: undefined;
    }
  | {
      mode: "edit";
      routine: Routine;
      open: boolean;
      onOpenChange: (open: boolean) => void;
      triggerLabel?: undefined;
      triggerSize?: undefined;
    };

export function RoutineSheet(props: Props) {
  const isEdit = props.mode === "edit";

  const { agents } = useAgents();
  const { createRoutine, updateRoutine, removeRoutine } = useRoutines();

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
    isEdit ? routineToForm(props.routine) : emptyForm(),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(isEdit ? routineToForm(props.routine) : emptyForm());
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit ? props.routine.id : null]);

  const addTrigger = (kind: TriggerKind) => {
    setForm((f) => ({ ...f, triggers: [...f.triggers, newTrigger(kind)] }));
  };

  const updateTrigger = (id: string, patch: Partial<RoutineTrigger>) => {
    setForm((f) => ({
      ...f,
      triggers: f.triggers.map((t) =>
        t.id === id ? ({ ...t, ...patch } as RoutineTrigger) : t,
      ),
    }));
  };

  const removeTrigger = (id: string) => {
    setForm((f) => ({ ...f, triggers: f.triggers.filter((t) => t.id !== id) }));
  };

  const handleSubmit = () => {
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (form.triggers.length === 0) {
      setError("Add at least one trigger.");
      return;
    }
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      assigneeAgentId:
        form.assigneeAgentId === NONE ? null : form.assigneeAgentId,
      triggers: form.triggers,
    };
    if (isEdit) {
      void updateRoutine(props.routine.id, payload);
    } else {
      void createRoutine(payload);
    }
    setOpen(false);
  };

  const handleDelete = () => {
    if (!isEdit) return;
    void removeRoutine(props.routine.id);
    setOpen(false);
  };

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
          {props.triggerLabel ?? "New routine"}
        </SheetTrigger>
      )}
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-160"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
            {isEdit ? "Edit routine" : "New routine"}
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            A routine = trigger + agent + natural-language instructions. The
            agent decides how to execute using its connected integrations.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-5">
            <Field label="Title">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Post-call SOP generator"
                className="bg-input/40"
              />
            </Field>

            <Field
              label="Instructions"
              hint="Describe what the agent should do when triggered. Written as a playbook in plain English — the agent will follow it using its connected tools."
            >
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder={`When a Fathom meeting concludes:
1. Pull the transcript from the webhook payload.
2. Look up the client in Google Drive and pull any SOP notes.
3. Write a tailored SOP draft for them.
4. Email it to the client's account manager.`}
                rows={8}
                className="bg-input/40 font-mono text-[12.5px] leading-relaxed"
              />
            </Field>

            <Field
              label="Assigned agent"
              hint="The agent that owns this routine's execution."
            >
              <Select
                value={form.assigneeAgentId}
                onValueChange={(v) => setForm({ ...form, assigneeAgentId: v ?? NONE })}
              >
                <SelectTrigger className="w-full bg-input/40">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {a.title ? ` — ${a.title}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agents.length === 0 && (
                <p className="text-[11px] text-amber-400/80">
                  You haven&apos;t hired any agents yet. Hire one first so it can run this routine.
                </p>
              )}
            </Field>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-[12px] font-medium text-foreground">
                  Triggers
                </Label>
                <AddTriggerPopover onPick={addTrigger} />
              </div>
              <p className="mb-3 text-[11px] text-muted-foreground">
                Any trigger firing will run this routine. Combine a schedule
                with a webhook for redundancy.
              </p>

              <div className="flex flex-col gap-3">
                {form.triggers.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border bg-card/20 px-4 py-6 text-center text-[12px] text-muted-foreground">
                    No triggers yet. Add one to make this routine runnable.
                  </div>
                )}
                {form.triggers.map((t) => (
                  <TriggerEditor
                    key={t.id}
                    trigger={t}
                    onUpdate={(patch) => updateTrigger(t.id, patch)}
                    onRemove={() => removeTrigger(t.id)}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="border-t border-border bg-background px-6 py-4">
          <div className="flex w-full items-center justify-between gap-3">
            <div>
              {isEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" /> Delete routine
                </Button>
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
                    <Save className="size-4" /> Save
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4" /> Create routine
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

// ────────────────────────── Trigger editor ──────────────────────────

function TriggerEditor({
  trigger,
  onUpdate,
  onRemove,
}: {
  trigger: RoutineTrigger;
  onUpdate: (patch: Partial<RoutineTrigger>) => void;
  onRemove: () => void;
}) {
  const Icon = triggerIcon[trigger.kind];
  const kindLabel = TRIGGER_KINDS.find((k) => k.value === trigger.kind)?.label;

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md border border-border bg-primary/10 text-primary">
            <Icon className="size-3.5" />
          </div>
          <span className="text-[12px] font-semibold text-foreground">
            {kindLabel}
          </span>
          {!trigger.enabled && (
            <Badge
              variant="secondary"
              className="bg-white/5 text-[10px] text-muted-foreground"
            >
              Disabled
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdate({ enabled: !trigger.enabled })}
            className="rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {trigger.enabled ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {trigger.kind === "schedule" && (
        <ScheduleTriggerConfig
          trigger={trigger}
          onUpdate={(patch) => onUpdate(patch as Partial<RoutineTrigger>)}
        />
      )}
      {trigger.kind === "webhook" && (
        <WebhookTriggerConfig trigger={trigger} />
      )}
      {trigger.kind === "integration" && (
        <IntegrationTriggerConfig
          trigger={trigger}
          onUpdate={(patch) => onUpdate(patch as Partial<RoutineTrigger>)}
        />
      )}
      {trigger.kind === "telegram" && (
        <TelegramTriggerConfig
          trigger={trigger}
          onUpdate={(patch) => onUpdate(patch as Partial<RoutineTrigger>)}
        />
      )}
      {trigger.kind === "manual" && (
        <p className="text-[11px] text-muted-foreground">
          This trigger only fires when you click <strong>Run now</strong> on the
          routine card. Useful for ad-hoc execution.
        </p>
      )}
    </div>
  );
}

function ScheduleTriggerConfig({
  trigger,
  onUpdate,
}: {
  trigger: Extract<RoutineTrigger, { kind: "schedule" }>;
  onUpdate: (patch: Partial<Extract<RoutineTrigger, { kind: "schedule" }>>) => void;
}) {
  const isCustom = trigger.preset === "custom";
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={trigger.preset}
        onValueChange={(v) => {
          const next = (v ?? "every-day-9am") as SchedulePreset;
          const preset = SCHEDULE_PRESETS.find((p) => p.value === next);
          onUpdate({
            preset: next,
            cron: preset && preset.value !== "custom" ? preset.cron : trigger.cron,
          });
        }}
      >
        <SelectTrigger className="w-full bg-input/40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCHEDULE_PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isCustom && (
        <Input
          value={trigger.cron}
          onChange={(e) => onUpdate({ cron: e.target.value })}
          placeholder="0 9 * * *"
          className="bg-input/40 font-mono text-[12px]"
        />
      )}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Clock3 className="size-3" />
        Cron <code className="font-mono text-foreground">{trigger.cron || "—"}</code>
        <span className="text-border">•</span>
        <span className="font-mono">{trigger.timezone}</span>
      </div>
    </div>
  );
}

function WebhookTriggerConfig({
  trigger,
}: {
  trigger: Extract<RoutineTrigger, { kind: "webhook" }>;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(trigger.publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op */
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2.5 py-1.5">
        <code className="flex-1 truncate font-mono text-[11.5px] text-foreground">
          {trigger.publicUrl}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        POST a JSON payload to this URL to fire the routine. Signing secret:{" "}
        <code className="font-mono text-foreground/80">
          {trigger.signingSecret.slice(0, 12)}…
        </code>
      </p>
    </div>
  );
}

function IntegrationTriggerConfig({
  trigger,
  onUpdate,
}: {
  trigger: Extract<RoutineTrigger, { kind: "integration" }>;
  onUpdate: (patch: Partial<Extract<RoutineTrigger, { kind: "integration" }>>) => void;
}) {
  const { isConnected } = useConnections();
  const selectedIntegrationId = eventIntegrationId(trigger.event);
  const selectedConnected = isConnected(selectedIntegrationId);
  const selectedIntegration = getIntegration(selectedIntegrationId);

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={trigger.event}
        onValueChange={(v) =>
          onUpdate({
            event: (v ?? "fathom.meeting.ended") as IntegrationEvent,
          })
        }
      >
        <SelectTrigger className="w-full bg-input/40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTEGRATION_EVENTS.map((e) => {
            const intId = eventIntegrationId(e.value);
            const connected = isConnected(intId);
            return (
              <SelectItem key={e.value} value={e.value}>
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      connected
                        ? "bg-primary shadow-[0_0_6px_rgba(12,191,106,.5)]"
                        : "bg-muted-foreground/40",
                    )}
                  />
                  <span>{e.label}</span>
                  {!connected && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Not connected
                    </span>
                  )}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {selectedConnected ? (
        <p className="text-[11px] text-muted-foreground">
          Fires whenever {selectedIntegration?.name ?? "this tool"} emits this
          event. Payload passed into the agent at run time.
        </p>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400/90">
          <span className="mt-0.5">
            {selectedIntegration?.name ?? "This integration"} isn&apos;t
            connected yet, so this trigger won&apos;t fire.
          </span>
          <Link
            href="/integrations"
            className="ml-auto shrink-0 font-semibold text-amber-400 hover:underline"
          >
            Connect →
          </Link>
        </div>
      )}
    </div>
  );
}

function TelegramTriggerConfig({
  trigger,
  onUpdate,
}: {
  trigger: Extract<RoutineTrigger, { kind: "telegram" }>;
  onUpdate: (patch: Partial<Extract<RoutineTrigger, { kind: "telegram" }>>) => void;
}) {
  const { isConnected } = useConnections();
  const telegramConnected = isConnected("telegram");

  // Normalise: always store with a leading slash, lowercase, no spaces.
  const onCommandChange = (value: string) => {
    const trimmed = value.trim().replace(/\s+/g, "");
    const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    onUpdate({ command: withSlash.toLowerCase() });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-[11px] font-medium text-foreground">Command</Label>
      <Input
        value={trigger.command}
        onChange={(e) => onCommandChange(e.target.value)}
        placeholder="/proposal"
        className="bg-input/40 font-mono text-[12.5px]"
      />
      <Label className="text-[11px] font-medium text-foreground">
        Description
      </Label>
      <Input
        value={trigger.description ?? ""}
        onChange={(e) => onUpdate({ description: e.target.value })}
        placeholder="Generate a proposal for a customer"
        className="bg-input/40"
      />
      {telegramConnected ? (
        <p className="text-[11px] text-muted-foreground">
          Fires whenever a user DMs your bot with{" "}
          <code className="font-mono text-foreground/80">
            {trigger.command} &lt;args&gt;
          </code>
          . Anything after the command lands in the run&apos;s input_payload
          under <code className="font-mono">telegram.args</code>.
        </p>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400/90">
          <span className="mt-0.5">
            Telegram isn&apos;t connected yet, so this trigger won&apos;t fire.
          </span>
          <Link
            href="/integrations"
            className="ml-auto shrink-0 font-semibold text-amber-400 hover:underline"
          >
            Connect →
          </Link>
        </div>
      )}
    </div>
  );
}

// ────────────────────────── Add trigger picker ──────────────────────────

function AddTriggerPopover({ onPick }: { onPick: (kind: TriggerKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card/40 px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
        <Plus className="size-3" /> Add trigger
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-64 border-border bg-popover p-1 text-foreground"
      >
        {TRIGGER_KINDS.map((k, i) => {
          const Icon = triggerIcon[k.value];
          return (
            <div key={k.value}>
              {i > 0 && <Separator className="my-0.5" />}
              <button
                type="button"
                onClick={() => {
                  onPick(k.value);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-primary/10 text-primary">
                  <Icon className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-foreground">
                    {k.label}
                  </div>
                  <div className="text-[11px] leading-snug text-muted-foreground">
                    {k.description}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ────────────────────────── Field helper ──────────────────────────

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
