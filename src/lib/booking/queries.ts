import { supabaseAdmin } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import type { Database } from "@/lib/supabase/types";
import type {
  AvailabilityRow,
  BookingRow,
  BookingStatus,
  CalendarBindingRow,
  CustomQuestion,
  EventColor,
  EventTypeRow,
  LocationSpec,
} from "./types";
import { DEFAULT_AVAILABILITY } from "./types";

type Json = Record<string, unknown>;

function dbToEventType(r: Json): EventTypeRow {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    slug: r.slug as string,
    title: r.title as string,
    description: (r.description as string) ?? "",
    durationMinutes: r.duration_minutes as number,
    color: (r.color as EventColor) ?? "sage",
    location: r.location as LocationSpec,
    rules: r.rules as EventTypeRow["rules"],
    customQuestions: (r.custom_questions as CustomQuestion[]) ?? [],
    active: !!r.active,
    position: (r.position as number) ?? 0,
    agentId: (r.agent_id as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

function dbToAvailability(r: Json): AvailabilityRow {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    timezone: r.timezone as string,
    weeklyHours: r.weekly_hours as AvailabilityRow["weeklyHours"],
    dateOverrides: r.date_overrides as AvailabilityRow["dateOverrides"],
    updatedAt: new Date(r.updated_at as string),
  };
}

function dbToBooking(r: Json): BookingRow {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    eventTypeId: r.event_type_id as string,
    eventTypeSlug: r.event_type_slug as string,
    guestName: r.guest_name as string,
    guestEmail: r.guest_email as string,
    guestTimezone: r.guest_timezone as string,
    customAnswers: (r.custom_answers as Record<string, string>) ?? {},
    startUtc: new Date(r.start_utc as string),
    endUtc: new Date(r.end_utc as string),
    googleEventId: (r.google_event_id as string | null) ?? null,
    meetLink: (r.meet_link as string | null) ?? null,
    manageToken: r.manage_token as string,
    status: r.status as BookingStatus,
    rescheduledToBookingId: (r.rescheduled_to_booking_id as string | null) ?? null,
    notifiedAgentAt: r.notified_agent_at ? new Date(r.notified_agent_at as string) : null,
    createdAt: new Date(r.created_at as string),
    cancelledAt: r.cancelled_at ? new Date(r.cancelled_at as string) : null,
  };
}

function dbToBinding(r: Json): CalendarBindingRow {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    calendarId: r.calendar_id as string,
    calendarSummary: r.calendar_summary as string,
    defaultTimezone: r.default_timezone as string,
  };
}

// Event types -----------------------------------------------------------

export async function listEventTypes(orgId: string): Promise<EventTypeRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_kalendly_event_types")
    .select("*")
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(dbToEventType);
}

export async function getEventTypeBySlug(
  orgId: string,
  slug: string,
): Promise<EventTypeRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_kalendly_event_types")
    .select("*")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data ? dbToEventType(data) : null;
}

export async function getEventTypeById(
  orgId: string,
  id: string,
): Promise<EventTypeRow | null> {
  // Guard against non-UUID path params reaching Postgres. Without this,
  // /booking/event-types/notauuid lights up "invalid input syntax for
  // type uuid" (22P02) and the page 500s instead of 404s.
  if (!isUuid(id)) return null;
  const { data, error } = await supabaseAdmin()
    .from("rgaios_kalendly_event_types")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? dbToEventType(data) : null;
}

interface EventTypeInsert {
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  color: EventColor;
  location: LocationSpec;
  rules: EventTypeRow["rules"];
  customQuestions: CustomQuestion[];
  active: boolean;
  agentId?: string | null;
}

