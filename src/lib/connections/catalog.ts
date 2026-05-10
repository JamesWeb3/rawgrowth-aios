/**
 * Composio-style connector catalog.
 *
 * Single source of truth for the cards on /connections. Each entry is a
 * popular app the workspace might want to wire up. We render the grid
 * straight from this list, mark anything in NATIVE_INTEGRATION_IDS as
 * "already shipped" (existing OAuth / API key flow), and treat the rest
 * as Composio placeholders that just log interest server-side.
 *
 * Brand color drives the letter-avatar fallback. Real brand logos render
 * via `logoUrl` (Composio CDN, https://logos.composio.dev/api/<slug>).
 * Bespoke entries (telegram bot, supabase PAT, vercel token) intentionally
 * omit `logoUrl` and stay on the letter avatar.
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
  /** Hex tint for the letter avatar background (fallback when logoUrl is missing or 404s). */
  brandColor: string;
  /** True when an OAuth / API key flow already exists in this codebase. */
  hasNativeIntegration: boolean;
  /**
   * Composio app slug override. Defaults to `key` when omitted. Use this
   * when our display key differs from Composio's slug (e.g. our "google-calendar"
   * vs Composio's "googlecalendar"). Resolved by `composioAppNameFor()`
   * and the Composio proxy / connect handlers.
   */
  composioAppName?: string;
  /**
   * Direct CDN URL for a real brand logo. Composio serves these at
   * `https://logos.composio.dev/api/<appKey>`. When set, the connectors
   * grid renders an <img> instead of the letter avatar (still fading
   * back to the avatar via onError when the CDN 404s or the request
   * fails). Refresh by re-running `scripts/sync-composio-logos.ts`.
   * Optional: bespoke entries (telegram bot, supabase PAT, vercel token)
   * intentionally omit and keep their letter avatar. A handful of apps
   * (anthropic, zapier, webhook, s3) are not in Composio's CDN; they too
   * keep the letter avatar.
   *
   * NOTE: the logo CDN slug can differ from `composioAppName` (the OAuth
   * slug). E.g. our "microsoft-teams" uses composioAppName="microsoftteams"
   * for the OAuth flow but the CDN serves the logo under "microsoft_teams".
   * Keep both fields explicit.
   */
  logoUrl?: string;
};

