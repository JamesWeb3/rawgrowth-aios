"use client";

import { useEffect, useState } from "react";

/**
 * Renders a date-time formatted via the browser locale, deferring the
 * format() call to a `useEffect` so server-rendered HTML and the first
 * client render agree (both empty). Without this guard, Node + the
 * browser pick different locales/timezones for `toLocaleString()` and
 * React throws hydration mismatch (#418) on every page that prints a
 * timestamp.
 *
 * `mode` picks one of three preset formatters. `iso` is required so
 * the component is pure server input -> client formatted output.
 */
type Mode = "datetime" | "date" | "time";

const FORMATTERS: Record<Mode, (d: Date) => string> = {
  datetime: (d) => d.toLocaleString(),
  date: (d) =>
    d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  time: (d) => d.toLocaleTimeString(),
};

export function ClientTime({
  iso,
  mode = "datetime",
  fallback = "",
  className,
}: {
  iso: string | null | undefined;
  mode?: Mode;
  fallback?: string;
  className?: string;
}) {
  const [text, setText] = useState<string>(fallback);

  useEffect(() => {
    if (!iso) {
      setText(fallback);
      return;
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      setText(fallback);
      return;
    }
    setText(FORMATTERS[mode](d));
  }, [iso, mode, fallback]);

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}
