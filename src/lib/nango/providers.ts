/**
 * Maps our internal integration ids (from integrations-catalog.ts) to
 * the `providerConfigKey` you register in the Nango dashboard.
 *
 * Keeping this separate from the catalog means we can evolve the two
 * independently — the catalog describes the *product surface* (brand,
 * description, which auth methods are available), and this map is the
 * runtime wiring to Nango.
 *
 * When adding a new integration:
 *  1. Create a provider config in Nango dashboard (give it any key).
 *  2. Add the key here mapped to the catalog integration id.
 *  3. (If OAuth) Paste your provider OAuth app's client id/secret
 *     into the Nango config.
 */

export const NANGO_PROVIDER_CONFIG_KEYS: Record<string, string> = {
  "google-drive": "google-drive",
  gmail: "google-mail",
  "google-analytics": "google-analytics",
  shopify: "shopify",
  stripe: "stripe",
  hubspot: "hubspot",
  slack: "slack",
  notion: "notion",
  mailchimp: "mailchimp",
  fathom: "fathom",
  meta: "facebook",
  // canva, outlook, telegram — add as you register them in Nango
};

export function providerConfigKeyFor(integrationId: string): string | null {
  return NANGO_PROVIDER_CONFIG_KEYS[integrationId] ?? null;
}
