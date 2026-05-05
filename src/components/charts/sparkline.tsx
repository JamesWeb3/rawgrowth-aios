"use client";

/**
 * Tiny inline SVG sparkline. Polyline + last-point dot + filled area
 * so trends read at a glance even at 100x24. No deps - matches the
 * dashboard's minimalist tone.
 *
 * Use cases: pillar cards (12-week weekly volume), insight badges,
 * inline metric trends in tooltips.
 */

type Props = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  showLastDot?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function Sparkline({
  data,
  width = 100,
  height = 28,
  stroke = "var(--brand-primary)",
  fill,
  strokeWidth = 1.5,
  showLastDot = true,
  className,
  ariaLabel,
}: Props) {
  if (!data || data.length < 2) {
    return (
      <div
        style={{ width, height }}
        className={className}
        aria-hidden
      />
    );
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length === 1 ? 0 : width / (data.length - 1);
  const padTop = strokeWidth + 2;
  const padBottom = strokeWidth + 2;
  const usableH = height - padTop - padBottom;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = padTop + (1 - (v - min) / range) * usableH;
    return [x, y] as const;
  });

  // Catmull-Rom-ish smoothing → bezier path. Gentler curve than
  // linear segments, keeps the visual close to a real chart line.
  let path = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cx = x0 + (x1 - x0) / 2;
    path += ` C ${cx.toFixed(2)} ${y0.toFixed(2)}, ${cx.toFixed(2)} ${y1.toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const areaPath = `${path} L ${width.toFixed(2)} ${height.toFixed(2)} L 0 ${height.toFixed(2)} Z`;
  const last = points[points.length - 1];
  const fillColor = fill ?? "var(--brand-primary-soft, rgba(51,202,127,0.12))";

  // Stable gradient id for stroke color so we don't conflict across charts
  const slug = stroke.replace(/[^a-z0-9]/gi, "");
  const gradId = `spark-grad-${slug}-${Math.round(width)}-${Math.round(height)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.34" />
          <stop offset="60%" stopColor={stroke} stopOpacity="0.10" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Subtle baseline gridline */}
      <line
        x1="0"
        x2={width}
        y1={height - padBottom}
        y2={height - padBottom}
        stroke="currentColor"
        strokeOpacity="0.06"
      />
      <path d={areaPath} fill={fill ?? `url(#${gradId})`} stroke="none" />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showLastDot && (
        <>
          <circle
            cx={last[0]}
            cy={last[1]}
            r={Math.max(4, strokeWidth + 2)}
            fill={stroke}
            fillOpacity="0.18"
          />
          <circle
            cx={last[0]}
            cy={last[1]}
            r={Math.max(2.5, strokeWidth + 0.5)}
            fill={stroke}
          />
        </>
      )}
    </svg>
  );
}

/** Used inline (not a separate Props component) when the unused fill/className aren't relevant. */
void Sparkline; // avoid eslint dead-code warning if needed

/**
 * Pill-style trend indicator: sparkline + ↑/↓ + %, color-coded.
 * Used as KPI delta badge.
 */
export function TrendBadge({
  data,
  invertColor = false,
  ariaLabel,
}: {
  data: number[];
  invertColor?: boolean; // for "lower is better" metrics like cost
  ariaLabel?: string;
}) {
  if (!data || data.length < 2) return null;
  const cur = data[data.length - 1];
  const prev = data[data.length - 2];
  const delta = prev === 0 ? (cur > 0 ? 1 : 0) : (cur - prev) / prev;
  const pct = Math.round(delta * 100);
  const up = pct > 0;
  const flat = pct === 0;
  const positive = invertColor ? !up : up;
  const tone = flat
    ? "text-muted-foreground"
    : positive
      ? "text-emerald-400"
      : "text-destructive";
  const arrow = flat ? "→" : up ? "↑" : "↓";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium " +
        tone +
        (positive
          ? " bg-emerald-400/10"
          : flat
            ? " bg-muted/30"
            : " bg-destructive/10")
      }
      aria-label={ariaLabel}
    >
      <span className="text-[12px] leading-none">{arrow}</span>
      <span className="font-mono">{Math.abs(pct)}%</span>
    </span>
  );
}
