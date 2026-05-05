import Link from "next/link";
import { Bot, Pause, Play, ShieldCheck } from "lucide-react";

import type { AutonomousMode } from "@/lib/organizations/autonomous";

const COPY: Record<
  AutonomousMode,
  { label: string; tone: string; Icon: typeof Bot }
> = {
  off: {
    label: "Autonomous: Off",
    tone: "border-border bg-muted/30 text-muted-foreground",
    Icon: Pause,
  },
  review: {
    label: "Autonomous: Review",
    tone: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    Icon: ShieldCheck,
  },
  on: {
    label: "Autonomous: On",
    tone: "border-primary/40 bg-primary/10 text-primary",
    Icon: Play,
  },
};

/**
 * Small pill rendered next to the Dashboard title. Links straight into
 * /company/autonomous so the operator can flip mode without hunting
 * through Settings.
 */
export function AutonomousPill({ mode }: { mode: AutonomousMode }) {
  const meta = COPY[mode];
  return (
    <Link
      href="/company/autonomous"
      title="Configure autonomous mode"
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:opacity-80 " +
        meta.tone
      }
    >
      <meta.Icon className="size-3" strokeWidth={2} />
      {meta.label}
    </Link>
  );
}
