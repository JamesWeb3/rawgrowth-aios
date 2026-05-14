/**
 * Resolves the rgaios_connections.provider_config_key for a given
 * catalog integration id. Composio is the only outbound proxy now
 * (Pedro removed Nango on 2026-05-07), so OAuth providers all live
 * under the "composio:<id>" namespace. Bespoke providers that have
 * their own server-side auth flow (Telegram bot tokens, Stripe API
 * keys, Supabase PATs) keep their dedicated key without the prefix.
 *
 * Adding a new integration:
 *  1. Add the catalog entry in src/lib/connections/catalog.ts
 *  2. If it's an OAuth provider Composio supports → no change here,
 *     it'll resolve to "composio:<key>" automatically.
 *  3. If it's a bespoke key/PAT flow → add it to BESPOKE_KEYS below.
 */

const BESPOKE_KEYS: Record<string, string> = {
  telegram: "telegram",
  stripe: "stripe",
  supabase: "supabase",
  // Apify is a standalone API (api.apify.com), not a Composio app.
  // Its key is stored by /api/connections/api-keys under the
  // provider_config_key 'apify-key', so the apify tools'
  // requiresIntegration guard resolves to that row instead of the
  // wrong 'composio:apify' namespace.
  apify: "apify-key",
};

export function providerConfigKeyFor(integrationId: string): string | null {
  if (!integrationId) return null;
  const bespoke = BESPOKE_KEYS[integrationId];
  if (bespoke) return bespoke;
  return `composio:${integrationId}`;
}
