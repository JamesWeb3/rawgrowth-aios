import { NextResponse, type NextRequest } from "next/server";
import { deleteConnection, getConnection } from "@/lib/connections/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { deleteWebhook as deleteTelegramWebhook } from "@/lib/telegram/client";
import { tryDecryptSecret } from "@/lib/crypto";
import { resolveComposioApiKey } from "@/lib/composio/proxy";

export const runtime = "nodejs";

/**
 * DELETE /api/connections/[providerConfigKey]
 * Revokes the connection at the upstream provider, then removes our row.
 * Three strategies:
 *   - composio:<id> => DELETE Composio connectedAccounts (OAuth revoke)
 *   - telegram      => deleteWebhook on the bot token
 *   - bespoke (stripe / supabase PAT / etc) => local row delete is the
 *     authoritative teardown; the secret never left this VPS.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ providerConfigKey: string }> },
) {
  try {
    const { providerConfigKey } = await params;
    const organizationId = await currentOrganizationId();
    const existing = await getConnection(organizationId, providerConfigKey);
    if (!existing) {
      return NextResponse.json({ ok: true, already: "disconnected" });
    }

    if (providerConfigKey === "telegram") {
      const token = tryDecryptSecret(
        (existing.metadata as { bot_token?: string } | null)?.bot_token,
      );
      if (token) {
        try {
          await deleteTelegramWebhook(token);
        } catch {
          /* ignore  -  token might already be invalid upstream */
        }
      }
    } else if (providerConfigKey.startsWith("composio:")) {
      // Composio swap gap #3: revoke at Composio so the upstream OAuth
      // grant is actually torn down, not just the local row. The grid
      // POST stored connectionId in nango_connection_id. Per-org key
      // first, then env fallback - matches composioCall + the OAuth
      // start route so revoke targets the same Composio tenant.
      const composioKey = await resolveComposioApiKey(organizationId);
      if (composioKey && existing.nango_connection_id) {
        try {
          // v3 endpoint - same DELETE shape, just /api/v3/connected_accounts.
          await fetch(
            `https://backend.composio.dev/api/v3/connected_accounts/${existing.nango_connection_id}`,
            {
              method: "DELETE",
              headers: { "x-api-key": composioKey },
              signal: AbortSignal.timeout(15_000),
            },
          );
        } catch (err) {
          console.warn(
            "[connections] composio revoke failed:",
            (err as Error).message,
          );
        }
      }
    }
    // Bespoke providers (Stripe API key, Supabase PAT, etc) stored
    // their secret in metadata; the local delete is the authoritative
    // teardown. Composio + Telegram are handled in the branches above.

    await deleteConnection(organizationId, providerConfigKey);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
