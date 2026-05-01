import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { listBookings } from "@/lib/booking/queries";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const bookings = await listBookings(ctx.activeOrgId, { limit: 200 });

  return (
    <PageShell title="Bookings" description="All confirmed, cancelled, and rescheduled bookings.">
      {bookings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
          <CalendarRange className="mx-auto size-9 text-primary/70" strokeWidth={1.4} />
          <h3 className="mt-4 font-serif text-xl tracking-tight text-foreground">
            No bookings yet
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Confirmed slots from your public booking pages land here, with the
            guest's contact info, the agent that was pinged, and the Meet link.
          </p>
          <Link
            href="/booking/event-types"
            className="mt-5 inline-flex h-8 items-center rounded-[min(var(--radius-md),12px)] border border-border px-3 text-sm hover:border-primary/40"
          >
            See event types
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-[1.5px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Guest</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">When (UTC)</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Meet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{b.guestName}</div>
                    <div className="text-xs text-muted-foreground">{b.guestEmail}</div>
                  </td>
                  <td className="px-3 py-2">{b.eventTypeSlug}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {b.startUtc.toISOString().replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-[10px] uppercase " +
                        (b.status === "confirmed"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground")
                      }
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {b.meetLink ? (
                      <a
                        href={b.meetLink}
                        className="text-primary hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        join
                      </a>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
