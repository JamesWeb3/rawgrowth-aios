/**
 * Composio-style connector catalog.
 *
 * Single source of truth for the cards on /connections. Each entry is a
 * popular app the workspace might want to wire up. We render the grid
 * straight from this list, mark anything in NATIVE_INTEGRATION_IDS as
 * "already shipped" (existing OAuth / API key flow), and treat the rest
 * as Composio placeholders that just log interest server-side.
 *
 * Brand colors are hex; the UI uses them to tint a letter avatar (no
 * external logo URLs per Pedro's constraint).
 */

export type CatalogCategory =
  | "Communication"
  | "CRM"
  | "Marketing"
  | "Calendar"
  | "Analytics"
  | "Storage"
  | "AI"
  | "Other";

export type CatalogEntry = {
  /** Stable id used as the Composio "app key" + DB lookup. */
  key: string;
  name: string;
  category: CatalogCategory;
  /** Hex tint for the letter avatar background. */
  brandColor: string;
  /** True when an OAuth / API key flow already exists in this codebase. */
  hasNativeIntegration: boolean;
};

/**
 * Apps where we already shipped a real flow. Connecting one of these
 * opens the existing IntegrationConnectionSheet (Nango) or the dedicated
 * card (Telegram bot, Slack OAuth, Stripe key, etc).
 *
 * Keys here MUST match a key in CONNECTOR_CATALOG below AND be wired in
 * src/lib/nango/providers.ts (or have a bespoke route under
 * /api/connections/<id>).
 */
export const NATIVE_INTEGRATION_IDS = new Set<string>([
  "slack",
  "gmail",
  "google-drive",
  "google-calendar",
  "google-analytics",
  "github",
  "notion",
  "hubspot",
  "stripe",
  "shopify",
  "mailchimp",
  "telegram",
  "supabase",
  "vercel",
  "fathom",
  "meta",
]);

