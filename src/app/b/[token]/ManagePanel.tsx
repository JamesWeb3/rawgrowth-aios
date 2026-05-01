"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

interface BookingInfo {
  manageToken: string;
  eventTypeSlug: string;
  guestName: string;
  guestEmail: string;
  startUtc: string;
  endUtc: string;
  meetLink: string | null;
  status: "confirmed" | "cancelled" | "rescheduled";
}

export function ManagePanel({ token, justConfirmed }: { token: string; justConfirmed: boolean }) {
  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    fetch(`/api/book/manage/${token}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) setError(body?.error ?? "Load failed");
        else setBooking(body.booking);
      })
      .catch((e) => setError((e as Error).message));
  }, [token]);

  async function onCancel() {
    if (!confirm("Cancel this booking?")) return;
    setActing(true);
    try {
      const res = await fetch(`/api/book/manage/${token}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) setError(body?.message ?? body?.error ?? "Cancel failed");
      else setBooking((b) => (b ? { ...b, status: "cancelled" } : b));
    } finally {
      setActing(false);
    }
  }

  if (error) {
    const isNotFound = /not_found|404/i.test(error);
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
        <p className="font-serif text-2xl tracking-tight text-foreground">
          {isNotFound ? "We couldn't find that booking" : "Something went wrong"}
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {isNotFound
            ? "The link may have expired, been cancelled, or already rescheduled. Check your latest calendar invite for an updated link."
            : error}
        </p>
      </div>
    );
  }
  if (!booking) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      {justConfirmed && booking.status === "confirmed" && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
          Booking confirmed. Calendar invite sent to {booking.guestEmail}.
        </div>
      )}

      <div className="rounded-md border border-border bg-card p-5">
        <div className="text-xs uppercase tracking-[1.5px] text-muted-foreground">
          {booking.eventTypeSlug}
        </div>
        <div className="mt-1 font-serif text-2xl tracking-tight">{booking.guestName}</div>
        <div className="mt-1 text-sm text-muted-foreground">{booking.guestEmail}</div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-[1.5px] text-muted-foreground">Start</div>
            <div className="font-mono text-xs">{booking.startUtc}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[1.5px] text-muted-foreground">End</div>
            <div className="font-mono text-xs">{booking.endUtc}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span
            className={
              "rounded-full px-2 py-0.5 text-[10px] uppercase " +
              (booking.status === "confirmed"
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground")
            }
          >
            {booking.status}
          </span>
          {booking.meetLink && (
            <a
              href={booking.meetLink}
              className="text-sm text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Join Google Meet
            </a>
          )}
        </div>
      </div>

      {booking.status === "confirmed" && (
        <Button variant="ghost" onClick={onCancel} disabled={acting} className="text-red-400 hover:text-red-300">
          {acting ? "Cancelling..." : "Cancel booking"}
        </Button>
      )}
    </div>
  );
}
