import { NextResponse, type NextRequest } from "next/server";
import { nango } from "@/lib/nango/server";
import { deleteConnection, getConnection } from "@/lib/connections/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { deleteWebhook as deleteTelegramWebhook } from "@/lib/telegram/client";
import { tryDecryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * DELETE /api/connections/[providerConfigKey]
 * Revokes the connection at the upstream provider, then removes our row.
 * Handles two strategies: Nango (default) and Telegram (bot-token + webhook).
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
          /* ignore — token might already be invalid upstream */
        }
      }
    } else {
      // Best-effort revoke in Nango; local delete is authoritative.
      try {
        await nango().deleteConnection(
          providerConfigKey,
          existing.nango_connection_id,
        );
      } catch {
        /* ignore — connection might already be gone upstream */
      }
    }

    await deleteConnection(organizationId, providerConfigKey);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
