import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getOrgContext } from "@/lib/auth/admin";
import { composioCall } from "@/lib/composio/proxy";
import { getCalendarBinding, setCalendarBinding } from "@/lib/booking/queries";
import { calendarBindingFormSchema } from "@/lib/booking/validation";

export const runtime = "nodejs";

// PR 5: hardcoded src/lib/booking/calendar.ts is gone. Calendar list goes
// through composioCall directly, same path the agent's composio_use_tool
// uses. composio:google-calendar provider_config_key picks up the same
// per-user OAuth row we wrote in PR 1.
type GoogleCalendarListItem = {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
};

type CalendarSummary = { id: string; summary: string; primary: boolean };

async function listCalendarsViaComposio(
  orgId: string,
  userId: string | null,
): Promise<CalendarSummary[]> {
  const data = await composioCall<{ items?: GoogleCalendarListItem[] }>(
    orgId,
    {
      appKey: "google-calendar",
      action: "GOOGLECALENDAR_LIST_CALENDARS",
      input: {},
    },
    userId,
  );
  const items = data?.items ?? [];
  return items.map((c) => ({
    id: String(c.id ?? ""),
    summary: String(c.summary ?? c.summaryOverride ?? c.id ?? ""),
    primary: Boolean(c.primary ?? false),
  }));
}

export async function GET() {
  try {
    const ctx = await getOrgContext();
    const orgId = await currentOrganizationId();
    const binding = await getCalendarBinding(orgId);
    let calendars: CalendarSummary[] = [];
    try {
      calendars = await listCalendarsViaComposio(orgId, ctx?.userId ?? null);
    } catch (err) {
      return NextResponse.json({ binding, calendars: [], listError: (err as Error).message });
    }
    return NextResponse.json({ binding, calendars });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const orgId = await currentOrganizationId();
    const body = await req.json();
    const parsed = calendarBindingFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const binding = await setCalendarBinding(orgId, parsed.data);
    return NextResponse.json({ binding });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
