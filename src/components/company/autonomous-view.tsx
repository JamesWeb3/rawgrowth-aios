"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Check,
  CircleDot,
  Loader2,
  Pause,
  Play,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type {
  AutonomousMode,
  AutonomousSettings,
} from "@/lib/organizations/autonomous";

type ModeOption = {
  value: AutonomousMode;
  title: string;
  description: string;
  Icon: typeof Bot;
};

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "off",
    title: "Off",
    description:
      "Insights detected and surfaced, nothing executes. Operator decides everything by hand.",
    Icon: Pause,
  },
  {
    value: "review",
    title: "Review (default)",
    description:
      "Atlas drafts a plan and waits for your approval before any task runs. Safe default.",
    Icon: ShieldCheck,
  },
  {
    value: "on",
    title: "On",
    description:
      "Atlas approves and executes its own plan. Loops with different angles until the metric recovers or the iteration cap is hit.",
    Icon: Play,
  },
];

export function CompanyAutonomousView({
  initial,
  canEdit,
}: {
  initial: AutonomousSettings;
  canEdit: boolean;
}) {
  const [mode, setMode] = useState<AutonomousMode>(initial.mode);
  const [iter, setIter] = useState<number>(initial.maxLoopIterations);
  const [saved, setSaved] = useState<AutonomousSettings>(initial);
  const [saving, setSaving] = useState(false);

  const dirty =
    mode !== saved.mode || iter !== saved.maxLoopIterations;

  async function save() {
    if (!canEdit || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/company/autonomous", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, maxLoopIterations: iter }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        settings?: AutonomousSettings;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.settings) {
        throw new Error(body.error || "Save failed");
      }
      setSaved(body.settings);
      setMode(body.settings.mode);
      setIter(body.settings.maxLoopIterations);
      toast.success("Autonomous settings saved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <ModeCard
          mode={mode}
          onChange={(m) => setMode(m)}
          canEdit={canEdit}
        />
        <IterationCard
          value={iter}
          onChange={(v) => setIter(v)}
          canEdit={canEdit}
        />

        <div className="flex items-center justify-end gap-3">
          {dirty && (
            <span className="text-[12px] text-amber-300">
              Unsaved changes
            </span>
          )}
          <Button
            onClick={save}
            disabled={!canEdit || !dirty || saving}
            size="sm"
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Saving
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                Save changes
              </>
            )}
          </Button>
        </div>
      </div>

      <CurrentStateCard saved={saved} canEdit={canEdit} />
    </div>
  );
}

function ModeCard({
  mode,
  onChange,
  canEdit,
}: {
  mode: AutonomousMode;
  onChange: (m: AutonomousMode) => void;
  canEdit: boolean;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-6">
      <div className="mb-5 flex items-center gap-2">
        <Bot className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Autonomous mode
        </h2>
      </div>
      <p className="mb-5 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
        Controls how Atlas reacts when the metric anomaly detector fires.
        Pick how much rope you want to give the agent before a human is
        in the loop.
      </p>
      <div className="space-y-3">
        {MODE_OPTIONS.map((opt) => {
          const active = opt.value === mode;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={!canEdit}
              onClick={() => onChange(opt.value)}
              className={
                "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors " +
                (active
                  ? "border-primary/60 bg-primary/10"
                  : "border-border bg-card/30 hover:border-primary/40 hover:bg-card/60") +
                (canEdit ? "" : " cursor-not-allowed opacity-60")
              }
            >
              <span
                className={
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md " +
                  (active
                    ? "bg-primary/20 text-primary"
                    : "bg-muted/40 text-muted-foreground")
                }
              >
                <opt.Icon className="size-4" strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "text-[13px] font-semibold " +
                      (active ? "text-foreground" : "text-foreground/90")
                    }
                  >
                    {opt.title}
                  </span>
                  {active && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                      Active
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {opt.description}
                </p>
              </div>
              <span
                className={
                  "mt-1.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border " +
                  (active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-transparent")
                }
              >
                {active && <Check className="size-2.5" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function IterationCard({
  value,
  onChange,
  canEdit,
}: {
  value: number;
  onChange: (n: number) => void;
  canEdit: boolean;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-6">
      <div className="mb-5 flex items-center gap-2">
        <CircleDot className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Max loop iterations
        </h2>
      </div>
      <p className="mb-5 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
        Atlas tries N different angles before escalating to human. Each
        angle is a different plan grounded in why the previous one didn&apos;t
        move the metric.
      </p>

      <div className="flex items-end gap-6">
        <div className="font-serif text-[44px] leading-none tracking-tight text-foreground">
          {value}
        </div>
        <div className="flex-1 pb-2">
          <Slider
            min={1}
            max={30}
            step={1}
            value={[value]}
            onValueChange={(v) => {
              const next = Array.isArray(v) ? v[0] : v;
              if (typeof next === "number") onChange(next);
            }}
            disabled={!canEdit}
          />
          <div className="mt-3 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>1</span>
            <span>15</span>
            <span>30 (default)</span>
          </div>
        </div>
      </div>

      <p className="mt-5 rounded-md border border-border bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        At cap, the insight flips to <span className="font-mono text-destructive">escalated</span>{" "}
        and the alarm banner asks you for a manual call.
      </p>
    </section>
  );
}

function CurrentStateCard({
  saved,
  canEdit,
}: {
  saved: AutonomousSettings;
  canEdit: boolean;
}) {
  const modeOpt = MODE_OPTIONS.find((m) => m.value === saved.mode) ?? MODE_OPTIONS[1];
  const ts = saved.lastAppliedAt ? new Date(saved.lastAppliedAt) : null;
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-6 lg:sticky lg:top-6 lg:self-start">
      <div className="mb-5 flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Current state
        </h2>
      </div>
      <dl className="space-y-4 text-[13px]">
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Mode
          </dt>
          <dd className="mt-1.5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary">
            <modeOpt.Icon className="size-3.5" strokeWidth={1.8} />
            {modeOpt.title}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Loop iteration cap
          </dt>
          <dd className="mt-1.5 font-mono text-[14px] text-foreground">
            {saved.maxLoopIterations}
          </dd>
        </div>
        {ts && (
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Last applied
            </dt>
            <dd className="mt-1.5 text-[12px] text-foreground">
              {ts.toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </dd>
            {saved.lastAppliedByEmail && (
              <dd className="text-[11px] text-muted-foreground">
                by {saved.lastAppliedByEmail}
              </dd>
            )}
          </div>
        )}
        {!canEdit && (
          <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-200">
            Read-only. Owners and admins can change autonomous mode.
          </div>
        )}
      </dl>
    </section>
  );
}
