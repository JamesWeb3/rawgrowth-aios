import Image from "next/image";
import Link from "next/link";

import { getOrgContext } from "@/lib/auth/admin";
import { computeOnboardingProgress } from "@/lib/onboarding";
import { supabaseAdmin } from "@/lib/supabase/server";
import OnboardingChat from "./OnboardingChat";
import { OnboardingClaudeGate } from "./OnboardingClaudeGate";

export default async function OnboardingPage() {
  const ctx = await getOrgContext();
  const firstName = ctx?.userName ? ctx.userName.split(" ")[0] : null;
  const initialProgress = ctx?.activeOrgId
    ? await computeOnboardingProgress(ctx.activeOrgId)
    : { current: 0, total: 14, completed: [] };

  // Pre-onboarding gate: agent chat post-onboarding only works if Claude
  // Max OAuth is wired. If no env-level ANTHROPIC_API_KEY fallback is
  // set either, BLOCK onboarding entirely - the operator MUST connect
  // before proceeding (Pedro's rule: API key absent => Claude Code login
  // required upfront).
  let claudeMaxConnected = false;
  if (ctx?.activeOrgId) {
    const { data } = await supabaseAdmin()
      .from("rgaios_connections")
      .select("id")
      .eq("organization_id", ctx.activeOrgId)
      .eq("provider_config_key", "claude-max")
      .maybeSingle();
    claudeMaxConnected = !!data;
  }
  const hasApiKeyFallback = !!process.env.ANTHROPIC_API_KEY;
  const requireConnect = !claudeMaxConnected && !hasApiKeyFallback;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="rg-fade-in shrink-0 border-b border-[rgba(255,255,255,0.06)] bg-[#0A1210]/60">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-6 py-5 md:px-8">
          <Image
            src="/rawgrowth.png"
            alt="Rawgrowth"
            width={32}
            height={32}
            priority
            className="h-8 w-8 object-contain"
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-2xl font-normal tracking-tight text-foreground">
              Onboarding
            </h1>
            <p className="text-sm text-muted-foreground">
              Let&apos;s get to know your business.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/connections"
              className={
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium " +
                (claudeMaxConnected
                  ? "border border-[var(--line)] bg-primary/10 text-primary hover:bg-primary/15"
                  : "bg-amber-400/15 text-amber-200 hover:bg-amber-400/25")
              }
              title={
                claudeMaxConnected
                  ? "Claude Max is connected - manage at /connections"
                  : "Connect Claude Max to enable agent chat after onboarding"
              }
            >
              {claudeMaxConnected ? (
                <>
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                  Claude Max connected
                </>
              ) : (
                <>+ Connect Claude Max</>
              )}
            </Link>
            {/* Skip is hidden when the gate is forcing connect. Otherwise
                the operator already has a working key fallback so they
                can revisit later. */}
            {!requireConnect && (
              <Link
                href="/api/onboarding/skip"
                className="inline-flex items-center rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface)] px-3 py-1.5 text-[12px] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"
                title="Skip onboarding for now - you can come back from the sidebar"
              >
                Skip onboarding
              </Link>
            )}
          </div>
        </div>
      </header>

      {!claudeMaxConnected && !requireConnect && (
        <div className="rg-fade-in shrink-0 border-b border-amber-400/20 bg-amber-400/5">
          <div className="mx-auto max-w-2xl px-6 py-2.5 text-[11px] text-amber-200/80 md:px-8">
            Heads up: agent chat needs Claude Max wired - click{" "}
            <Link href="/connections" className="font-medium text-amber-200 underline hover:no-underline">
              + Connect Claude Max
            </Link>{" "}
            up top now or after onboarding.
          </div>
        </div>
      )}

      {requireConnect ? (
        <OnboardingClaudeGate />
      ) : (
        <div className="min-h-0 flex-1">
          <OnboardingChat firstName={firstName} initialProgress={initialProgress} />
        </div>
      )}
    </div>
  );
}