export async function upsertEventType(
  orgId: string,
  input: EventTypeInsert & { id?: string },
): Promise<EventTypeRow> {
  // App-side types (EventColor, LocationSpec, structured rules / questions)
  // are runtime-valid for the DB columns (string / Record<string, unknown>)
  // but nominally distinct, so type the row as the table Insert shape and
  // cast the structured fields to Record at the boundary.
  const row: Database["public"]["Tables"]["rgaios_kalendly_event_types"]["Insert"] = {
    organization_id: orgId,
    slug: input.slug,
    title: input.title,
    description: input.description,
    duration_minutes: input.durationMinutes,
    color: input.color,
    location: input.location as unknown as Record<string, unknown>,
    rules: input.rules as unknown as Record<string, unknown>,
    custom_questions: input.customQuestions as unknown as Record<string, unknown>,
    active: input.active,
    agent_id: input.agentId ?? null,
    updated_at: new Date().toISOString(),
  };
  let result;
  if (input.id) {
    const { data, error } = await supabaseAdmin()
      .from("rgaios_kalendly_event_types")
      .update(row)
      .eq("organization_id", orgId)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw error;
    result = data;
  } else {
    const { data, error } = await supabaseAdmin()
      .from("rgaios_kalendly_event_types")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    result = data;
  }
  return dbToEventType(result as Json);
}

export async function deleteEventType(orgId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("rgaios_kalendly_event_types")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id);
  if (error) throw error;
}

// Availability ----------------------------------------------------------

export async function getAvailability(orgId: string): Promise<AvailabilityRow> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_kalendly_availability")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (data) return dbToAvailability(data);

  // Auto-create with default 9-5 weekday hours. weekly_hours /
  // date_overrides are structured arrays at the app layer but plain
  // Record<string, unknown> JSONB columns in the DB, so type the row as
  // the table Insert shape and cast the structured fields at the boundary.
  const insertRow: Database["public"]["Tables"]["rgaios_kalendly_availability"]["Insert"] = {
    organization_id: orgId,
    timezone: DEFAULT_AVAILABILITY.timezone,
    weekly_hours: DEFAULT_AVAILABILITY.weeklyHours as unknown as Record<string, unknown>,
    date_overrides: DEFAULT_AVAILABILITY.dateOverrides as unknown as Record<string, unknown>,
  };
  const { data: created, error: insertError } = await supabaseAdmin()
    .from("rgaios_kalendly_availability")
    .insert(insertRow)
    .select("*")
    .single();
  if (insertError) throw insertError;
  return dbToAvailability(created as Json);
}

export async function updateAvailability(
  orgId: string,
  input: Pick<AvailabilityRow, "timezone" | "weeklyHours" | "dateOverrides">,
): Promise<AvailabilityRow> {
  // Same app-vs-DB shape gap as getAvailability's insert above: typed
  // arrays at the app layer, JSONB Record columns in the DB.
  const upsertRow: Database["public"]["Tables"]["rgaios_kalendly_availability"]["Insert"] = {
    organization_id: orgId,
    timezone: input.timezone,
    weekly_hours: input.weeklyHours as unknown as Record<string, unknown>,
    date_overrides: input.dateOverrides as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin()
    .from("rgaios_kalendly_availability")
    .upsert(upsertRow, { onConflict: "organization_id" })
    .select("*")
    .single();
  if (error) throw error;
  return dbToAvailability(data as Json);
}

// Bookings --------------------------------------------------------------

export async function listBookings(
  orgId: string,
  opts: { status?: BookingStatus; limit?: number } = {},
): Promise<BookingRow[]> {
  let q = supabaseAdmin()
    .from("rgaios_kalendly_bookings")
    .select("*")
    .eq("organization_id", orgId)
    .order("start_utc", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(dbToBooking);
}

export async function bookingsForDay(
  orgId: string,
  eventTypeSlug: string,
  dayKey: string,
): Promise<number> {
  const startIso = `${dayKey}T00:00:00Z`;
  const endIso = `${dayKey}T23:59:59Z`;
  const { count, error } = await supabaseAdmin()
    .from("rgaios_kalendly_bookings")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("event_type_slug", eventTypeSlug)
    .eq("status", "confirmed")
    .gte("start_utc", startIso)
    .lt("start_utc", endIso);
  if (error) throw error;
  return count ?? 0;
}

export async function getBookingByToken(
  token: string,
  expectedOrgId?: string,
): Promise<BookingRow | null> {
  if (!expectedOrgId) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "booking.getBookingByToken.no_expected_org",
        msg: "getBookingByToken called without expectedOrgId; cross-org defensive check skipped",
      }),
    );
  }
  let q = supabaseAdmin()
    .from("rgaios_kalendly_bookings")
    .select("*")
    .eq("manage_token", token);
  if (expectedOrgId) q = q.eq("organization_id", expectedOrgId);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data ? dbToBooking(data) : null;
}

