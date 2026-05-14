import type { ComponentType, CSSProperties } from "react";
import {
  SiShopify,
  SiGoogleanalytics,
  SiMeta,
  SiStripe,
  SiHubspot,
  SiSlack,
  SiNotion,
  SiMailchimp,
  SiFathom,
  SiGoogledrive,
  SiGmail,
  SiTelegram,
  SiGithub,
  SiSupabase,
  SiVercel,
} from "react-icons/si";
// Apify has no react-icons/si brand glyph; fall back to a lucide
// "bot" icon (Apify actors are scraping bots). lucide-react is
// already a project dependency used across the connections UI.
import { Bot as ApifyIcon } from "lucide-react";

export type AuthMethod = "api_key" | "oauth" | "webhook";

export type IntegrationEventDef = {
  id: string; // e.g. "fathom.meeting.ended"  -  also the trigger event id
  label: string; // e.g. "Meeting ended"
};

/**
 * How an integration is wired up under the hood. Most go through
 * Composio's executeAction; Telegram uses a dedicated bot-token flow
 * (Composio doesn't speak Bot API). Supabase uses a personal access
 * token rather than OAuth.
 */
export type ConnectStrategy = "composio" | "telegram-bot" | "supabase-pat";

export type IntegrationEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  /** Brand hex for the logo tile background + foreground. */
  brand: string;
  /** Auth methods this provider supports, in display order. */
  methods: AuthMethod[];
  /** Runtime wiring. Defaults to "composio". */
  connectStrategy?: ConnectStrategy;
  apiKey?: {
    placeholder: string;
    docsUrl: string;
    where: string;
  };
  oauth?: {
    scopes: string[];
    exampleAccount: string;
  };
  webhook?: {
    events: string[];
    instructions: string;
    docsUrl?: string;
  };
  /** Events this integration emits that can trigger routines. */
  events?: IntegrationEventDef[];
};

