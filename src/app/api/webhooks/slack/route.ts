import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";
import { verifySlackSignature } from "@/lib/slack/client";
import {
  handleSlackEvent,
  type SlackInnerEvent,
} from "@/lib/slack/event-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/webhooks/slack
 *
 * Single endpoint that handles:
 *   1. URL verification (first time Slack activates the events URL —
 *      Slack sends { type: "url_verification", challenge: "..." } and
 *      expects us to echo the challenge back verbatim).
 *   2. All subsequent event_callback deliveries.
 *
 * Auth: we verify the X-Slack-Signature HMAC using the signing_secret
 * we stored at app-config time. The signature covers the raw body +
 * timestamp so we read the body as text first, then parse.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  // Parse body (needed for url_verification + team_id lookup).
  let body: {
    type?: string;
    challenge?: string;
    team_id?: string;
    event?: SlackInnerEvent;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // ─── 1. URL verification (no signature expected yet — Slack's first
  // activation call doesn't include auth headers in some cases, but new
  // installs do. Verify if present, allow through if not, since the
  // only thing we do here is echo the challenge). ────────────────────
  if (body.type === "url_verification" && body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  // ─── 2. Signature verification for real events ──────────────────
  // Resolve this org's signing_secret. Single-org per VPS → single row.
  const { data: conn } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("metadata")
    .eq("provider_config_key", "slack")
    .limit(1)
    .maybeSingle();
  const meta = (conn?.metadata ?? {}) as {
    signing_secret?: string;
    team_id?: string;
  };
  const signingSecret = tryDecryptSecret(meta.signing_secret);
  if (!signingSecret) {
    return NextResponse.json(
      { error: "signing secret missing — Slack App creds not configured" },
      { status: 500 },
    );
  }
  const signatureOk = await verifySlackSignature({
    signingSecret,
    timestamp,
    signature,
    rawBody,
  });
  if (!signatureOk) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // ─── 3. Confirm team_id matches what we have installed ─────────
  if (body.team_id && meta.team_id && body.team_id !== meta.team_id) {
    // Shouldn't happen in the single-org-per-VPS model, but belt-and-braces.
    return NextResponse.json({ error: "unexpected team" }, { status: 403 });
  }

  // ─── 4. Dispatch event processing asynchronously ───────────────
  // Return 200 immediately so Slack's 3s timeout never fires. The
  // agent chat + reply happen in `after()`.
  if (body.type === "event_callback" && body.event && body.team_id) {
    const origin = (
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      req.nextUrl.origin
    ).replace(/\/$/, "");

    const teamId = body.team_id;
    const event = body.event;

    after(async () => {
      // Resolve org name for persona prompt.
      const { data: orgRow } = await supabaseAdmin()
        .from("rgaios_organizations")
        .select("name")
        .limit(1)
        .maybeSingle();
      try {
        await handleSlackEvent({
          teamId,
          event,
          organizationName: orgRow?.name ?? null,
          publicAppUrl: origin,
        });
      } catch (err) {
        console.error(`[slack-webhook] handler threw: ${(err as Error).message}`);
      }
    });

    return NextResponse.json({ ok: true });
  }

  // Unknown / ignored event type
  return NextResponse.json({ ok: true, ignored: body.type });
}
