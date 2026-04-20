"use client";

import { useState } from "react";
import {
  Building2,
  Calendar,
  Check,
  Copy,
  Globe,
  KeyRound,
  ShieldCheck,
  User,
  Users,
  Workflow,
} from "lucide-react";
import type { OrgOverview } from "@/lib/organizations/overview";

export function CompanyGeneralView({
  org,
  domain,
  deployMode,
}: {
  org: OrgOverview;
  domain: string;
  deployMode: "hosted" | "self_hosted";
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <IdentityCard org={org} />
      <OpsCard org={org} domain={domain} deployMode={deployMode} />
    </div>
  );
}

function IdentityCard({ org }: { org: OrgOverview }) {
  const created = new Date(org.createdAt);
  const createdLabel = created.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <section className="rounded-2xl border border-border bg-card/40 p-6">
      <div className="mb-5 flex items-center gap-2">
        <Building2 className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Identity
        </h2>
      </div>
      <dl className="space-y-4 text-[13px]">
        <Row icon={Building2} label="Name">
          <span className="font-medium text-foreground">{org.name}</span>
        </Row>
        <Row icon={Globe} label="Slug">
          <code className="rounded bg-input/40 px-1.5 py-0.5 font-mono text-[12px] text-foreground">
            {org.slug}
          </code>
        </Row>
        <Row icon={Calendar} label="Created">
          <span className="text-foreground">{createdLabel}</span>
        </Row>
        {org.owner && (
          <Row icon={User} label="Owner">
            <span className="text-foreground">
              {org.owner.name || org.owner.email}
            </span>
            {org.owner.name && (
              <span className="ml-2 text-muted-foreground">
                {org.owner.email}
              </span>
            )}
          </Row>
        )}
      </dl>
    </section>
  );
}

function OpsCard({
  org,
  domain,
  deployMode,
}: {
  org: OrgOverview;
  domain: string;
  deployMode: "hosted" | "self_hosted";
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-6">
      <div className="mb-5 flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Operations
        </h2>
      </div>
      <dl className="space-y-4 text-[13px]">
        <Row icon={ShieldCheck} label="Deploy mode">
          <span
            className={
              deployMode === "self_hosted"
                ? "inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary"
                : "inline-flex items-center gap-1.5 rounded-md border border-border bg-input/40 px-2 py-0.5 text-[11.5px] font-medium text-foreground"
            }
          >
            {deployMode === "self_hosted" ? "Self-hosted VPS" : "Hosted SaaS"}
          </span>
        </Row>
        <Row icon={Globe} label="Domain">
          <a
            href={`https://${domain}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12px] text-primary hover:underline"
          >
            {domain}
          </a>
        </Row>
        <Row icon={KeyRound} label="MCP token">
          <McpTokenField token={org.mcpToken} />
        </Row>
        <Row icon={Users} label="Agents">
          <span className="text-foreground">
            <span className="font-semibold">{org.agentCount}</span> total
          </span>
          <span className="ml-2 text-muted-foreground">
            • {org.runningAgentCount} running
          </span>
        </Row>
        <Row icon={Workflow} label="Routines">
          <span className="text-foreground">
            <span className="font-semibold">{org.routineCount}</span> total
          </span>
          <span className="ml-2 text-muted-foreground">
            • {org.scheduledRoutineCount} scheduled
          </span>
        </Row>
      </dl>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="mb-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          Active pillars
        </h3>
        <div className="flex flex-wrap gap-2">
          <Pillar label="Marketing" active={org.pillars.marketing} />
          <Pillar label="Sales" active={org.pillars.sales} />
          <Pillar label="Fulfilment" active={org.pillars.fulfilment} />
          <Pillar label="Finance" active={org.pillars.finance} />
        </div>
      </div>
    </section>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Building2;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5 text-muted-foreground/70" />
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Pillar({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-foreground"
          : "inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-2.5 py-1 text-[12px] font-medium text-muted-foreground"
      }
    >
      <span
        className={
          active
            ? "size-1.5 rounded-full bg-primary"
            : "size-1.5 rounded-full bg-muted-foreground/40"
        }
      />
      {label}
    </span>
  );
}

function McpTokenField({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  if (!token) {
    return <span className="text-muted-foreground italic">Not minted yet</span>;
  }

  const t = token;
  const masked = `${t.slice(0, 10)}${"•".repeat(12)}${t.slice(-4)}`;
  const display = revealed ? t : masked;

  async function copy() {
    await navigator.clipboard.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded bg-input/40 px-2 py-1 font-mono text-[11.5px] text-foreground">
        {display}
      </code>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        {revealed ? "Hide" : "Show"}
      </button>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        {copied ? (
          <>
            <Check className="size-3 text-primary" /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3" /> Copy
          </>
        )}
      </button>
    </div>
  );
}
