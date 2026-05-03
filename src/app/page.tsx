import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardStats } from "@/components/dashboard/stats";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getPillarData } from "@/lib/dashboard/pillar-data";

export const dynamic = "force-dynamic";

async function getPillarFlags() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return { marketing: false, sales: false, fulfilment: false, finance: false };
  }
  const { data } = await supabaseAdmin()
    .from("rgaios_organizations")
    .select("marketing, sales, fulfilment, finance")
    .eq("id", ctx.activeOrgId)
    .maybeSingle();
  return {
    marketing: data?.marketing ?? false,
    sales: data?.sales ?? false,
    fulfilment: data?.fulfilment ?? false,
    finance: data?.finance ?? false,
  };
}

const COLOR_PRIMARY = "#0cbf6a";

// ────────────────────────── Pillar data ────────────────────────────────
// Real data lands via getPillarData(orgId). When the org has zero rows
// for a pillar (fresh client, nothing happened yet), the helper returns
// null and the card renders an empty state instead of fake numbers.

// ────────────────────────── Building blocks ────────────────────────────

function EmptyPillar({ line1, line2 }: { line1: string; line2: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/10 p-6 text-center">
      <p className="text-[12px] font-medium text-foreground">{line1}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {line2}
      </p>
    </div>
  );
}

