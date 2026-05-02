import Link from "next/link";
import { notFound } from "next/navigation";

import { getOrgBySlug, listEventTypes } from "@/lib/booking/queries";

export const dynamic = "force-dynamic";

export default async function PublicOrgBookingPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const eventTypes = (await listEventTypes(org.id)).filter((e) => e.active);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-10">
        <h1 className="font-serif text-4xl tracking-tight">{org.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Book a slot below. You&apos;ll get a calendar invite + Meet link.
        </p>
      </div>

      {eventTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No event types are public yet.</p>
      ) : (
        <ul className="space-y-3">
          {eventTypes.map((e) => (
            <li key={e.id}>
              <Link
                href={`/book/${orgSlug}/${e.slug}`}
                className="block rounded-md border border-border bg-card p-5 transition hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{e.title}</div>
                    {e.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                    {e.durationMinutes} min
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