/**
 * Apps where we already shipped a real flow. Connecting one of these
 * opens the existing IntegrationConnectionSheet (Nango) or the dedicated
 * card (Telegram bot, Slack OAuth, Stripe key, etc).
 *
 * Keys here MUST match a key in CONNECTOR_CATALOG below AND be wired in
 * src/lib/connections/providers.ts (or have a bespoke route under
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
  { key: "slack", name: "Slack", category: "Communication", brandColor: "#4A154B", hasNativeIntegration: true, logoUrl: "https://logos.composio.dev/api/slack" },
  { key: "gmail", name: "Gmail", category: "Communication", brandColor: "#EA4335", hasNativeIntegration: true, logoUrl: "https://logos.composio.dev/api/gmail" },
  { key: "discord", name: "Discord", category: "Communication", brandColor: "#5865F2", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/discord" },
  // Telegram is bespoke (bot token), intentionally omits logoUrl.
  { key: "telegram", name: "Telegram", category: "Communication", brandColor: "#26A5E4", hasNativeIntegration: true },
  { key: "whatsapp", name: "WhatsApp", category: "Communication", brandColor: "#25D366", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/whatsapp" },
  { key: "intercom", name: "Intercom", category: "Communication", brandColor: "#1F8DED", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/intercom" },
  { key: "zoom", name: "Zoom", category: "Communication", brandColor: "#2D8CFF", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/zoom" },
  { key: "outlook", name: "Outlook", category: "Communication", brandColor: "#0078D4", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/outlook" },
  { key: "microsoft-teams", name: "Microsoft Teams", category: "Communication", brandColor: "#6264A7", hasNativeIntegration: false, composioAppName: "microsoft_teams", logoUrl: "https://logos.composio.dev/api/microsoft_teams" },

  // CRM
  { key: "hubspot", name: "HubSpot", category: "CRM", brandColor: "#FF7A59", hasNativeIntegration: true, logoUrl: "https://logos.composio.dev/api/hubspot" },
  { key: "salesforce", name: "Salesforce", category: "CRM", brandColor: "#00A1E0", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/salesforce" },
  { key: "pipedrive", name: "Pipedrive", category: "CRM", brandColor: "#1A1A1A", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/pipedrive" },
  { key: "attio", name: "Attio", category: "CRM", brandColor: "#0F172A", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/attio" },
  { key: "close", name: "Close", category: "CRM", brandColor: "#2BB74B", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/close" },
  { key: "zoho", name: "Zoho CRM", category: "CRM", brandColor: "#E42527", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/zoho" },

  // Marketing
  { key: "mailchimp", name: "Mailchimp", category: "Marketing", brandColor: "#FFE01B", hasNativeIntegration: true, logoUrl: "https://logos.composio.dev/api/mailchimp" },
  { key: "activecampaign", name: "ActiveCampaign", category: "Marketing", brandColor: "#356AE6", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/active_campaign" },
  { key: "klaviyo", name: "Klaviyo", category: "Marketing", brandColor: "#232627", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/klaviyo" },
  { key: "linkedin", name: "LinkedIn", category: "Marketing", brandColor: "#0A66C2", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/linkedin" },
  { key: "twitter", name: "Twitter / X", category: "Marketing", brandColor: "#000000", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/twitter" },
  { key: "meta", name: "Meta Ads", category: "Marketing", brandColor: "#0467DF", hasNativeIntegration: true, composioAppName: "facebook", logoUrl: "https://logos.composio.dev/api/metaads" },
  { key: "tiktok", name: "TikTok Ads", category: "Marketing", brandColor: "#000000", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/tiktok" },

  // Calendar
  { key: "google-calendar", name: "Google Calendar", category: "Calendar", brandColor: "#4285F4", hasNativeIntegration: true, composioAppName: "googlecalendar", logoUrl: "https://logos.composio.dev/api/googlecalendar" },
  { key: "calendly", name: "Calendly", category: "Calendar", brandColor: "#006BFF", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/calendly" },
  { key: "cal-com", name: "Cal.com", category: "Calendar", brandColor: "#0F172A", hasNativeIntegration: false, composioAppName: "cal", logoUrl: "https://logos.composio.dev/api/cal" },
  { key: "fathom", name: "Fathom", category: "Calendar", brandColor: "#9F6EF3", hasNativeIntegration: true, logoUrl: "https://logos.composio.dev/api/fathom" },

  // Analytics
  { key: "google-analytics", name: "Google Analytics", category: "Analytics", brandColor: "#E37400", hasNativeIntegration: true, composioAppName: "google_analytics", logoUrl: "https://logos.composio.dev/api/google_analytics" },
  { key: "mixpanel", name: "Mixpanel", category: "Analytics", brandColor: "#7856FF", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/mixpanel" },
  { key: "amplitude", name: "Amplitude", category: "Analytics", brandColor: "#1E61F0", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/amplitude" },
  { key: "posthog", name: "PostHog", category: "Analytics", brandColor: "#1D4AFF", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/posthog" },
  { key: "stripe", name: "Stripe", category: "Analytics", brandColor: "#635BFF", hasNativeIntegration: true, logoUrl: "https://logos.composio.dev/api/stripe" },
  { key: "shopify", name: "Shopify", category: "Analytics", brandColor: "#95BF47", hasNativeIntegration: true, logoUrl: "https://logos.composio.dev/api/shopify" },

  // Storage
  { key: "google-drive", name: "Google Drive", category: "Storage", brandColor: "#1FA463", hasNativeIntegration: true, composioAppName: "googledrive", logoUrl: "https://logos.composio.dev/api/googledrive" },
  { key: "dropbox", name: "Dropbox", category: "Storage", brandColor: "#0061FF", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/dropbox" },
  { key: "onedrive", name: "OneDrive", category: "Storage", brandColor: "#0078D4", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/one_drive" },
  { key: "box", name: "Box", category: "Storage", brandColor: "#0061D5", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/box" },
  // s3: Composio has no AWS S3 toolkit (verified against /api/v1/apps).
  { key: "s3", name: "AWS S3", category: "Storage", brandColor: "#FF9900", hasNativeIntegration: false },

  // AI
  { key: "openai", name: "OpenAI", category: "AI", brandColor: "#10A37F", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/openai" },
  // anthropic: no Composio CDN logo - falls back to letter avatar.
  { key: "anthropic", name: "Anthropic", category: "AI", brandColor: "#D97757", hasNativeIntegration: false },
  { key: "perplexity", name: "Perplexity", category: "AI", brandColor: "#1FB8CD", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/perplexityai" },
  { key: "elevenlabs", name: "ElevenLabs", category: "AI", brandColor: "#0F172A", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/elevenlabs" },

  // Other (productivity, dev, automation)
  { key: "notion", name: "Notion", category: "Other", brandColor: "#1F1F1F", hasNativeIntegration: true, logoUrl: "https://logos.composio.dev/api/notion" },
  { key: "linear", name: "Linear", category: "Other", brandColor: "#5E6AD2", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/linear" },
  { key: "github", name: "GitHub", category: "Other", brandColor: "#181717", hasNativeIntegration: true, logoUrl: "https://logos.composio.dev/api/github" },
  { key: "bitbucket", name: "Bitbucket", category: "Other", brandColor: "#2684FF", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/bitbucket" },
  { key: "figma", name: "Figma", category: "Other", brandColor: "#F24E1E", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/figma" },
  { key: "webflow", name: "Webflow", category: "Other", brandColor: "#146EF5", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/webflow" },
  { key: "wordpress", name: "WordPress", category: "Other", brandColor: "#21759B", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/wordpress" },
  { key: "airtable", name: "Airtable", category: "Other", brandColor: "#FCB400", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/airtable" },
  { key: "clickup", name: "ClickUp", category: "Other", brandColor: "#7B68EE", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/clickup" },
  { key: "asana", name: "Asana", category: "Other", brandColor: "#F06A6A", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/asana" },
  { key: "monday", name: "Monday", category: "Other", brandColor: "#FF3D57", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/monday" },
  { key: "trello", name: "Trello", category: "Other", brandColor: "#0079BF", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/trello" },
  // zapier: no Composio CDN logo - falls back to letter avatar.
  { key: "zapier", name: "Zapier", category: "Other", brandColor: "#FF4F00", hasNativeIntegration: false },
  { key: "n8n", name: "n8n", category: "Other", brandColor: "#EA4B71", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/n8n" },
  { key: "make", name: "Make", category: "Other", brandColor: "#6D00CC", hasNativeIntegration: false, logoUrl: "https://logos.composio.dev/api/make" },
  // webhook: no Composio CDN logo - falls back to letter avatar.
  { key: "webhook", name: "Webhook", category: "Other", brandColor: "#475569", hasNativeIntegration: false },
  // supabase + vercel are bespoke (PAT / token), intentionally omit logoUrl.
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

/**
 * Resolve a catalog key to the slug Composio expects. Defaults to the
 * key itself; CatalogEntry can override via `composioAppName` when our
 * display id diverges from Composio's catalog (e.g. "google-calendar"
 * here vs Composio's "googlecalendar"). Used by /api/connections/composio
 * POST and src/lib/composio/proxy.ts.
 */
export function composioAppNameFor(key: string): string {
  return getCatalogEntry(key)?.composioAppName ?? key;
}
