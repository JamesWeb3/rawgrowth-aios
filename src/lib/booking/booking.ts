import { computeSlots } from "./availability";
import {
  bookingsForDay,
  getAvailability,
  getCalendarBinding,
  getEventTypeBySlug,
  insertBooking,
  updateBookingStatus,
  getBookingByToken,
} from "./queries";
import { ymdInTz } from "./timezone";
import { newManageToken } from "./tokens";
import { composioCall } from "@/lib/composio/proxy";
import type { BookingRow, EventTypeRow } from "./types";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * PR 5: src/lib/booking/calendar.ts is gone - the booking flow now hits
 * Composio's Google Calendar actions directly via composioCall, same path
 * the agent-side composio_use_tool router uses. Public booking is guest-
 * triggered (no session), so userId is null here and composioCall falls
 * back to the org-wide row.
 */

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface BusyInterval {
  start: Date;
  end: Date;
}

async function getBusyTimes(
  orgId: string,
  calendarId: string,
  start: Date,
  end: Date,
  timezone: string,
): Promise<BusyInterval[]> {
  const data = await composioCall<{
    calendars?: Record<
      string,
      { busy?: Array<{ start: string; end: string }> }
    >;
  }>(
    orgId,
    {
      appKey: "google-calendar",
      action: "GOOGLECALENDAR_FIND_FREE_SLOTS",
      input: {
        time_min: start.toISOString(),
        time_max: end.toISOString(),
        timezone,
        items: [{ id: calendarId }],
      },
    },
    null,
  );
  const cal = data?.calendars?.[calendarId];
  return (cal?.busy ?? []).map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));
}

interface CreateEventInput {
  summary: string;
  description: string;
  startUtc: Date;
  durationMinutes: number;
  attendees: Array<{ email: string; displayName?: string }>;
  withMeet: boolean;
}

interface CreatedEvent {
  googleEventId: string;
  meetLink: string | null;
}

async function createCalendarEvent(
  orgId: string,
  calendarId: string,
  input: CreateEventInput,
): Promise<CreatedEvent> {
  const endUtc = new Date(
    input.startUtc.getTime() + input.durationMinutes * 60_000,
  );
  const data = await composioCall<Record<string, unknown>>(
    orgId,
    {
      appKey: "google-calendar",
      action: "GOOGLECALENDAR_CREATE_EVENT",
      input: {
        calendar_id: calendarId,
        summary: input.summary,
        description: input.description,
        start_datetime: input.startUtc.toISOString(),
        end_datetime: endUtc.toISOString(),
        attendees: input.attendees.map((a) => ({
          email: a.email,
          display_name: a.displayName,
        })),
        create_meeting_room: input.withMeet,
        send_updates: "all",
      },
    },
    null,
  );
  const id = (data?.id as string | undefined) ?? null;
  if (!id) throw new CalendarError("create_event: missing event id");
  const hangoutLink = (data?.hangoutLink as string | undefined) ?? null;
  const conferenceData = data?.conferenceData as
    | { entryPoints?: Array<{ entryPointType: string; uri: string }> }
    | undefined;
  const meetEntry = conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video",
  );
  const meetLink = hangoutLink ?? meetEntry?.uri ?? null;
  return { googleEventId: id, meetLink };
}

async function deleteCalendarEvent(
  orgId: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await composioCall(
    orgId,
    {
      appKey: "google-calendar",
      action: "GOOGLECALENDAR_DELETE_EVENT",
      input: {
        calendar_id: calendarId,
        event_id: eventId,
        send_updates: "all",
      },
    },
    null,
  );
}

// Exposed so slots.ts (read-only availability lookup) can reuse the same
// busy-times Composio call without duplicating the request shape.
export { getBusyTimes };

export class BookingError extends Error {
  constructor(
    public readonly code: "slot_taken" | "not_found" | "validation" | "calendar" | "no_calendar",
    message: string,
  ) {
    super(message);
  }
}

interface CreateBookingInput {
  orgId: string;
  slug: string;
  startUtc: Date;
  guestName: string;
  guestEmail: string;
  guestTimezone: string;
  customAnswers: Record<string, string>;
  appUrl: string;
}

