import Link from "next/link";
import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import {
  getCalendarBinding,
  listBookings,
  listEventTypes,
} from "@/lib/booking/queries";

export const dynamic = "force-dynamic";

export default async function BookingHomePage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

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
        <div className="mb-6 rounded-md border border-amber-400/30 bg-amber-400/5 p-4 text-sm">
          <p className="font-medium text-amber-300">
            No Google Calendar bound yet
          </p>
          <p className="mt-1 text-muted-foreground">
            Connect Google Calendar in <Link href="/connections" className="underline">Connections</Link>,
            then{" "}
            <Link href="/booking/calendar" className="underline">
              pick which calendar
            </Link>{" "}
            to write bookings into.
          </p>
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
