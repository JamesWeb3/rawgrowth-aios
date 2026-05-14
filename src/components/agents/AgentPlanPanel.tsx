"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Check,
  ChevronRight,
  Circle,
  ListChecks,
  Loader2,
  OctagonAlert,
} from "lucide-react";

import { jsonFetcher } from "@/lib/swr";

/**
 * AgentPlanPanel
 *
 * Operator-facing surface for the orchestrator's durable plan artifact.
 * The COO / Atlas persona persists a plan via the plan_create /
 * plan_update / plan_get MCP tools (backed by `rgaios_plans`, migration
 * 0071), but until now there was no UI: the operator could not see the
 * agent's active plan + per-step status anywhere in the chat.
 *
 * This renders a compact, collapsed-by-default chip ("Plan: <goal>")
 * that expands into a checklist of the plan's steps with their status
 * (pending / running / done / blocked). It sits in the chat header
 * strip of AgentChatTab so it never clutters the message timeline and
 * stays out of the way when there is no plan.
 *
 * Data source: GET /api/agents/[id]/plan (see note below - this route
 * does NOT exist yet and must be created). Expected response shape:
 *
 *   200 { plan: PlanResponse | null }
 *
 *   type PlanResponse = {
 *     id: string;
 *     goal: string;
 *     status: "active" | "completed" | "abandoned";
 *     steps: Array<{
 *       id?: string;
 *       desc?: string;
 *       owner_agent_id?: string | null;
 *       status?: "pending" | "running" | "done" | "blocked";
 *     }>;
 *     updated_at: string;
 *   }
 *
 * The route should return the org's most-recently-updated `active` plan
 * for this agent (`owner_agent_id = agentId`, scoped to the caller's
 * organization_id), or `{ plan: null }` when there is none - mirroring
 * the no-id branch of the `plan_get` MCP tool in
 * src/lib/mcp/tools/plans.ts. When `plan` is null the panel renders
 * nothing.
 */

type StepStatus = "pending" | "running" | "done" | "blocked";

type PlanStep = {
  id?: string;
  desc?: string;
  owner_agent_id?: string | null;
  status?: StepStatus;
};

type PlanResponse = {
  id: string;
  goal: string;
  status: "active" | "completed" | "abandoned";
  steps: PlanStep[];
  updated_at: string;
};

const VALID_STEP_STATUS: readonly StepStatus[] = [
  "pending",
  "running",
  "done",
  "blocked",
];

function normalizeStatus(raw: unknown): StepStatus {
  return (VALID_STEP_STATUS as readonly unknown[]).includes(raw)
    ? (raw as StepStatus)
    : "pending";
}

// One step's status node: icon + accent matched to the orchestration
// timeline's tone vocabulary in AgentChatTab (brand-primary for live /
// done, amber for blocked, muted for pending).
function StepStatusIcon({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <Check className="size-3.5 shrink-0 text-[var(--brand-primary)]" aria-hidden />
    );
  }
  if (status === "running") {
    return (
      <Loader2
        className="size-3.5 shrink-0 animate-spin text-[var(--brand-primary)]"
        aria-hidden
      />
    );
  }
  if (status === "blocked") {
    return (
      <OctagonAlert
        className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300"
        aria-hidden
      />
    );
  }
  return (
    <Circle className="size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
  );
}

export default function AgentPlanPanel({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false);

  // Reuse the shared jsonFetcher (auth-redirect aware) like the rest of
  // the app's SWR hooks. revalidateOnFocus default is fine - the plan
  // changes slowly relative to a chat turn.
  const { data, error } = useSWR<{ plan: PlanResponse | null }>(
    `/api/agents/${agentId}/plan`,
    jsonFetcher,
  );

  const plan = data?.plan ?? null;

  // Render nothing when there is no plan, the fetch errored, or it is
  // still loading. The panel is purely additive - a missing endpoint or
  // an empty plan store must not break the chat header.
  if (error || !plan) return null;

  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const doneCount = steps.filter(
    (s) => normalizeStatus(s.status) === "done",
  ).length;

  return (
    <div className="shrink-0 border-b border-[var(--line)] bg-[var(--brand-surface)]/40">
      <div className="mx-auto max-w-2xl px-4 py-2">
        {/* Collapsed chip - always visible, click to expand. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="agent-plan-toggle"
          className="flex w-full items-center gap-2 text-left"
        >
          <ChevronRight
            className={
              "size-3.5 shrink-0 text-[var(--text-muted)] transition-transform " +
              (open ? "rotate-90" : "")
            }
            aria-hidden
          />
          <ListChecks
            className="size-3.5 shrink-0 text-[var(--brand-primary)]"
            aria-hidden
          />
          <span className="text-[11px] font-medium uppercase tracking-[1.5px] text-[var(--text-muted)]">
            Plan
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-body)]">
            {plan.goal}
          </span>
          {steps.length > 0 && (
            <span className="shrink-0 rounded-full bg-[var(--brand-surface-2)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {doneCount}/{steps.length}
            </span>
          )}
        </button>

        {/* Expanded checklist. */}
        {open && (
          <div className="mt-2 border-t border-[var(--line)] pt-2">
            {steps.length === 0 ? (
              <p className="text-[11px] text-[var(--text-muted)]">
                No steps recorded yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {steps.map((step, i) => {
                  const status = normalizeStatus(step.status);
                  const desc =
                    typeof step.desc === "string" && step.desc.trim()
                      ? step.desc
                      : "(no description)";
                  return (
                    <li
                      key={step.id ? String(step.id) : i}
                      className="flex items-start gap-2"
                      data-step-status={status}
                    >
                      <span className="mt-0.5">
                        <StepStatusIcon status={status} />
                      </span>
                      <span
                        className={
                          "min-w-0 flex-1 text-[12px] leading-relaxed " +
                          (status === "done"
                            ? "text-[var(--text-muted)] line-through"
                            : "text-[var(--text-body)]")
                        }
                      >
                        {desc}
                      </span>
                      <span
                        className={
                          "shrink-0 text-[9px] font-medium uppercase tracking-wide " +
                          (status === "running"
                            ? "text-[var(--brand-primary)]"
                            : status === "blocked"
                              ? "text-amber-600 dark:text-amber-300"
                              : "text-[var(--text-muted)]")
                        }
                      >
                        {status}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