export async function createBookingForOrg(input: CreateBookingInput): Promise<BookingRow> {
  const evt = await getEventTypeBySlug(input.orgId, input.slug);
  if (!evt || !evt.active) throw new BookingError("not_found", "Event type not found");

  const binding = await getCalendarBinding(input.orgId);
  if (!binding) throw new BookingError("no_calendar", "Calendar not connected for this organization");

  const avail = await getAvailability(input.orgId);

  const startUtc = input.startUtc;
  const endUtc = new Date(startUtc.getTime() + evt.durationMinutes * 60_000);

  const windowStart = new Date(startUtc.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(endUtc.getTime() + 24 * 60 * 60 * 1000);

  const busy = await getBusyTimes(
    input.orgId,
    binding.calendarId,
    windowStart,
    windowEnd,
    avail.timezone,
  );

  const dayKey = ymdInTz(startUtc, avail.timezone);
  const sameDayCount = await bookingsForDay(input.orgId, evt.slug, dayKey);

  const candidates = computeSlots({
    eventType: evt,
    availability: avail,
    busy,
    now: new Date(),
    bookingsPerDay: { [dayKey]: sameDayCount },
  });
  const free = candidates.some((s) => s.startUtc.getTime() === startUtc.getTime());
  if (!free) throw new BookingError("slot_taken", "Slot is no longer available");

  const manageToken = newManageToken();
  const description = buildEventDescription(
    evt,
    input.guestName,
    input.customAnswers,
    manageToken,
    input.appUrl,
  );

  const created = await createCalendarEvent(input.orgId, binding.calendarId, {
    summary: `${evt.title} with ${input.guestName}`,
    description,
    startUtc,
    durationMinutes: evt.durationMinutes,
    attendees: [{ email: input.guestEmail, displayName: input.guestName }],
    withMeet: evt.location.type === "google_meet",
  });

  let booking: BookingRow;
  try {
    booking = await insertBooking(input.orgId, {
      eventTypeId: evt.id,
      eventTypeSlug: evt.slug,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      guestTimezone: input.guestTimezone,
      customAnswers: input.customAnswers,
      startUtc,
      endUtc,
      googleEventId: created.googleEventId,
      meetLink: created.meetLink,
      manageToken,
      status: "confirmed",
      rescheduledToBookingId: null,
    });
  } catch (err) {
    await deleteCalendarEvent(input.orgId, binding.calendarId, created.googleEventId).catch(() => {});
    throw err;
  }

  // Hook into v3: ping the assigned agent (if any). Non-fatal.
  notifyAssignedAgent(booking, evt).catch((e) => console.error("[booking] notify failed", e));

  return booking;
}

export async function cancelBookingByToken(token: string): Promise<BookingRow> {
  const original = await getBookingByToken(token);
  if (!original) throw new BookingError("not_found", "Booking not found");
  if (original.status !== "confirmed") throw new BookingError("not_found", "Booking not active");

  await updateBookingStatus(
    original.id,
    {
      status: "cancelled",
      cancelledAt: new Date(),
    },
    original.organizationId,
  );

  const binding = await getCalendarBinding(original.organizationId);
  if (binding && original.googleEventId) {
    await deleteCalendarEvent(original.organizationId, binding.calendarId, original.googleEventId).catch(
      () => {},
    );
  }

  return { ...original, status: "cancelled", cancelledAt: new Date() };
}

export async function rescheduleBookingByToken(
  token: string,
  newStartUtc: Date,
  appUrl: string,
): Promise<BookingRow> {
  const original = await getBookingByToken(token);
  if (!original) throw new BookingError("not_found", "Booking not found");
  if (original.status !== "confirmed") throw new BookingError("not_found", "Booking not active");

  const newBooking = await createBookingForOrg({
    orgId: original.organizationId,
    slug: original.eventTypeSlug,
    startUtc: newStartUtc,
    guestName: original.guestName,
    guestEmail: original.guestEmail,
    guestTimezone: original.guestTimezone,
    customAnswers: original.customAnswers,
    appUrl,
  });

  await updateBookingStatus(
    original.id,
    {
      status: "rescheduled",
      rescheduledToBookingId: newBooking.id,
      cancelledAt: new Date(),
    },
    original.organizationId,
  );

  const binding = await getCalendarBinding(original.organizationId);
  if (binding && original.googleEventId) {
    await deleteCalendarEvent(original.organizationId, binding.calendarId, original.googleEventId).catch(
      () => {},
    );
  }

  return newBooking;
}

function buildEventDescription(
  evt: EventTypeRow,
  guestName: string,
  answers: Record<string, string>,
  manageToken: string,
  appUrl: string,
): string {
  const lines: string[] = [];
  lines.push(`${evt.title} with ${guestName}`);
  lines.push("");
  if (evt.description) {
    lines.push(evt.description);
    lines.push("");
  }
  if (evt.customQuestions.length > 0) {
    for (const q of evt.customQuestions) {
      const value = answers[q.id];
      if (value) lines.push(`${q.label}: ${value}`);
    }
    lines.push("");
  }
  if (evt.location.type === "phone") {
    lines.push(`Phone: ${evt.location.phoneNumber}`);
    lines.push("");
  } else if (evt.location.type === "custom") {
    lines.push(evt.location.customText);
    lines.push("");
  }
  lines.push("--");
  lines.push("Reschedule or cancel:");
  lines.push(`${appUrl}/b/${manageToken}`);
  return lines.join("\n");
}

// On confirmed booking, write a system message into the assigned agent's
// chat thread (if any) so the operator sees the booking land in the
// agent panel. Non-fatal: failure is logged, not thrown.
async function notifyAssignedAgent(booking: BookingRow, evt: EventTypeRow): Promise<void> {
  if (!evt.agentId) return;

  const message = [
    `Booking confirmed: ${evt.title}`,
    `Guest: ${booking.guestName} <${booking.guestEmail}>`,
    `When: ${booking.startUtc.toISOString()}`,
    booking.meetLink ? `Meet: ${booking.meetLink}` : null,
    `Manage: /b/${booking.manageToken}`,
  ]
    .filter(Boolean)
    .join("\n");

  await supabaseAdmin()
    .from("rgaios_agent_chat_messages")
    .insert({
      organization_id: booking.organizationId,
      agent_id: evt.agentId,
      user_id: null,
      role: "system",
      content: message,
    } as never);

  await supabaseAdmin()
    .from("rgaios_kalendly_bookings")
    .update({ notified_agent_at: new Date().toISOString() } as never)
    .eq("id", booking.id);
}

export type { BookingRow, EventTypeRow };
