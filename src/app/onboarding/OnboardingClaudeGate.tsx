"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { ClaudeConnectionCard } from "@/components/connections/claude-card";
import { jsonFetcher } from "@/lib/swr";

/**
 * Hard gate shown on /onboarding when no Claude Max OAuth token is
 * connected AND no env-level ANTHROPIC_API_KEY fallback is configured.
 * Operator MUST connect before any onboarding step is rendered, since
 * every downstream agent reply path collapses without a working key.
 *
 * Once SWR sees `connected: true` (toggled by ClaudeConnectionCard's
 * own /api/connections/claude/oauth/complete call), force a full reload
 * so the server-side requireConnect check in page.tsx flips and the
 * actual onboarding chat takes over.
 */
export function OnboardingClaudeGate() {
  const { data } = useSWR<{ connected: boolean }>(
    "/api/connections/claude",
    jsonFetcher,
    { refreshInterval: 2000 },
  );
  const connected = data?.connected ?? false;

  useEffect(() => {
    if (connected) {
      // Server-rendered page can't react to SWR. Reload to re-evaluate
      // the requireConnect gate; user lands on the actual onboarding.
      window.location.reload();
    }
  }, [connected]);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[1.5px] text-amber-300">
            Required first step
          </div>
          <h2 className="font-serif text-2xl text-foreground">
            Sign in with Claude Max
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Onboarding cannot start without a connected Claude Max account.
            This powers every agent reply on your dashboard.
          </p>
        </div>
        <ClaudeConnectionCard />
        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Already connected? Page will continue automatically.
        </p>
      </div>
    </div>
  );
}
