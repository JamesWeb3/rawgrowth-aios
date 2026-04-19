"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Wrench,
  Clock3,
  FileText,
  PlayCircle,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
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
import { Button } from "@/components/ui/button";
import { useRunDetail, type AuditEvent } from "@/lib/runs/use-runs";

type Props = {
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RunDetailSheet({ runId, open, onOpenChange }: Props) {
  const { detail, loaded } = useRunDetail(open ? runId : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-180"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
            {detail?.routine?.title ?? "Run"}
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            {loaded ? (
              <>
                Run id: <code className="font-mono">{runId}</code>
                {detail?.agent && (
                  <>
                    {" "}· Agent:{" "}
                    <span className="text-foreground">{detail.agent.name}</span>
                  </>
                )}
                {detail?.run.source && (
                  <>
                    {" "}· Source:{" "}
                    <span className="text-foreground">{detail.run.source}</span>
                  </>
                )}
              </>
            ) : (
              "Loading…"
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!loaded || !detail ? (
            <div className="space-y-2">
              <div className="h-24 animate-pulse rounded-lg border border-border bg-card/30" />
              <div className="h-16 animate-pulse rounded-lg border border-border bg-card/30" />
              <div className="h-16 animate-pulse rounded-lg border border-border bg-card/30" />
            </div>
          ) : (
            <DetailBody detail={detail} />
          )}
        </div>

        <SheetFooter className="border-t border-border bg-background px-6 py-4">
          <SheetClose
            render={
              <Button variant="ghost" size="sm" className="ml-auto">
                Close
              </Button>
            }
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ detail }: { detail: NonNullable<ReturnType<typeof useRunDetail>["detail"]> }) {
  const { run, routine, events } = detail;
  const toolCallEvents = events.filter((e) => e.kind === "tool_call");
  const textOutput =
    (run.output as { text?: string } | null)?.text ?? "";

  return (
    <div className="flex flex-col gap-5">
      {/* Status banner */}
      <StatusBanner status={run.status} error={run.error} />

      {/* Input */}
      {run.input_payload && Object.keys(run.input_payload).length > 0 && (
        <Section title="Input payload" icon={PlayCircle}>
          <pre className="overflow-x-auto rounded-lg border border-border bg-card/30 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {JSON.stringify(run.input_payload, null, 2)}
          </pre>
        </Section>
      )}

      {/* Timeline of tool calls */}
      <Section title={`Timeline · ${toolCallEvents.length} tool call${toolCallEvents.length === 1 ? "" : "s"}`} icon={Wrench}>
        {events.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            No timeline events yet. They&apos;ll appear as the run executes.
          </p>
        ) : (
          <ol className="relative space-y-0 pl-5 before:absolute before:left-1.5 before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border">
            {events.map((e) => (
              <TimelineRow key={e.id} event={e} />
            ))}
          </ol>
        )}
      </Section>

      {/* Final output text */}
      {textOutput && (
        <Section title="Agent output" icon={FileText}>
          <div className="whitespace-pre-wrap rounded-lg border border-border bg-card/30 p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
            {textOutput}
          </div>
        </Section>
      )}

      {/* Routine instructions (for context) */}
      {routine?.description && (
        <Section title="Routine instructions" icon={Clock3}>
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-card/30 p-4 text-[12px] leading-relaxed text-muted-foreground">
            {routine.description}
          </p>
        </Section>
      )}
    </div>
  );
}

function StatusBanner({
  status,
  error,
}: {
  status: string;
  error: string | null;
}) {
  if (status === "failed") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-semibold">Run failed</div>
          <div className="mt-0.5 font-mono">{error ?? "unknown error"}</div>
        </div>
      </div>
    );
  }
  if (status === "succeeded") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-[12px] text-primary">
        <CheckCircle2 className="size-4 shrink-0" />
        <span className="font-semibold">Run succeeded.</span>
      </div>
    );
  }
  if (status === "running") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-[12px] text-primary">
        <span className="size-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]" />
        <span className="font-semibold">Running now — timeline updates live.</span>
      </div>
    );
  }
  if (status === "pending") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/30 p-3 text-[12px] text-muted-foreground">
        <Clock3 className="size-4 shrink-0" />
        <span>Queued. Waiting for the executor to pick it up.</span>
      </div>
    );
  }
  if (status === "awaiting_approval") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-400">
        <AlertTriangle className="size-4 shrink-0" />
        <span>Awaiting human approval before continuing.</span>
      </div>
    );
  }
  return null;
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Wrench;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
        <Icon className="size-3" />
        {title}
      </div>
      {children}
    </div>
  );
}

function TimelineRow({ event }: { event: AuditEvent }) {
  const isTool = event.kind === "tool_call";
  const isError = Boolean(event.detail.is_error);
  const isSuccess = event.kind === "run_succeeded";
  const isFailure = event.kind === "run_failed";

  return (
    <li className="relative py-2">
      <span
        className={cn(
          "absolute -left-[14px] top-3 flex size-3 items-center justify-center rounded-full border-2 border-background",
          isError || isFailure
            ? "bg-destructive"
            : isSuccess
              ? "bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]"
              : isTool
                ? "bg-primary"
                : "bg-muted-foreground/60",
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isTool ? (
            <div className="flex items-center gap-1.5">
              <Badge
                variant="secondary"
                className={cn(
                  "font-mono text-[10.5px]",
                  isError
                    ? "bg-destructive/15 text-destructive"
                    : "bg-primary/10 text-primary",
                )}
              >
                {String(event.detail.tool ?? "tool")}
              </Badge>
              {isError && (
                <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
                  <XCircle className="size-2.5" />
                  error
                </span>
              )}
            </div>
          ) : (
            <div className="text-[12px] font-medium text-foreground">
              {event.kind.replace(/_/g, " ")}
            </div>
          )}
          {event.kind === "run_failed" && event.detail.error ? (
            <div className="mt-0.5 font-mono text-[11px] text-destructive/90">
              {String(event.detail.error)}
            </div>
          ) : event.kind === "run_succeeded" && event.detail.text_preview ? (
            <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
              {String(event.detail.text_preview)}
            </div>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
          {new Date(event.ts).toLocaleTimeString()}
        </span>
      </div>
    </li>
  );
}
