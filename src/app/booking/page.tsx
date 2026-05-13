import Link from "next/link";
import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  getCalendarBinding,
  listBookings,
  listEventTypes,
  setCalendarBinding,
} from "@/lib/booking/queries";

export const dynamic = "force-dynamic";

/**
 * Chris's bug 6 (2026-05-12): operator authorised Google Calendar in
 * /connections but /booking still shows the "Connect Google Calendar"
 * amber banner. Root cause: the OAuth flow writes a row to
 * rgaios_connections (provider_config_key=composio:google-calendar)
 * but never touches rgaios_kalendly_calendar_bindings, which is what
 * /booking actually reads.
 *
 * Fix: when the org has a connected Composio google-calendar row and
 * no binding yet, auto-create a binding to the user's primary
 * calendar. Operator can change which calendar on /booking/calendar
 * later. This converts the 2-step flow (OAuth → bind) into a 1-step
 * flow (OAuth → done) for the common case.
 */
async function maybeAutoBindCalendar(orgId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("rgaios_connections")
    .select("status")
    .eq("organization_id", orgId)
    .eq("provider_config_key", "composio:google-calendar")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  if (!data) return;
  try {
    await setCalendarBinding(orgId, {
      calendarId: "primary",
      calendarSummary: "Primary calendar",
      defaultTimezone: "UTC",
    });
  } catch {
    // setCalendarBinding throws on FK / RLS issues. Skip silently;
    // operator can finish via /booking/calendar manually.
  }
}

export default async function BookingHomePage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  // Auto-bind FIRST so the binding shows up in the parallel fetch below.
  const existingBinding = await getCalendarBinding(ctx.activeOrgId);
  if (!existingBinding) {
    await maybeAutoBindCalendar(ctx.activeOrgId);
  }

  const [eventTypes, bookings, binding] = await Promise.all([
    listEventTypes(ctx.activeOrgId),
    listBookings(ctx.activeOrgId, { limit: 5 }),
    getCalendarBinding(ctx.activeOrgId),
  ]);

  const upcomingCount = bookings.filter((b) => b.status === "confirmed").length;

  return (
    <PageShell
      title="Booking"
      description="Public booking pages backed by your Google Calendar. Pin event types to agents so the right department gets pinged when a guest grabs a slot."
      actions={
        <Link
          href="/booking/event-types/new"
          className="inline-flex h-7 items-center rounded-[min(var(--radius-md),12px)] bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground hover:bg-primary/80"
        >
          + New event type
        </Link>
      }
    >
      {!binding && (
        <div className="mb-6 flex items-start gap-4 rounded-md border border-amber-400/30 bg-amber-400/5 p-4 text-sm">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-400/15 text-amber-300">
            <span className="text-[15px]">!</span>
          </div>
          <div className="flex-1">
            <p className="font-medium text-amber-300">
              Connect Google Calendar to start taking bookings
            </p>
            <p className="mt-1 text-muted-foreground">
              Two steps: (1) authorise Google in{" "}
              <Link href="/connections" className="underline hover:text-foreground">
                Connections
              </Link>
              , (2){" "}
              <Link href="/booking/calendar" className="underline hover:text-foreground">
                pick which calendar
              </Link>{" "}
              bookings should land in.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Event types" value={eventTypes.length} href="/booking/event-types" />
        <StatCard label="Upcoming bookings" value={upcomingCount} href="/booking/bookings" />
        <StatCard
          label="Calendar"
          value={binding ? binding.calendarSummary : "Not connected"}
          href="/booking/calendar"
        />
      </div>

      <div className="mt-8">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-[1.5px] text-muted-foreground">
          Recent bookings
        </h3>
        {bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bookings yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {bookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <div className="font-medium">{b.guestName}</div>
                  <div className="text-xs text-muted-foreground">
                    {b.eventTypeSlug} - {b.startUtc.toISOString()}
                  </div>
                </div>
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide " +
                    (b.status === "confirmed"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {b.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-md border border-border bg-card p-4 transition hover:border-primary/40"
    >
      <div className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-serif text-2xl tracking-tight group-hover:text-primary">
        {value}
      </div>
    </Link>
  );
}
