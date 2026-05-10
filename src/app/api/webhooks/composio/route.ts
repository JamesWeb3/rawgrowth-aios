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

  try {
    if (type === "connection.revoked") {
      const connId = pickConnectionId(event);
      if (!connId) {
        console.warn("[composio-webhook] revoked event missing connectionId");
        return NextResponse.json({ ok: true, ignored: "no connectionId" });
      }
      const { data: row } = await db
        .from("rgaios_connections")
        .update({ status: "error" })
        .eq("nango_connection_id", connId)
        .select("id, organization_id")
        .maybeSingle();
      await db.from("rgaios_audit_log").insert({
        organization_id: row?.organization_id ?? null,
        kind: "composio_connection_revoked",
        actor_type: "system",
        actor_id: "composio-webhook",
        detail: { connection_id: connId, row_id: row?.id ?? null },
      });
      return NextResponse.json({ ok: true, type, row_id: row?.id ?? null });
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
        detail: { event },
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
