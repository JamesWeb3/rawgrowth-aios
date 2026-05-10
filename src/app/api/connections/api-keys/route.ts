import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret, tryDecryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * Generic third-party API key bag. Stores per-org keys for services
 * Rawclaw integrates programmatically (Apify, OpenAI, Voyage, etc) -
 * the things that can't / shouldn't go through OAuth.
 *
 * Storage: rgaios_connections row per provider, metadata.api_key
 * encrypted (AES-256-GCM via encryptSecret).
 *
 * GET → { keys: [{ provider, hasKey, preview, updated_at }] }
 * PUT body { provider, api_key } → upsert
 * DELETE ?provider=<x> → drop
 */

const KNOWN_PROVIDERS = [
  {
    key: "apify",
    label: "Apify",
    description: "YouTube/Instagram/Facebook Ads scrapers (best-performing content lookup)",
    docsUrl: "https://console.apify.com/account/integrations",
    placeholder: "apify_api_*",
  },
  {
    key: "openai",
    label: "OpenAI",
    description: "Optional fallback embedder + onboarding chat. Default uses fastembed (no key).",
    docsUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-...",
  },
  {
    key: "voyage",
    label: "Voyage AI",
    description: "Optional embedder (better recall than fastembed for short queries).",
    docsUrl: "https://www.voyageai.com/",
    placeholder: "pa-...",
  },
  {
    key: "stripe",
    label: "Stripe",
    description: "Restricted-access secret for revenue/MRR analytics (read-only on charges + customers + subscriptions).",
    docsUrl: "https://dashboard.stripe.com/apikeys",
    placeholder: "rk_live_...",
  },
  {
    key: "shopify",
    label: "Shopify",
    description: "Admin API access token for orders/customers analytics (Shopify Admin → Apps → Develop apps).",
    docsUrl: "https://shopify.dev/docs/apps/auth/admin-app-access-tokens",
    placeholder: "shpat_...",
  },
  {
    key: "ga4",
    label: "Google Analytics 4",
    description: "Service-account JSON for GA4 Data API (sessions, conversions, traffic sources).",
    docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
    placeholder: '{"type":"service_account",...}',
  },
  {
    key: "hubspot",
    label: "HubSpot",
    description: "Private app token (deals/contacts/company read scopes for pipeline analytics).",
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
    placeholder: "pat-na1-...",
  },
  {
    key: "mailchimp",
    label: "Mailchimp",
    description: "API key (audiences, campaigns, revenue per email).",
    docsUrl: "https://mailchimp.com/help/about-api-keys/",
    placeholder: "abc123-us21",
  },
  {
    key: "composio",
    label: "Composio",
    description: "Per-org Composio API key. Overrides the VPS-wide COMPOSIO_API_KEY env when set so each tenant pays for their own action quota.",
    docsUrl: "https://app.composio.dev/settings",
    placeholder: "ck_live_...",
  },
] as const;

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("provider_config_key, metadata, updated_at, connected_at")
    .eq("organization_id", ctx.activeOrgId)
    .in(
      "provider_config_key",
      KNOWN_PROVIDERS.map((p) => `${p.key}-key`),
    );
  const rows = (data ?? []) as Array<{
    provider_config_key: string;
    metadata: { api_key?: string } | null;
    updated_at: string | null;
    connected_at: string | null;
  }>;
  const byKey = new Map(
    rows.map((r) => [r.provider_config_key.replace(/-key$/, ""), r]),
  );
  const keys = KNOWN_PROVIDERS.map((p) => {
    const row = byKey.get(p.key);
    const plain = tryDecryptSecret(row?.metadata?.api_key);
    return {
      provider: p.key,
      label: p.label,
      description: p.description,
      docsUrl: p.docsUrl,
      placeholder: p.placeholder,
      hasKey: Boolean(plain),
      preview: plain ? `${plain.slice(0, 4)}…${plain.slice(-4)}` : null,
      updatedAt: row?.updated_at ?? row?.connected_at ?? null,
    };
  });
  return NextResponse.json({ keys });
}

export async function PUT(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    api_key?: string;
  };
  const provider = String(body.provider ?? "").trim();
  const apiKey = String(body.api_key ?? "").trim();
  if (!KNOWN_PROVIDERS.some((p) => p.key === provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }
  if (!apiKey || apiKey.length < 8) {
    return NextResponse.json({ error: "api_key too short" }, { status: 400 });
  }
  const encrypted = encryptSecret(apiKey);
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin()
    .from("rgaios_connections")
    .upsert(
      {
        organization_id: ctx.activeOrgId,
        provider_config_key: `${provider}-key`,
        status: "connected",
        connected_at: now,
        updated_at: now,
        metadata: { api_key: encrypted } as never,
      } as never,
      { onConflict: "organization_id,provider_config_key" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await supabaseAdmin()
    .from("rgaios_audit_log")
    .insert({
      organization_id: ctx.activeOrgId,
      kind: "api_key_saved",
      actor_type: "user",
      actor_id: ctx.userId ?? "session",
      detail: { provider },
    } as never);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const provider = req.nextUrl.searchParams.get("provider") ?? "";
  if (!KNOWN_PROVIDERS.some((p) => p.key === provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }
  const { error } = await supabaseAdmin()
    .from("rgaios_connections")
    .delete()
    .eq("organization_id", ctx.activeOrgId)
    .eq("provider_config_key", `${provider}-key`);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await supabaseAdmin()
    .from("rgaios_audit_log")
    .insert({
      organization_id: ctx.activeOrgId,
      kind: "api_key_removed",
      actor_type: "user",
      actor_id: ctx.userId ?? "session",
      detail: { provider },
    } as never);
  return NextResponse.json({ ok: true });
}
