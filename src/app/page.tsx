import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardStats } from "@/components/dashboard/stats";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

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

// ────────────────────────── Mock data (sample) ─────────────────────────

const marketingTrafficSpark = [4200, 4500, 4900, 5100, 5500, 5300, 5900, 6200, 6500, 7100, 7800, 8400];
const salesFunnel = [
  { label: "Leads", value: 2840, percent: 100 },
  { label: "Qualified", value: 1120, percent: 39 },
  { label: "Proposal", value: 420, percent: 15 },
  { label: "Won", value: 148, percent: 5 },
];
const fulfilmentByRegion = [
  { region: "North", orders: 205 },
  { region: "South", orders: 174 },
  { region: "East", orders: 234 },
  { region: "West", orders: 182 },
];
const financeMonthly = [
  { month: "Jul", revenue: 48, expenses: 30 },
  { month: "Aug", revenue: 53, expenses: 33 },
  { month: "Sep", revenue: 58, expenses: 35 },
  { month: "Oct", revenue: 62, expenses: 36 },
  { month: "Nov", revenue: 70, expenses: 41 },
  { month: "Dec", revenue: 78, expenses: 44 },
  { month: "Jan", revenue: 80, expenses: 46 },
  { month: "Feb", revenue: 84, expenses: 48 },
  { month: "Mar", revenue: 89, expenses: 51 },
  { month: "Apr", revenue: 92, expenses: 52 },
  { month: "May", revenue: 96, expenses: 55 },
  { month: "Jun", revenue: 102, expenses: 58 },
];

// ────────────────────────── Building blocks ────────────────────────────

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
    <Card className="relative overflow-hidden border-border bg-card/40 backdrop-blur-sm transition-all hover:border-primary/30 hover:shadow-[0_0_32px_rgba(12,191,106,.06)]">
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
              <span
                className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary"
                title="Sample data until your integrations are connected"
              >
                Demo
              </span>
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

// Pure-SVG sparkline. Renders a smooth path + area fill.
function Sparkline({ values, height = 60, color = COLOR_PRIMARY }: { values: number[]; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const w = 320;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - ((v - min) / range) * (height - 8) - 4]);
  const path = points.reduce(
    (acc, [x, y], i) => acc + (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`),
    "",
  );
  const area = `${path} L ${w} ${height} L 0 ${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkFill)" />
      <path d={path} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Horizontal bar with explicit label + value. Each bar is sized
// proportional to the max value in the dataset.
function HBar({ label, value, max, suffix = "" }: { label: string; value: number; max: number; suffix?: string }) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">
          {value.toLocaleString()}
          {suffix}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Two-series bar (revenue vs expenses per period). Tiny + readable.
function StackedMonthlyBars({ data }: { data: typeof financeMonthly }) {
  const max = Math.max(...data.map((d) => d.revenue));
  return (
    <div className="grid grid-cols-12 gap-1.5">
      {data.map((d) => (
        <div key={d.month} className="flex flex-col items-center gap-1">
          <div className="flex h-24 w-full items-end gap-0.5">
            <div
              className="flex-1 rounded-t-sm bg-primary"
              style={{ height: `${(d.revenue / max) * 100}%` }}
              title={`${d.month}: $${d.revenue}K revenue`}
            />
            <div
              className="flex-1 rounded-t-sm bg-muted"
              style={{ height: `${(d.expenses / max) * 100}%` }}
              title={`${d.month}: $${d.expenses}K expenses`}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{d.month}</span>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────── Page ──────────────────────────────────────

export default async function DashboardPage() {
  // First-run gate: if this org's owner hasn't completed onboarding yet,
  // bounce them to /onboarding. Admins impersonating an org skip this
  // (they can pre-walk a not-yet-onboarded client). Skip also if the
  // owner already approved a brand profile manually (seeded via API).
  const ctx = await getOrgContext();
  if (ctx?.activeOrgId && !ctx.isImpersonating) {
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
            subtitle="Traffic this quarter"
            kpi={{ value: "8.4K", delta: "+12.3% vs prev", positive: true }}
          >
            <Sparkline values={marketingTrafficSpark} />
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-muted/30 p-2.5">
                <div className="font-serif text-lg text-foreground">312</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Leads / wk
                </div>
              </div>
              <div className="rounded-md bg-muted/30 p-2.5">
                <div className="font-serif text-lg text-foreground">$24</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  CAC
                </div>
              </div>
              <div className="rounded-md bg-muted/30 p-2.5">
                <div className="font-serif text-lg text-foreground">2.4%</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Conv
                </div>
              </div>
            </div>
          </PillarCard>
        )}

        {pillars.sales && (
          <PillarCard
            title="Sales"
            subtitle="Pipeline this quarter"
            kpi={{ value: "5.2%", delta: "lead → won rate", positive: true }}
          >
            <div className="space-y-3">
              {salesFunnel.map((stage) => (
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
          </PillarCard>
        )}

        {pillars.fulfilment && (
          <PillarCard
            title="Fulfilment"
            subtitle="Orders by region this week"
            kpi={{ value: "847", delta: "+5.1% vs prev", positive: true }}
          >
            <div className="space-y-3">
              {fulfilmentByRegion.map((r) => (
                <HBar
                  key={r.region}
                  label={r.region}
                  value={r.orders}
                  max={Math.max(...fulfilmentByRegion.map((x) => x.orders))}
                  suffix=" orders"
                />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-md bg-muted/30 p-2.5">
                <div className="font-serif text-lg text-foreground">94%</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  On-time
                </div>
              </div>
              <div className="rounded-md bg-muted/30 p-2.5">
                <div className="font-serif text-lg text-foreground">2.1d</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Avg cycle
                </div>
              </div>
            </div>
          </PillarCard>
        )}

        {pillars.finance && (
          <PillarCard
            title="Finance"
            subtitle="Revenue vs expenses, last 12 months ($K)"
            kpi={{ value: "$38.2K", delta: "net profit / mo", positive: true }}
          >
            <StackedMonthlyBars data={financeMonthly} />
            <div className="mt-4 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-sm bg-primary" /> Revenue
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-sm bg-muted" /> Expenses
              </div>
              <div className="text-muted-foreground">
                Margin: <span className="font-mono text-primary">42%</span>
              </div>
            </div>
          </PillarCard>
        )}
      </div>
    </PageShell>
  );
}
