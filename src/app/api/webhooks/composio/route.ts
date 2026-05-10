import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/webhooks/composio
 *
 * PR 4 of the Composio + RAG hardening plan. Closes the silent-rot
 * failure mode: today, when a user revokes the OAuth grant upstream
 * (Google account screen, Slack workspace admin) we have no signal,
 * so the row stays status='connected' and every action call 401s
 * until somebody manually digs in.
 *
 * Composio dashboard fires three event types we care about:
 *   - connection.revoked   -> flip row to status='error' + audit
 *   - connection.refreshed -> rotate metadata.access_token (encrypted)
 *   - action.failed        -> append to audit log so the activity feed
 *                              surfaces failures + we can build a UI
 *                              badge per row later
 *
 * Auth: HMAC-SHA256 of the raw body using COMPOSIO_WEBHOOK_SECRET,
 * delivered as the `x-composio-signature` header (hex). Without the
 * env var set, we 401 every event so a misconfigured prod box can't
 * accept poisoned bodies. With the env var set but a bad signature
 * we also 401 - Composio retries on non-2xx so the dashboard surfaces
 * delivery failures and the operator can fix the secret.
 *
 * Always return 200 once auth + parse pass even when the inner branch
 * is a no-op or hits a DB error. Composio retries on non-2xx and we'd
 * rather investigate from the log than chase amplifying retry storms.
 *
 * Public route: middleware allowlists `/api/webhooks/*` (signature
 * gates auth, no cookie session). See src/proxy.ts.
 */

type ComposioEvent = {
  /**
   * Composio event id used for idempotency. Composio retries on
   * timeout / non-2xx delivery; without a dedup key the same event
   * can flip status + insert an audit row twice. Older API shapes
   * may omit this - in which case we proceed without dedup.
   */
  id?: string;
  type?: string;
  /** Top-level connection id Composio assigns (matches our nango_connection_id column). */
  connectionId?: string;
  /** Older event shape nests the connection id under data. */
  data?: {
    connectionId?: string;
    connection_id?: string;
  };
  payload?: {
    /** Refreshed event delivers the new access token here. */
    access_token?: string;
    accessToken?: string;
    refresh_token?: string;
    refreshToken?: string;
    expires_at?: string | number;
  };
  /** Pass-through for action.failed for the audit log detail. */
  [k: string]: unknown;
};

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Verify HMAC-SHA256 of `rawBody` using `secret`. Composio docs accept
 * either a hex digest or `sha256=<hex>` style. Accept both shapes so a
 * dashboard convention swap doesn't silently break the handler.
 */
function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return timingSafeHexEqual(expected.toLowerCase(), provided.toLowerCase());
}

function pickConnectionId(event: ComposioEvent): string | null {
  return (
    event.connectionId ??
    event.data?.connectionId ??
    event.data?.connection_id ??
    null
  );
}