export const CONNECTOR_CATALOG: CatalogEntry[] = [
  // Communication
  { key: "slack", name: "Slack", category: "Communication", brandColor: "#4A154B", hasNativeIntegration: true },
  { key: "gmail", name: "Gmail", category: "Communication", brandColor: "#EA4335", hasNativeIntegration: true },
  { key: "discord", name: "Discord", category: "Communication", brandColor: "#5865F2", hasNativeIntegration: false },
  { key: "telegram", name: "Telegram", category: "Communication", brandColor: "#26A5E4", hasNativeIntegration: true },
  { key: "whatsapp", name: "WhatsApp", category: "Communication", brandColor: "#25D366", hasNativeIntegration: false },
  { key: "intercom", name: "Intercom", category: "Communication", brandColor: "#1F8DED", hasNativeIntegration: false },
  { key: "zoom", name: "Zoom", category: "Communication", brandColor: "#2D8CFF", hasNativeIntegration: false },
  { key: "outlook", name: "Outlook", category: "Communication", brandColor: "#0078D4", hasNativeIntegration: false },
  { key: "microsoft-teams", name: "Microsoft Teams", category: "Communication", brandColor: "#6264A7", hasNativeIntegration: false },

  // CRM
  { key: "hubspot", name: "HubSpot", category: "CRM", brandColor: "#FF7A59", hasNativeIntegration: true },
  { key: "salesforce", name: "Salesforce", category: "CRM", brandColor: "#00A1E0", hasNativeIntegration: false },
  { key: "pipedrive", name: "Pipedrive", category: "CRM", brandColor: "#1A1A1A", hasNativeIntegration: false },
  { key: "attio", name: "Attio", category: "CRM", brandColor: "#0F172A", hasNativeIntegration: false },
  { key: "close", name: "Close", category: "CRM", brandColor: "#2BB74B", hasNativeIntegration: false },
  { key: "zoho", name: "Zoho CRM", category: "CRM", brandColor: "#E42527", hasNativeIntegration: false },

  // Marketing
  { key: "mailchimp", name: "Mailchimp", category: "Marketing", brandColor: "#FFE01B", hasNativeIntegration: true },
  { key: "activecampaign", name: "ActiveCampaign", category: "Marketing", brandColor: "#356AE6", hasNativeIntegration: false },
  { key: "klaviyo", name: "Klaviyo", category: "Marketing", brandColor: "#232627", hasNativeIntegration: false },
  { key: "linkedin", name: "LinkedIn", category: "Marketing", brandColor: "#0A66C2", hasNativeIntegration: false },
  { key: "twitter", name: "Twitter / X", category: "Marketing", brandColor: "#000000", hasNativeIntegration: false },
  { key: "meta", name: "Meta Ads", category: "Marketing", brandColor: "#0467DF", hasNativeIntegration: true },
  { key: "tiktok", name: "TikTok Ads", category: "Marketing", brandColor: "#000000", hasNativeIntegration: false },

  // Calendar
  { key: "google-calendar", name: "Google Calendar", category: "Calendar", brandColor: "#4285F4", hasNativeIntegration: true },
  { key: "calendly", name: "Calendly", category: "Calendar", brandColor: "#006BFF", hasNativeIntegration: false },
  { key: "cal-com", name: "Cal.com", category: "Calendar", brandColor: "#0F172A", hasNativeIntegration: false },
  { key: "fathom", name: "Fathom", category: "Calendar", brandColor: "#9F6EF3", hasNativeIntegration: true },

  // Analytics
  { key: "google-analytics", name: "Google Analytics", category: "Analytics", brandColor: "#E37400", hasNativeIntegration: true },
  { key: "mixpanel", name: "Mixpanel", category: "Analytics", brandColor: "#7856FF", hasNativeIntegration: false },
  { key: "amplitude", name: "Amplitude", category: "Analytics", brandColor: "#1E61F0", hasNativeIntegration: false },
  { key: "posthog", name: "PostHog", category: "Analytics", brandColor: "#1D4AFF", hasNativeIntegration: false },
  { key: "stripe", name: "Stripe", category: "Analytics", brandColor: "#635BFF", hasNativeIntegration: true },
  { key: "shopify", name: "Shopify", category: "Analytics", brandColor: "#95BF47", hasNativeIntegration: true },

  // Storage
  { key: "google-drive", name: "Google Drive", category: "Storage", brandColor: "#1FA463", hasNativeIntegration: true },
  { key: "dropbox", name: "Dropbox", category: "Storage", brandColor: "#0061FF", hasNativeIntegration: false },
  { key: "onedrive", name: "OneDrive", category: "Storage", brandColor: "#0078D4", hasNativeIntegration: false },
  { key: "box", name: "Box", category: "Storage", brandColor: "#0061D5", hasNativeIntegration: false },
  { key: "s3", name: "AWS S3", category: "Storage", brandColor: "#FF9900", hasNativeIntegration: false },

  // AI
  { key: "openai", name: "OpenAI", category: "AI", brandColor: "#10A37F", hasNativeIntegration: false },
  { key: "anthropic", name: "Anthropic", category: "AI", brandColor: "#D97757", hasNativeIntegration: false },
  { key: "perplexity", name: "Perplexity", category: "AI", brandColor: "#1FB8CD", hasNativeIntegration: false },
  { key: "elevenlabs", name: "ElevenLabs", category: "AI", brandColor: "#0F172A", hasNativeIntegration: false },

  // Other (productivity, dev, automation)
  { key: "notion", name: "Notion", category: "Other", brandColor: "#1F1F1F", hasNativeIntegration: true },
  { key: "linear", name: "Linear", category: "Other", brandColor: "#5E6AD2", hasNativeIntegration: false },
  { key: "github", name: "GitHub", category: "Other", brandColor: "#181717", hasNativeIntegration: true },
  { key: "bitbucket", name: "Bitbucket", category: "Other", brandColor: "#2684FF", hasNativeIntegration: false },
  { key: "figma", name: "Figma", category: "Other", brandColor: "#F24E1E", hasNativeIntegration: false },
  { key: "webflow", name: "Webflow", category: "Other", brandColor: "#146EF5", hasNativeIntegration: false },
  { key: "wordpress", name: "WordPress", category: "Other", brandColor: "#21759B", hasNativeIntegration: false },
  { key: "airtable", name: "Airtable", category: "Other", brandColor: "#FCB400", hasNativeIntegration: false },
  { key: "clickup", name: "ClickUp", category: "Other", brandColor: "#7B68EE", hasNativeIntegration: false },
  { key: "asana", name: "Asana", category: "Other", brandColor: "#F06A6A", hasNativeIntegration: false },
  { key: "monday", name: "Monday", category: "Other", brandColor: "#FF3D57", hasNativeIntegration: false },
  { key: "trello", name: "Trello", category: "Other", brandColor: "#0079BF", hasNativeIntegration: false },
  { key: "zapier", name: "Zapier", category: "Other", brandColor: "#FF4F00", hasNativeIntegration: false },
  { key: "n8n", name: "n8n", category: "Other", brandColor: "#EA4B71", hasNativeIntegration: false },
  { key: "make", name: "Make", category: "Other", brandColor: "#6D00CC", hasNativeIntegration: false },
  { key: "webhook", name: "Webhook", category: "Other", brandColor: "#475569", hasNativeIntegration: false },
  { key: "supabase", name: "Supabase", category: "Other", brandColor: "#3ECF8E", hasNativeIntegration: true },
  { key: "vercel", name: "Vercel", category: "Other", brandColor: "#000000", hasNativeIntegration: true },
];

export const CATALOG_CATEGORIES: ReadonlyArray<CatalogCategory | "All"> = [
  "All",
  "Communication",
  "CRM",
  "Marketing",
  "Calendar",
  "Analytics",
  "Storage",
  "AI",
  "Other",
];

export function isNativeIntegration(key: string): boolean {
  return NATIVE_INTEGRATION_IDS.has(key);
}

export function getCatalogEntry(key: string): CatalogEntry | undefined {
  return CONNECTOR_CATALOG.find((c) => c.key === key);
}