function PillarCard({
  title,
  subtitle,
  kpi,
  accent = "#0cbf6a",
  children,
}: {
  title: string;
  subtitle: string;
  kpi?: { value: string; delta?: string; positive?: boolean };
  accent?: string;
  children: ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden border-border bg-card/40 backdrop-blur-sm transition-[border-color] duration-200 hover:border-primary/40">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <CardContent className="p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="size-1.5 rounded-full"
                style={{ background: accent }}
                aria-hidden
              />
              <h3 className="text-[12px] font-semibold uppercase tracking-[1.8px] text-foreground">
                {title}
              </h3>
            </div>
            <p className="mt-1.5 text-[12px] text-muted-foreground">{subtitle}</p>
          </div>
          {kpi && (
            <div className="text-right">
              <div className="font-serif text-[34px] leading-none tracking-tight text-foreground">
                {kpi.value}
              </div>
              {kpi.delta && (
                <div
                  className={
                    "mt-1.5 flex items-center justify-end gap-0.5 text-[11px] font-medium " +
                    (kpi.positive ? "text-primary" : "text-amber-300")
                  }
                >
                  {kpi.positive ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                  {kpi.delta}
                </div>
              )}
            </div>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

// Pure-SVG sparkline. Smooth area + grid baseline + endpoint dot +
// optional last-value annotation pinned to the right edge.
function Sparkline({
  values,
  height = 80,
  color = COLOR_PRIMARY,
}: {
  values: number[];
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return null;
  const w = 320;
  const padX = 6;
  const padY = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (w - padX * 2) / (values.length - 1);
  const yFor = (v: number) =>
    height - padY - ((v - min) / range) * (height - padY * 2);
  const points = values.map((v, i) => [padX + i * step, yFor(v)]);

  // Catmull-Rom-ish smoothing → bezier path. Keeps line gentle without
  // wandering away from datapoints.
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cx = x0 + (x1 - x0) / 2;
    path += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  const area = `${path} L ${points[points.length - 1][0]} ${height} L ${points[0][0]} ${height} Z`;
  const lastX = points[points.length - 1][0];
  const lastY = points[points.length - 1][1];
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      className="w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.42" />
          <stop offset="55%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* baseline grid */}
      <line
        x1={padX}
        x2={w - padX}
        y1={height - padY}
        y2={height - padY}
        stroke="currentColor"
        strokeOpacity="0.06"
      />
      <line
        x1={padX}
        x2={w - padX}
        y1={padY + (height - padY * 2) / 2}
        y2={padY + (height - padY * 2) / 2}
        stroke="currentColor"
        strokeOpacity="0.04"
        strokeDasharray="2 4"
      />
      <path d={area} fill={`url(#${id})`} />
      <path
        d={path}
        stroke={color}
        strokeWidth={1.75}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* endpoint glow + dot */}
      <circle cx={lastX} cy={lastY} r={6} fill={color} fillOpacity="0.18" />
      <circle cx={lastX} cy={lastY} r={3} fill={color} />
    </svg>
  );
}

// Horizontal bar with value baked inside the fill (or alongside if
// the bar is too short). Smooth gradient fill, subtle bg, monospace
// value + label spacing tightened.
function HBar({
  label,
  value,
  max,
  suffix = "",
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
}) {
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  const inside = pct > 18;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="truncate text-muted-foreground">{label}</span>
      </div>
      <div className="relative h-6 w-full overflow-hidden rounded-md bg-muted/25">
        <div
          className="h-full rounded-md bg-gradient-to-r from-primary/85 to-primary"
          style={{ width: `${pct}%` }}
        />
        <span
          className={
            "pointer-events-none absolute top-1/2 -translate-y-1/2 font-mono text-[11px] " +
            (inside
              ? "right-2 text-primary-foreground"
              : "left-[calc(var(--pct)+0.5rem)] text-muted-foreground")
          }
          style={{ "--pct": `${pct}%` } as React.CSSProperties}
        >
          {value.toLocaleString()}
          {suffix}
        </span>
      </div>
    </div>
  );
}

// Two-series bar (revenue vs expenses per period). Reasonable height,
// rounded tops, hover ring, total annotation on the bar that just
// finished.
function StackedMonthlyBars({
  data,
}: {
  data: Array<{ month: string; revenue: number; expenses: number }>;
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, d.expenses)));
  const lastIdx = data.length - 1;
  return (
    <div className="grid grid-cols-12 gap-2">
      {data.map((d, i) => {
        const isLast = i === lastIdx;
        const total = d.revenue - d.expenses;
        return (
          <div
            key={`${d.month}-${i}`}
            className="group flex flex-col items-center gap-1.5"
          >
            <div className="relative flex h-32 w-full items-end gap-1">
              <div
                className="flex-1 rounded-t-md bg-gradient-to-t from-primary/55 to-primary transition-opacity duration-150 group-hover:opacity-100"
                style={{ height: `${(d.revenue / max) * 100}%` }}
                title={`${d.month}: ${d.revenue} succeeded`}
              />
              <div
                className="flex-1 rounded-t-md bg-gradient-to-t from-muted/40 to-muted/70 transition-opacity duration-150 group-hover:opacity-100"
                style={{ height: `${(d.expenses / max) * 100}%` }}
                title={`${d.month}: ${d.expenses} failed`}
              />
              {isLast && (d.revenue > 0 || d.expenses > 0) && (
                <span
                  className={
                    "pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[10px] " +
                    (total >= 0 ? "text-primary" : "text-amber-300")
                  }
                >
                  {total >= 0 ? "+" : ""}
                  {total}
                </span>
              )}
            </div>
            <span
              className={
                "text-[10px] " +
                (isLast ? "font-medium text-foreground" : "text-muted-foreground")
              }
            >
              {d.month}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────── Page ──────────────────────────────────────

export default async function DashboardPage() {
  // First-run gate: only bounce CLIENT owners (not admins) to /onboarding.
  // Admin orgs (rawgrowth-mvp) and admin impersonation never trigger
  // the gate. Client owners get redirected unless onboarding_completed
  // OR a brand profile is already approved (e.g. demo seed).
  const ctx = await getOrgContext();
  if (ctx?.activeOrgId && !ctx.isAdmin) {
    const { data: org } = await supabaseAdmin()
      .from("rgaios_organizations")
      .select("onboarding_completed")
      .eq("id", ctx.activeOrgId)
      .maybeSingle();
    if (!(org as { onboarding_completed?: boolean } | null)?.onboarding_completed) {
      const { data: brand } = await supabaseAdmin()
        .from("rgaios_brand_profiles")
        .select("id")
        .eq("organization_id", ctx.activeOrgId)
        .eq("status", "approved")
        .limit(1)
        .maybeSingle();
      if (!brand) redirect("/onboarding");
    }
  }

  const pillars = await getPillarFlags();
  const anyPillarOn =
    pillars.marketing || pillars.sales || pillars.fulfilment || pillars.finance;
  const pillarData = ctx?.activeOrgId
    ? await getPillarData(ctx.activeOrgId)
    : { marketing: null, sales: null, fulfilment: null, finance: null };
  return (
    <PageShell
      title="Dashboard"
      description="Your AI company at a glance  -  goals, agents, tickets, spend."
    >
      <DashboardStats />

      {!anyPillarOn && (
        <Card className="border-border border-dashed bg-card/30">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground">
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 3v18h18" />
                <path d="M7 16l4-4 4 2 4-6" />
              </svg>
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-foreground">
                No pillars wired yet
              </h3>
              <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                Each department chart lights up once its data source is
                connected. Enable Marketing, Sales, Fulfilment or Finance
                in Company settings to start tracking pillars.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {pillars.marketing && (
          <PillarCard
            title="Marketing"
            subtitle="Agent activity, last 12 weeks"
            kpi={
              pillarData.marketing
                ? {
                    value: String(
                      pillarData.marketing.weekly.reduce(
                        (s, v) => s + v,
                        0,
                      ),
                    ),
                    delta: `${pillarData.marketing.pctChange >= 0 ? "+" : ""}${pillarData.marketing.pctChange.toFixed(1)}% vs prev wk`,
                    positive: pillarData.marketing.pctChange >= 0,
                  }
                : undefined
            }
          >
            {pillarData.marketing ? (
              <>
                <Sparkline values={pillarData.marketing.weekly} />
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-md bg-muted/30 p-2.5">
                    <div className="font-serif text-lg text-foreground">
                      {pillarData.marketing.totalThisWeek}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      This wk
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2.5">
                    <div className="font-serif text-lg text-foreground">
                      {pillarData.marketing.prevWeek}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Prev wk
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2.5">
                    <div className="font-serif text-lg text-foreground">
                      {Math.round(
                        pillarData.marketing.weekly.reduce(
                          (s, v) => s + v,
                          0,
                        ) / 12,
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Avg/wk
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <EmptyPillar
                line1="No marketing activity yet"
                line2="Chat with the Marketing Manager or fire a marketing routine to start populating this chart."
              />
            )}
          </PillarCard>
        )}

        {pillars.sales && (
          <PillarCard
            title="Sales"
            subtitle="Pipeline funnel, last 30 days"
            kpi={
              pillarData.sales
                ? {
                    value: `${pillarData.sales.conversion}%`,
                    delta: "lead → won rate",
                    positive: pillarData.sales.conversion >= 0,
                  }
                : undefined
            }
          >
            {pillarData.sales ? (
              <div className="space-y-3">
                {pillarData.sales.funnel.map((stage) => (
                  <div key={stage.label}>
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="text-muted-foreground">{stage.label}</span>
                      <span className="font-mono text-foreground">
                        {stage.value.toLocaleString()}{" "}
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          ({stage.percent}%)
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted/30">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${stage.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPillar
                line1="No sales runs yet"
                line2="Hire an SDR / Sales Manager and assign a routine to start tracking the funnel."
              />
            )}
          </PillarCard>
        )}

        {pillars.fulfilment && (
          <PillarCard
            title="Fulfilment"
            subtitle="Runs by ops/general agent, last 7 days"
            kpi={
              pillarData.fulfilment
                ? {
                    value: String(pillarData.fulfilment.totalThisWeek),
                    delta: "tasks executed",
                    positive: pillarData.fulfilment.totalThisWeek > 0,
                  }
                : undefined
            }
          >
            {pillarData.fulfilment ? (
              <div className="space-y-3">
                {pillarData.fulfilment.byAgent.map((r) => (
                  <HBar
                    key={r.region}
                    label={r.region}
                    value={r.orders}
                    max={Math.max(
                      ...pillarData.fulfilment!.byAgent.map((x) => x.orders),
                    )}
                    suffix=" runs"
                  />
                ))}
              </div>
            ) : (
              <EmptyPillar
                line1="No fulfilment runs yet"
                line2="Assign routines to your Operations Manager or Project Coordinator. Each run lands here."
              />
            )}
          </PillarCard>
        )}

        {pillars.finance && (
          <PillarCard
            title="Finance"
            subtitle="Routine runs (succeeded vs failed) - last 12 months"
            kpi={
              pillarData.finance
                ? {
                    value: String(pillarData.finance.netThisMonth),
                    delta: "net runs this month",
                    positive: pillarData.finance.netThisMonth >= 0,
                  }
                : undefined
            }
          >
            {pillarData.finance ? (
              <>
                <StackedMonthlyBars data={pillarData.finance.monthly} />
                <div className="mt-4 flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-sm bg-primary" /> Succeeded
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-sm bg-muted" /> Failed
                  </div>
                  <div className="text-muted-foreground">
                    Success rate:{" "}
                    <span className="font-mono text-primary">
                      {pillarData.finance.marginPct}%
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <EmptyPillar
                line1="No routine runs yet"
                line2="Once routines start firing, monthly success/fail counts populate this chart."
              />
            )}
          </PillarCard>
        )}
      </div>
    </PageShell>
  );
}
