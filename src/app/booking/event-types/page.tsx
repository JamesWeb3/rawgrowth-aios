import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { listEventTypes } from "@/lib/booking/queries";

export const dynamic = "force-dynamic";

export default async function BookingEventTypesPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const eventTypes = await listEventTypes(ctx.activeOrgId);

  return (
    <PageShell
      title="Event types"
      description="Slot definitions guests can book against."
      actions={
        <Link
          href="/booking/event-types/new"
          className="inline-flex h-7 items-center rounded-[min(var(--radius-md),12px)] bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground hover:bg-primary/80"
        >
          + New
        </Link>
      }
    >
      {eventTypes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
          <CalendarPlus className="mx-auto size-9 text-primary/70" strokeWidth={1.4} />
          <h3 className="mt-4 font-serif text-xl tracking-tight text-foreground">
            No event types yet
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            An event type is a bookable slot definition (e.g. "30-min discovery
            call"). Each one becomes a public link guests can grab time on.
            Pin one to an agent and the agent gets a system message on every
            confirmed booking.
          </p>
          <Link
            href="/booking/event-types/new"
            className="mt-5 inline-flex h-8 items-center rounded-[min(var(--radius-md),12px)] bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            Create first event type
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {eventTypes.map((e) => (
            <li
              key={e.id}
              className="rounded-md border border-border bg-card p-4 transition hover:border-primary/40"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{e.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    /{e.slug} - {e.durationMinutes} min - {e.location.type.replace("_", " ")}
                  </div>
                </div>
                <Link
                  href={`/booking/event-types/${e.id}`}
                  className="text-xs text-primary hover:underline"
                >
                  Edit
                </Link>
              </div>
              {e.description && (
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {e.description}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2 text-[11px]">
                <span
                  className={
                    "rounded-full px-2 py-0.5 " +
                    (e.active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
                  }
                >
                  {e.active ? "active" : "draft"}
                </span>
                {e.agentId && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                    pinned to agent
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
