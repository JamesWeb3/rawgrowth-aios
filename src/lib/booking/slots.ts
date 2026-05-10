import { computeSlots } from "./availability";
import { getBusyTimes } from "./booking";
import {
  bookingsForDay,
  getAvailability,
  getCalendarBinding,
  getEventTypeBySlug,
} from "./queries";
import { eachDayBetween } from "./timezone";
import type { Slot } from "./availability";

export interface PublicSlotsInput {
  orgId: string;
  slug: string;
}

export interface PublicSlotsResult {
  slots: Slot[];
  timezone: string;
  durationMinutes: number;
  title: string;
}

export async function getPublicSlots(input: PublicSlotsInput): Promise<PublicSlotsResult | null> {
  const evt = await getEventTypeBySlug(input.orgId, input.slug);
  if (!evt || !evt.active) return null;

  const binding = await getCalendarBinding(input.orgId);
  const avail = await getAvailability(input.orgId);
  const now = new Date();
  const earliest = new Date(now.getTime() + evt.rules.minNoticeMinutes * 60_000);
  const latest = new Date(now.getTime() + evt.rules.maxAdvanceDays * 24 * 60 * 60 * 1000);

  let busy: Array<{ start: Date; end: Date }> = [];
  if (binding) {
    try {
      busy = await getBusyTimes(input.orgId, binding.calendarId, earliest, latest, avail.timezone);
    } catch {
      busy = [];
    }
  }

  const days = eachDayBetween(earliest, latest, avail.timezone);
  const bookingsPerDay: Record<string, number> = {};
  for (const day of days) {
    bookingsPerDay[day] = await bookingsForDay(input.orgId, evt.slug, day);
  }

  const slots = computeSlots({
    eventType: evt,
    availability: avail,
    busy,
    now,
    bookingsPerDay,
  });

  return {
    slots,
    timezone: avail.timezone,
    durationMinutes: evt.durationMinutes,
    title: evt.title,
  };
}
