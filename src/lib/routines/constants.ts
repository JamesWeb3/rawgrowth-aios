/**
 * Static routine metadata  -  trigger kinds, schedule presets, and the
 * event catalog for integration triggers. Plus helpers for minting new
 * trigger records on the client before they're saved.
 */

export const TRIGGER_KINDS = [
  {
    value: "schedule",
    label: "Schedule",
    description: "Fire on a cron/recurring basis.",
  },
  {
    value: "webhook",
    label: "Webhook",
    description: "Fire when an external service POSTs to a URL.",
  },
  {
    value: "integration",
    label: "Integration event",
    description: "Fire when a connected tool emits an event.",
  },
  {
    value: "telegram",
    label: "Telegram command",
    description: "Fire when a user DMs your bot with a specific command.",
  },
  {
    value: "manual",
    label: "Manual",
    description: "Only fires when you click Run.",
  },
] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number]["value"];

export const SCHEDULE_PRESETS = [
  { value: "every-hour", label: "Every hour", cron: "0 * * * *" },
  { value: "every-day-9am", label: "Every day at 9:00 AM", cron: "0 9 * * *" },
  {
    value: "every-weekday-9am",
    label: "Every weekday at 9:00 AM",
    cron: "0 9 * * 1-5",
  },
  {
    value: "every-monday-9am",
    label: "Every Monday at 9:00 AM",
    cron: "0 9 * * 1",
  },
  { value: "custom", label: "Custom cron...", cron: "" },
] as const;

export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number]["value"];

export const INTEGRATION_EVENTS = [
  {
    value: "fathom.meeting.ended",
    label: "Fathom  -  Meeting ended",
    integration: "Fathom",
  },
  {
    value: "gdrive.file.created",
    label: "Google Drive  -  New file in folder",
    integration: "Google Drive",
  },
  {
    value: "gmail.email.received",
    label: "Gmail  -  Email received",
    integration: "Gmail",
  },
  {
    value: "shopify.order.created",
    label: "Shopify  -  New order",
    integration: "Shopify",
  },
  {
    value: "stripe.payment.succeeded",
    label: "Stripe  -  Payment succeeded",
    integration: "Stripe",
  },
  {
    value: "slack.message.posted",
    label: "Slack  -  Message in channel",
    integration: "Slack",
  },
  {
    value: "hubspot.deal.stage_changed",
    label: "HubSpot  -  Deal stage changed",
    integration: "HubSpot",
  },
  {
    value: "meta.lead.submitted",
    label: "Meta  -  Lead form submitted",
    integration: "Meta Business Suite",
  },
] as const;

export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number]["value"];

// ─── Trigger shape ─────────────────────────────────────────────────
// Discriminated union  -  the UI reads `trigger.preset` / `trigger.cron` etc.
// directly. Server-side we persist the kind-specific fields into the
// routine_triggers.config jsonb column.

export type RoutineTrigger =
  | {
      id: string;
      kind: "schedule";
      enabled: boolean;
      preset: SchedulePreset;
      cron: string;
      timezone: string;
    }
  | {
      id: string;
      kind: "webhook";
      enabled: boolean;
      publicUrl: string;
      signingSecret: string;
    }
  | {
      id: string;
      kind: "integration";
      enabled: boolean;
      event: IntegrationEvent;
    }
  | {
      id: string;
      kind: "manual";
      enabled: boolean;
    }
  | {
      id: string;
      kind: "telegram";
      enabled: boolean;
      /** Bot command that fires this routine, including leading slash. e.g. "/proposal" */
      command: string;
      /** Human-readable description shown in the routine card + Telegram help text. */
      description?: string;
    };

function clientUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `trg_${Math.random().toString(36).slice(2, 14)}`;
}

export function newTrigger(kind: TriggerKind): RoutineTrigger {
  switch (kind) {
    case "schedule":
      return {
        id: clientUuid(),
        kind: "schedule",
        enabled: true,
        preset: "every-day-9am",
        cron: "0 9 * * *",
        timezone:
          typeof Intl !== "undefined"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : "UTC",
      };
    case "webhook":
      return {
        id: clientUuid(),
        kind: "webhook",
        enabled: true,
        publicUrl: `https://aios.rawgrowth.ai/webhooks/${Math.random()
          .toString(36)
          .slice(2, 14)}`,
        signingSecret: `whsec_${Math.random().toString(36).slice(2, 26)}`,
      };
    case "integration":
      return {
        id: clientUuid(),
        kind: "integration",
        enabled: true,
        event: "fathom.meeting.ended",
      };
    case "telegram":
      return {
        id: clientUuid(),
        kind: "telegram",
        enabled: true,
        command: "/run",
        description: "",
      };
    case "manual":
      return { id: clientUuid(), kind: "manual", enabled: true };
  }
}

export function describeTrigger(t: RoutineTrigger): string {
  switch (t.kind) {
    case "schedule": {
      const preset = SCHEDULE_PRESETS.find((p) => p.value === t.preset);
      return preset && preset.value !== "custom"
        ? preset.label
        : `cron: ${t.cron}`;
    }
    case "webhook":
      return "Webhook URL";
    case "integration": {
      const ev = INTEGRATION_EVENTS.find((e) => e.value === t.event);
      return ev ? ev.label : t.event;
    }
    case "telegram":
      return `Telegram: ${t.command}`;
    case "manual":
      return "Manual only";
  }
}

export const ROUTINE_STATUSES = ["active", "paused", "archived"] as const;
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];