export async function insertBooking(
  orgId: string,
  input: Omit<BookingRow, "id" | "organizationId" | "notifiedAgentAt" | "createdAt" | "cancelledAt">,
): Promise<BookingRow> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_kalendly_bookings")
    .insert({
      organization_id: orgId,
      event_type_id: input.eventTypeId,
      event_type_slug: input.eventTypeSlug,
      guest_name: input.guestName,
      guest_email: input.guestEmail,
      guest_timezone: input.guestTimezone,
      custom_answers: input.customAnswers,
      start_utc: input.startUtc.toISOString(),
      end_utc: input.endUtc.toISOString(),
      google_event_id: input.googleEventId,
      meet_link: input.meetLink,
      manage_token: input.manageToken,
      status: input.status,
      rescheduled_to_booking_id: input.rescheduledToBookingId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return dbToBooking(data as Json);
}

export async function updateBookingStatus(
  bookingId: string,
  patch: Partial<Pick<BookingRow, "status" | "cancelledAt" | "rescheduledToBookingId">>,
  expectedOrgId?: string,
): Promise<void> {
  if (!expectedOrgId) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "booking.updateBookingStatus.no_expected_org",
        bookingId,
        msg: "updateBookingStatus called without expectedOrgId; cross-org defensive check skipped",
      }),
    );
  }
  // TODO: hard org check - resolve caller session here and verify access
  // to existing.organization_id before UPDATE. For now we token-blind by
  // SELECTing the row first and requiring expectedOrgId to match when
  // provided, so a stray bookingId from one org cannot mutate another.
  const { data: existing, error: selectError } = await supabaseAdmin()
    .from("rgaios_kalendly_bookings")
    .select("id, organization_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!existing) {
    throw new Error(`Booking ${bookingId} not found`);
  }
  if (expectedOrgId && (existing.organization_id as string) !== expectedOrgId) {
    const err = new Error("Forbidden: booking organization mismatch") as Error & {
      status?: number;
    };
    err.status = 403;
    throw err;
  }
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.cancelledAt !== undefined) {
    update.cancelled_at = patch.cancelledAt ? patch.cancelledAt.toISOString() : null;
  }
  if (patch.rescheduledToBookingId !== undefined) {
    update.rescheduled_to_booking_id = patch.rescheduledToBookingId;
  }
  let q = supabaseAdmin()
    .from("rgaios_kalendly_bookings")
    .update(update as never)
    .eq("id", bookingId);
  if (expectedOrgId) q = q.eq("organization_id", expectedOrgId);
  const { error } = await q;
  if (error) throw error;
}

// Calendar bindings -----------------------------------------------------

export async function getCalendarBinding(orgId: string): Promise<CalendarBindingRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_kalendly_calendar_bindings")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? dbToBinding(data) : null;
}

export async function setCalendarBinding(
  orgId: string,
  input: { calendarId: string; calendarSummary: string; defaultTimezone: string },
): Promise<CalendarBindingRow> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_kalendly_calendar_bindings")
    .upsert(
      {
        organization_id: orgId,
        calendar_id: input.calendarId,
        calendar_summary: input.calendarSummary,
        default_timezone: input.defaultTimezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return dbToBinding(data as Json);
}

// Lookup org by slug for public booking page (no auth required).
export async function getOrgBySlug(
  slug: string,
): Promise<{ id: string; name: string; slug: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_organizations")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, name: data.name, slug: data.slug };
}
