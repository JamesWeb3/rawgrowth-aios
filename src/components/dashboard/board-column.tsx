import type { ReactNode } from "react";

import { Sparkline, TrendBadge } from "@/components/charts/sparkline";

/**
 * BoardColumn - one vertical column on the dept-board dashboard.
 *
 * Layout matches Chris's whiteboard sketch (May 4, /tmp/chris-board-sketch.png):
 *
 *   ┌─ DEPT NAME ─┐
 *   │  CHART       │   ← top hero card (sparkline + value + delta)
 *   ├──────────────┤
 *   │  card        │   ← stacked metric cards
 *   ├──────────────┤
 *   │  card        │
 *   └──────────────┘
 *
 * Goal: "not complicated, easy to generate ROI" (per Chris).
 * Each card answers ONE question. No nested grids, no ambiguous labels.
 */

export type ColumnHeroChart = {
  values: number[];
  current: number | string;
  caption: string;
  invertColor?: boolean;
};

export type ColumnMetricCard = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
};

export function BoardColumn({
  title,
  accent = "var(--brand-primary)",
  hero,
  cards,
  empty,
  footerCta,
  href,
}: {
  title: string;
  accent?: string;
  hero?: ColumnHeroChart;
  cards?: ColumnMetricCard[];
  empty?: ReactNode;
  footerCta?: ReactNode;
  href?: string;
}) {
  return (
    <article
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card/40 backdrop-blur-sm transition-all duration-200 hover:border-border hover:bg-card/60"
      style={{ minHeight: 380 }}
    >
      {/* Column header with accent dot */}
      <header className="border-b border-border/60 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="size-1.5 rounded-full"
              style={{ background: accent }}
            />
            <h3 className="text-[11px] font-semibold uppercase tracking-[1.5px] text-foreground">
              {title}
            </h3>
          </div>
          {href && (
            <a
              href={href}
              className="text-[10px] font-medium text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              open →
            </a>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-2 p-2.5">
        {hero && (
          <div
            className="relative overflow-hidden rounded-lg border border-border/60 bg-card/70 p-3.5"
            style={{
              background: `linear-gradient(180deg, ${accent}14 0%, transparent 75%)`,
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <span
                  className="font-serif text-[30px] leading-none tracking-tight text-foreground"
                >
                  {hero.current}
                </span>
              </div>
              <TrendBadge
                data={hero.values}
                invertColor={hero.invertColor}
                ariaLabel={`${title} delta`}
              />
            </div>
            <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
              {hero.caption}
            </p>
            <div className="relative mt-3">
              <Sparkline
                data={hero.values}
                width={220}
                height={108}
                stroke={accent}
                strokeWidth={2}
                className="w-full"
                ariaLabel={`${title} trend`}
              />
              {/* min/max pin labels */}
              <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex flex-col justify-between text-[9px] font-mono text-muted-foreground/50">
                <span className="leading-none">{Math.max(...hero.values).toLocaleString()}</span>
                <span className="leading-none">{Math.min(...hero.values).toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        {cards && cards.length > 0 ? (
          cards.map((c, i) => (
            <div
              key={i}
              className="rounded-md border border-border/60 bg-card/30 px-3 py-2.5"
            >
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {c.label}
              </p>
              <p
                className={
                  "mt-1 font-mono text-[15px] " +
                  (c.tone === "good"
                    ? "text-emerald-400"
                    : c.tone === "warn"
                      ? "text-amber-300"
                      : c.tone === "bad"
                        ? "text-destructive"
                        : "text-foreground")
                }
              >
                {c.value}
              </p>
              {c.hint && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {c.hint}
                </p>
              )}
            </div>
          ))
        ) : null}

        {!hero && (!cards || cards.length === 0) && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border/60 bg-card/20 px-3 py-6 text-center">
            <div>
              <p className="text-[11px] font-medium text-foreground">
                {empty ?? "No data yet"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Wire data → cards light up.
              </p>
            </div>
          </div>
        )}

        {footerCta && (
          <div className="mt-auto pt-1">{footerCta}</div>
        )}
      </div>
    </article>
  );
}