function pickAccessToken(event: ComposioEvent): string | null {
  return event.payload?.access_token ?? event.payload?.accessToken ?? null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-composio-signature");
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;

  // Hard-fail when the secret is missing. Soft-required in env.ts so
  // the rest of the app boots without it; THIS handler refuses to
  // accept events without the verification path proving the body came
  // from Composio. Mirrors fail-closed pattern in failClosedIfProd.
  if (!secret) {
    console.warn(
      "[composio-webhook] COMPOSIO_WEBHOOK_SECRET unset - refusing event",
    );
    return NextResponse.json(
      { ok: false, reason: "secret unset" },
      { status: 401 },
    );
  }

  if (!verifySignature(rawBody, signature, secret)) {
    console.warn("[composio-webhook] signature verification failed");
    return NextResponse.json(
      { ok: false, reason: "bad signature" },
      { status: 401 },
    );
  }

  let event: ComposioEvent;
  try {
    event = JSON.parse(rawBody) as ComposioEvent;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad json" }, { status: 200 });
  }

  const type = (event.type ?? "").toString();
  const db = supabaseAdmin();
  const eventId = typeof event.id === "string" && event.id.length > 0 ? event.id : null;

  // Idempotency: Composio retries on timeout / non-2xx. Without dedup
  // the same event can double-flip status + insert duplicate audit
  // rows. If event.id is set, look it up in the audit log first; if
  // we've already processed it, ack immediately. Older Composio API
  // shapes don't include an id - in that case we proceed as before.
  if (eventId) {
    const { data: prior } = await db
      .from("rgaios_audit_log")
      .select("id")
      .eq("detail->>composio_event_id", eventId)
      .limit(1)
      .maybeSingle();
    if (prior?.id) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  try {
    if (type === "connection.revoked") {
      const connId = pickConnectionId(event);
      if (!connId) {
        console.warn("[composio-webhook] revoked event missing connectionId");
        return NextResponse.json({ ok: true, ignored: "no connectionId" });
      }
      // Two-step: (1) lookup the row by connectionId so we know its
      // primary key + organization_id, (2) update keyed on the primary
      // key. Updating directly on nango_connection_id alone would
      // cross tenants if Composio ever delivered an event for org A's
      // connection to org B's webhook (or if connection ids ever
      // collided across tenants).
      const { data: row } = await db
        .from("rgaios_connections")
        .select("id, organization_id")
        .eq("nango_connection_id", connId)
        .maybeSingle();
      if (!row?.id) {
        console.warn(
          `[composio-webhook] revoked event for unknown connectionId=${connId}`,
        );
        await db.from("rgaios_audit_log").insert({
          organization_id: null,
          kind: "composio_connection_revoked_unknown_id",
          actor_type: "system",
          actor_id: "composio-webhook",
          detail: { connection_id: connId, composio_event_id: eventId },
        });
        return NextResponse.json({ ok: true, type, row_id: null });
      }
      await db
        .from("rgaios_connections")
        .update({ status: "error" })
        .eq("id", row.id);
      await db.from("rgaios_audit_log").insert({
        organization_id: row.organization_id ?? null,
        kind: "composio_connection_revoked",
        actor_type: "system",
        actor_id: "composio-webhook",
        detail: { connection_id: connId, row_id: row.id, composio_event_id: eventId },
      });
      return NextResponse.json({ ok: true, type, row_id: row.id });
    }

    if (type === "connection.refreshed") {
      const connId = pickConnectionId(event);
      const accessToken = pickAccessToken(event);
      if (!connId || !accessToken) {
        console.warn(
          "[composio-webhook] refreshed event missing connectionId or token",
        );
        return NextResponse.json({ ok: true, ignored: "missing fields" });
      }
      // Pull existing metadata so we don't clobber sibling fields
      // (display_name, scopes, expires_at, etc) when overwriting the
      // access_token.
      const { data: existing } = await db
        .from("rgaios_connections")
        .select("id, organization_id, metadata")
        .eq("nango_connection_id", connId)
        .maybeSingle();
      const meta = (existing?.metadata as Record<string, unknown> | null) ?? {};
      const refreshToken =
        event.payload?.refresh_token ?? event.payload?.refreshToken ?? null;
      const nextMeta: Record<string, unknown> = {
        ...meta,
        access_token: encryptSecret(accessToken),
      };
      if (refreshToken) {
        nextMeta.refresh_token = encryptSecret(refreshToken);
      }
      if (event.payload?.expires_at !== undefined) {
        nextMeta.expires_at = event.payload.expires_at;
      }
      await db
        .from("rgaios_connections")
        .update({ metadata: nextMeta, status: "connected" })
        .eq("nango_connection_id", connId);
      await db.from("rgaios_audit_log").insert({
        organization_id: existing?.organization_id ?? null,
        kind: "composio_connection_refreshed",
        actor_type: "system",
        actor_id: "composio-webhook",
        detail: {
          connection_id: connId,
          row_id: existing?.id ?? null,
          rotated_refresh_token: refreshToken !== null,
          composio_event_id: eventId,
        },
      });
      return NextResponse.json({ ok: true, type, row_id: existing?.id ?? null });
    }

    if (type === "action.failed") {
      const connId = pickConnectionId(event);
      let orgId: string | null = null;
      if (connId) {
        const { data: row } = await db
          .from("rgaios_connections")
          .select("organization_id")
          .eq("nango_connection_id", connId)
          .maybeSingle();
        orgId = row?.organization_id ?? null;
      }
      await db.from("rgaios_audit_log").insert({
        organization_id: orgId,
        kind: "composio_action_failed",
        actor_type: "system",
        actor_id: "composio-webhook",
        detail: { event, composio_event_id: eventId },
      });
      return NextResponse.json({ ok: true, type });
    }

    // Unknown / future event types: ack so Composio stops retrying,
    // but log so we notice when the dashboard adds something new.
    console.info(`[composio-webhook] ignored event type='${type}'`);
    return NextResponse.json({ ok: true, ignored: type });
  } catch (err) {
    // Always 200 even on internal failure (DB hiccup, malformed
    // payload past auth). Retries from Composio would just amplify the
    // problem; the audit log + console.error give us the trail.
    console.error(
      `[composio-webhook] handler error type=${type}: ${(err as Error).message}`,
    );
    return NextResponse.json({ ok: false, reason: "handler error" });
  }
}