export const INTEGRATIONS: IntegrationEntry[] = [
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Traffic, conversions, and attribution in one feed.",
    category: "Analytics",
    Icon: SiGoogleanalytics,
    brand: "#E37400",
    methods: ["oauth"],
    oauth: {
      scopes: ["analytics.readonly"],
      exampleAccount: "james.oldham0604@gmail.com",
    },
  },
  {
    id: "meta",
    name: "Meta Business Suite",
    description: "Facebook & Instagram ads, pages, and insights.",
    category: "Ads",
    Icon: SiMeta,
    brand: "#0467DF",
    methods: ["oauth"],
    oauth: {
      scopes: ["ads_read", "leads_retrieval", "pages_read_engagement"],
      exampleAccount: "Rawgrowth Inc.",
    },
    events: [{ id: "meta.lead.submitted", label: "Lead form submitted" }],
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "Orders, customers, and storefront analytics.",
    category: "Commerce",
    Icon: SiShopify,
    brand: "#95BF47",
    methods: ["api_key", "webhook"],
    apiKey: {
      placeholder: "shpat_••••••••••••••••",
      docsUrl:
        "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
      where: "Shopify Admin → Apps → Develop apps → Admin API access token",
    },
    webhook: {
      events: ["orders/create", "orders/fulfilled", "customers/create"],
      instructions:
        "In Shopify Admin → Settings → Notifications → Webhooks, add this URL with topic orders/create.",
    },
    events: [{ id: "shopify.order.created", label: "New order created" }],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, subscriptions, and revenue telemetry.",
    category: "Finance",
    Icon: SiStripe,
    brand: "#635BFF",
    methods: ["api_key", "webhook"],
    apiKey: {
      placeholder: "sk_live_••••••••••••••••",
      docsUrl: "https://dashboard.stripe.com/apikeys",
      where: "Stripe Dashboard → Developers → API keys",
    },
    webhook: {
      events: ["payment_intent.succeeded", "customer.subscription.created"],
      instructions:
        "In Stripe Dashboard → Developers → Webhooks, add this endpoint and select the events you want to listen for.",
    },
    events: [{ id: "stripe.payment.succeeded", label: "Payment succeeded" }],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "CRM pipeline, contacts, and marketing activity.",
    category: "CRM",
    Icon: SiHubspot,
    brand: "#FF7A59",
    methods: ["oauth", "webhook"],
    oauth: {
      scopes: ["crm.objects.contacts.read", "crm.objects.deals.read"],
      exampleAccount: "rawgrowth.com",
    },
    webhook: {
      events: ["deal.propertyChange"],
      instructions:
        "In HubSpot → Settings → Integrations → Private apps → Webhooks, add this URL and subscribe to deal stage changes.",
    },
    events: [
      { id: "hubspot.deal.stage_changed", label: "Deal stage changed" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Pipe agent updates and alerts into your channels.",
    category: "Comms",
    Icon: SiSlack,
    brand: "#4A154B",
    methods: ["oauth"],
    oauth: {
      scopes: ["channels:read", "chat:write", "users:read"],
      exampleAccount: "rawgrowth.slack.com",
    },
    events: [{ id: "slack.message.posted", label: "Message in channel" }],
  },
  {
    id: "notion",
    name: "Notion",
    description: "SOPs, docs, and internal knowledge base sync.",
    category: "Knowledge",
    Icon: SiNotion,
    brand: "#FFFFFF",
    methods: ["oauth"],
    oauth: {
      scopes: ["databases.read", "pages.write"],
      exampleAccount: "Rawgrowth workspace",
    },
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    description: "Email campaigns, audience segments, and flows.",
    category: "Marketing",
    Icon: SiMailchimp,
    brand: "#FFE01B",
    methods: ["api_key"],
    apiKey: {
      placeholder: "••••••••••••••••-us21",
      docsUrl:
        "https://mailchimp.com/developer/marketing/guides/quick-start/#generate-your-api-key",
      where: "Mailchimp → Profile → Extras → API keys",
    },
  },
  {
    id: "fathom",
    name: "Fathom",
    description: "Meeting transcripts and recording summaries.",
    category: "Meetings",
    Icon: SiFathom,
    brand: "#9F6EF3",
    methods: ["api_key", "webhook"],
    apiKey: {
      placeholder: "fat_sk_••••••••••••",
      docsUrl: "https://fathom.video/settings/api",
      where: "Fathom → Settings → Developer → API keys",
    },
    webhook: {
      events: ["meeting.ended"],
      instructions:
        "In Fathom → Team Settings → Zapier / Webhooks, add this URL. Fathom will POST the full transcript when a meeting ends.",
    },
    events: [{ id: "fathom.meeting.ended", label: "Meeting ended" }],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Files, folders, and shared drives  -  for agent context.",
    category: "Knowledge",
    Icon: SiGoogledrive,
    brand: "#1FA463",
    methods: ["oauth"],
    oauth: {
      scopes: ["drive.readonly"],
      exampleAccount: "james.oldham0604@gmail.com",
    },
    events: [{ id: "gdrive.file.created", label: "New file in folder" }],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read + send email as the connected user.",
    category: "Comms",
    Icon: SiGmail,
    brand: "#EA4335",
    methods: ["oauth"],
    oauth: {
      scopes: ["gmail.send", "gmail.readonly"],
      exampleAccount: "james.oldham0604@gmail.com",
    },
    events: [{ id: "gmail.email.received", label: "Email received" }],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repos, PRs, issues, code search  -  for engineering agents.",
    category: "Engineering",
    Icon: SiGithub,
    brand: "#181717",
    methods: ["oauth"],
    oauth: {
      scopes: ["repo", "read:user"],
      exampleAccount: "your-handle",
    },
  },
  {
    id: "supabase",
    name: "Supabase",
    description:
      "Provision projects, run migrations, query Postgres  -  across every project the PAT can see.",
    category: "Data",
    Icon: SiSupabase,
    brand: "#3ECF8E",
    methods: ["api_key"],
    connectStrategy: "supabase-pat",
    apiKey: {
      placeholder: "sbp_••••••••••••••••••••••••••••••••••••",
      docsUrl: "https://supabase.com/dashboard/account/tokens",
      where:
        "Supabase Dashboard → Account → Access Tokens → Generate new token",
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Deployments, projects, env vars, and logs.",
    category: "Engineering",
    Icon: SiVercel,
    brand: "#FFFFFF",
    methods: ["oauth"],
    oauth: {
      scopes: ["read", "write"],
      exampleAccount: "rawgrowth team",
    },
  },
  {
    id: "telegram",
    name: "Telegram",
    description:
      "Trigger routines from a Telegram bot. Your team DMs commands from their phones, routines fire.",
    category: "Comms",
    Icon: SiTelegram,
    brand: "#26A5E4",
    methods: ["api_key"],
    connectStrategy: "telegram-bot",
    apiKey: {
      placeholder: "123456789:AAF••••••••••••••••••••••••••••",
      docsUrl: "https://core.telegram.org/bots/tutorial",
      where:
        "Telegram → talk to @BotFather → /newbot → copy the bot token it returns",
    },
  },
  {
    // Apify is a standalone scraping API, not a Composio app. The key
    // is saved + persisted by the "Workspace API keys" card on
    // /connections (provider 'apify' → row 'apify-key'); this catalog
    // entry exists so the agent Tools picker renders a proper name +
    // icon for the apify connector instead of the raw id.
    id: "apify",
    name: "Apify",
    description:
      "Run Apify actors to scrape YouTube / Instagram / Facebook Ads and other public sources.",
    category: "Marketing",
    Icon: ApifyIcon,
    brand: "#FF9013",
    methods: ["api_key"],
    apiKey: {
      placeholder: "apify_api_••••••••••••••••••••••••••••",
      docsUrl: "https://console.apify.com/account/integrations",
      where:
        "Apify Console → Settings → Integrations → API token, then paste it in the Workspace API keys card on /connections",
    },
  },
];

export function getIntegration(id: string): IntegrationEntry | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export function methodLabel(method: AuthMethod): string {
  return method === "api_key"
    ? "API Key"
    : method === "oauth"
      ? "OAuth"
      : "Webhook";
}
