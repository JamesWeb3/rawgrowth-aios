"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Calendar = { id: string; summary: string; primary: boolean };

const browserTimezone = (): string => {
  if (typeof Intl === "undefined") return "UTC";
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
};

export function CalendarBindingForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [calendarSummary, setCalendarSummary] = useState("");
  const [defaultTimezone, setDefaultTimezone] = useState("UTC");
  const [saving, setSaving] = useState(false);
  const [browserTz, setBrowserTz] = useState<string | null>(null);
  // Read TZ on mount so SSR ("UTC") doesn't mismatch client hydration.
  // The set is intentionally one-shot on mount, not a cascading effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBrowserTz(browserTimezone()); }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/booking/calendar");
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Load failed");
          return;
        }
        // Surface listError so user sees actual Composio failure
        // (e.g. token expired, scope missing) instead of generic
        // "not connected" when calendars empty for a real error.
        if (data.listError) {
          setError(`Calendar list failed: ${data.listError}`);
        }
        setCalendars(data.calendars ?? []);
        if (data.binding) {
          setCalendarId(data.binding.calendarId);
          setCalendarSummary(data.binding.calendarSummary);
          setDefaultTimezone(data.binding.defaultTimezone);
        } else if (data.calendars?.length) {
          const primary = data.calendars.find((c: Calendar) => c.primary) ?? data.calendars[0];
          setCalendarId(primary.id);
          setCalendarSummary(primary.summary);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/booking/calendar", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendarId, calendarSummary, defaultTimezone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(typeof data?.error === "string" ? data.error : "Save failed");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-300">
          {error}
        </div>
      )}

      {calendars.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/30 p-6 text-center">
          <p className="text-sm font-medium text-foreground">
            Google Calendar not connected
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Authorise Google Calendar first - we use the OAuth grant from{" "}
            <a href="/connections" className="text-primary hover:underline">
              Connections
            </a>
            . Once connected, this page will list your calendars.
          </p>
          <a
            href="/connections"
            className="mt-3 inline-flex h-7 items-center rounded-[min(var(--radius-md),12px)] bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground hover:bg-primary/80"
          >
            Open Connections
          </a>
        </div>
      ) : (
        <div>
          <Label className="mb-2 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
            Calendar to write bookings into
          </Label>
          <select
            value={calendarId}
            onChange={(e) => {
              const cal = calendars.find((c) => c.id === e.target.value);
              setCalendarId(e.target.value);
              if (cal) setCalendarSummary(cal.summary);
            }}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? " (primary)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <Label className="mb-2 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
          Default timezone
        </Label>
        <Input
          value={defaultTimezone}
          onChange={(e) => setDefaultTimezone(e.target.value)}
          placeholder="America/Sao_Paulo"
        />
        {browserTz && browserTz !== defaultTimezone && (
          <button
            type="button"
            onClick={() => setDefaultTimezone(browserTz)}
            className="mt-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/25"
          >
            Use {browserTz}
          </button>
        )}
      </div>

      <Button onClick={onSave} disabled={saving || !calendarId}>
        {saving ? "Saving..." : "Save binding"}
      </Button>
    </div>
  );
}
