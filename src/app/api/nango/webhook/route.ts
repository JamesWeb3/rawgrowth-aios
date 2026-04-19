import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { upsertConnection, deleteConnection } from "@/lib/connections/queries";
import { nango } from "@/lib/nango/server";

export const runtime = "nodejs";

/**
 * POST /api/nango/webhook
 *
 * Receives Nango platform events:
 *  - auth: a new connection was created or refreshed
 *  - sync: sync ran (unused for MVP)
 *  - webhook: forwarded webhook from a provider (unused for MVP)
 *
 * We persist auth events to rgaios_connections.
 *
 * Signature verification: Nango signs the body with NANGO_WEBHOOK_SECRET
 * (set in the Nango dashboard Environment → Webhook section).
 */

function verifySignature(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.NANGO_WEBHOOK_SECRET;
  if (!secret) return true; // in dev we skip verification if secret isn't set
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signatureHeader, "hex"),
    );
  } catch {
    return false;
  }
}

type NangoWebhookEvent = {
  type: "auth" | "sync" | "webhook";
  operation?: "creation" | "refresh" | "deletion";
  connectionId?: string;
  providerConfigKey?: string;
  success?: boolean;
  endUser?: { endUserId: string };
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-nango-signature");

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: NangoWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // We only care about auth events for now.
  if (event.type !== "auth") {
    return NextResponse.json({ ok: true, skipped: event.type });
  }

  if (!event.success) {
    await logAudit("connection_failed", { event });
    return NextResponse.json({ ok: true });
  }

  const { connectionId, providerConfigKey, operation, endUser } = event;
  if (!connectionId || !providerConfigKey) {
    return NextResponse.json(
      { error: "missing fields" },
      { status: 400 },
    );
  }

  const organizationId = endUser?.endUserId;
  if (!organizationId) {
    return NextResponse.json(
      { error: "missing endUser.endUserId (organization_id)" },
      { status: 400 },
    );
  }

  if (operation === "deletion") {
    await deleteConnection(organizationId, providerConfigKey);
    await logAudit("connection_deleted", { providerConfigKey }, organizationId);
    return NextResponse.json({ ok: true });
  }

  // creation or refresh — pull the connection so we can store display name
  let displayName: string | null = null;
  try {
    const conn = await nango().getConnection(providerConfigKey, connectionId);
    displayName =
      // Common identifiers across providers — first one that exists wins
      (conn.credentials as { email?: string } | undefined)?.email ??
      (conn.connection_config as { login?: string } | undefined)?.login ??
      (conn.connection_config as { email?: string } | undefined)?.email ??
      null;
  } catch {
    /* non-fatal — we'll store the connection without a display name */
  }

  await upsertConnection({
    organizationId,
    providerConfigKey,
    nangoConnectionId: connectionId,
    displayName,
  });

  await logAudit(
    "connection_connected",
    { providerConfigKey, operation, displayName },
    organizationId,
  );

  return NextResponse.json({ ok: true });
}

async function logAudit(
  kind: string,
  detail: Record<string, unknown>,
  organizationId?: string,
) {
  await supabaseAdmin()
    .from("rgaios_audit_log")
    .insert({
      organization_id: organizationId ?? null,
      kind,
      actor_type: "system",
      actor_id: "nango-webhook",
      detail,
    });
}
