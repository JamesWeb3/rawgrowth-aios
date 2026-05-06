import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createClient } from "@/lib/clients/queries";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/webhooks/stripe
 *
 * Auto-deploy-on-payment SCAFFOLD (P2 #9, plan wiggly-hugging-sutherland §9).
 *
 * Flow:
 *   1. Verify the Stripe signature using STRIPE_WEBHOOK_SECRET (HMAC-SHA256).
 *      If the secret is unset, log a warning and trust the body. This keeps
 *      local dev / staging painless while letting prod gate on the secret.
 *   2. Handle `checkout.session.completed` and `customer.subscription.created`:
 *        - Upsert a row in rgaios_provisioning_queue keyed on owner email.
 *        - Best-effort: mirror the existing /api/admin/clients POST flow
 *          by calling createClient() to spin the org row + owner user.
 *          On success, mark the queue row status='ready' so the portal
 *          page renders "your dashboard is live".
 *        - Audit log kind='stripe_provisioning_received'.
 *   3. Always return 200 - Stripe retries on non-2xx so we don't want
 *      a logic bug in here to spawn duplicate orgs across redeliveries.
 *
 * Stripe SDK is intentionally NOT a dependency yet. The signature
 * verification is a hand-rolled HMAC matching Stripe's documented
 * scheme (t=...,v1=...). Once we install `stripe`, swap the inline
 * verify for stripe.webhooks.constructEvent and drop verifySignature().
 */

type StripeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      customer?: string;
      customer_email?: string;
      customer_details?: { email?: string; name?: string };
      subscription?: string;
      metadata?: Record<string, string>;
      // customer.subscription.created shape
      items?: {
        data?: Array<{
          price?: { product?: string; nickname?: string };
        }>;
      };
    };
  };
};

/**
 * Verify a Stripe webhook signature header without the SDK.
 *
 * Header shape: `t=<unix-ts>,v1=<hex>,v0=<hex-deprecated>`
 * Signed payload: `<unix-ts>.<rawBody>`
 * Compare against HMAC-SHA256(secret, signed_payload).
 *
 * Tolerance window: 5 min (Stripe's default).
 */
function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const idx = p.indexOf("=");
      return idx > 0 ? [p.slice(0, idx), p.slice(idx + 1)] : [p, ""];
    }),
  );
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  // 5 minute tolerance
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");
  // timingSafeEqual requires equal-length buffers
  if (expected.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}

function generateTempPassword(): string {
  // 24 chars of base64url, ~144 bits of entropy. Safe to print in audit
  // log since the operator emails it to the buyer on first login anyway
  // (and the next-auth password reset flow rotates it on first sign in).
  return crypto.randomBytes(18).toString("base64url");
}

function pickEmail(obj: StripeEvent["data"] extends infer D
  ? D extends { object?: infer O }
    ? O
    : never
  : never): string | null {
  if (!obj) return null;
  return (
    obj.customer_details?.email ??
    obj.customer_email ??
    obj.metadata?.email ??
    null
  );
}

function pickName(obj: StripeEvent["data"] extends infer D
  ? D extends { object?: infer O }
    ? O
    : never
  : never): string | null {
  if (!obj) return null;
  return (
    obj.customer_details?.name ??
    obj.metadata?.name ??
    null
  );
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // ─── 1. Signature verification ─────────────────────────────────
  if (endpointSecret) {
    const ok = verifyStripeSignature(rawBody, signature, endpointSecret);
    if (!ok) {
      console.warn("[stripe-webhook] signature verification failed");
      // Still return 200 so Stripe doesn't keep retrying a request we'll
      // never accept, but record nothing else.
      return NextResponse.json({ ok: false, reason: "bad signature" });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Prod with no STRIPE_WEBHOOK_SECRET = anyone can POST a fake
    // checkout.session.completed and trigger createClient(). Refuse
    // rather than spawn orgs from unverified bodies.
    console.error(
      "[stripe-webhook] STRIPE_WEBHOOK_SECRET unset in production - refusing",
    );
    return NextResponse.json(
      { ok: false, reason: "webhook secret not configured" },
      { status: 500 },
    );
  } else {
    console.warn(
      "[stripe-webhook] STRIPE_WEBHOOK_SECRET unset - trusting body without signature check (non-prod)",
    );
  }

  // ─── 2. Parse event ────────────────────────────────────────────
  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad json" });
  }

  const type = event.type;
  const obj = event.data?.object;
  if (!type || !obj) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Only react to the two events that signal "this client paid, start
  // building their dashboard". Other events (invoice.paid,
  // payment_intent.succeeded, etc.) are no-ops for now.
  if (
    type !== "checkout.session.completed" &&
    type !== "customer.subscription.created"
  ) {
    return NextResponse.json({ ok: true, ignored: type });
  }

  const ownerEmail = pickEmail(obj);
  if (!ownerEmail) {
    console.warn(`[stripe-webhook] ${type} missing email - ignoring`);
    return NextResponse.json({ ok: true, ignored: "no email" });
  }
  const ownerName = pickName(obj);
  const stripeCustomerId =
    typeof obj.customer === "string" ? obj.customer : null;
  const stripeSubscriptionId =
    typeof obj.subscription === "string"
      ? obj.subscription
      : type === "customer.subscription.created" && obj.id
        ? obj.id
        : null;
  const planName =
    obj.items?.data?.[0]?.price?.nickname ??
    obj.metadata?.plan_name ??
    null;

  const db = supabaseAdmin();

  // ─── 3. Upsert pending queue row ───────────────────────────────
  // Look up by lower(email) since the unique index is case-insensitive.
  const lowerEmail = ownerEmail.trim().toLowerCase();
  const { data: existing } = await db
    .from("rgaios_provisioning_queue")
    .select("id, status, organization_id")
    .ilike("owner_email", lowerEmail)
    .in("status", ["pending", "provisioning", "ready"])
    .maybeSingle();

  let queueRowId: string | null = existing?.id ?? null;

  if (!existing) {
    const { data: inserted, error: insertErr } = await db
      .from("rgaios_provisioning_queue")
      .insert({
        owner_email: lowerEmail,
        owner_name: ownerName,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        plan_name: planName,
        status: "pending",
        metadata: { stripe_event_id: event.id ?? null, source_event: type },
      })
      .select("id")
      .single();
    if (insertErr) {
      console.error(
        `[stripe-webhook] queue insert failed: ${insertErr.message}`,
      );
      // Still return 200 - if we 500 here Stripe will hammer us with
      // retries and we'd rather investigate from the log.
      return NextResponse.json({ ok: false, reason: "queue insert" });
    }
    queueRowId = inserted?.id ?? null;
  }

  // ─── 4. Best-effort: spin the org via the existing createClient flow ──
  // This mirrors what /api/admin/clients POST does today. If it fails
  // (duplicate user, slug collision, etc.) we leave the queue row in
  // 'pending' so the operator can intervene by hand.
  let provisioningError: string | null = null;
  let orgId = existing?.organization_id ?? null;
  if (!orgId) {
    try {
      const tempPassword = generateTempPassword();
      const orgDisplayName =
        ownerName ?? lowerEmail.split("@")[0] ?? "New Client";
      const result = await createClient({
        name: orgDisplayName,
        ownerEmail: lowerEmail,
        ownerName: ownerName ?? undefined,
        ownerPassword: tempPassword,
      });
      orgId = result.org.id;
      // Stash the temp password in metadata so the operator can email it.
      // Acceptable for trial - rotate post-trial behind a proper invite link.
      if (queueRowId) {
        await db
          .from("rgaios_provisioning_queue")
          .update({
            organization_id: orgId,
            metadata: {
              stripe_event_id: event.id ?? null,
              source_event: type,
              org_slug: result.org.slug,
              temp_password: tempPassword,
            },
          })
          .eq("id", queueRowId);
      }
    } catch (err) {
      provisioningError = (err as Error).message;
      console.error(`[stripe-webhook] createClient failed: ${provisioningError}`);
    }
  }

  // ─── 5. Flip queue row to 'ready' if SHARED_VPS_HOST is set ────
  // SHARED_VPS_HOST is the trial-mode shortcut: every new buyer lands
  // on the same VPS that pre-exists. Once we wire real per-tenant
  // provisioning (DigitalOcean API + DNS), drop this block and let the
  // worker flip status='ready' instead.
  const sharedHost = process.env.SHARED_VPS_HOST?.trim() || null;
  if (queueRowId && orgId && !provisioningError) {
    const dashboardUrl = sharedHost
      ? `${sharedHost.replace(/\/$/, "")}/auth/signin`
      : null;
    await db
      .from("rgaios_provisioning_queue")
      .update({
        status: "ready",
        vps_host: sharedHost,
        dashboard_url: dashboardUrl,
      })
      .eq("id", queueRowId);

    // Send welcome email so the buyer gets their dashboard URL +
    // temp password without operator handoff. Only fires when we
    // have all three: dashboard URL, temp password (fresh org we
    // just provisioned), and a recipient. Best-effort - email
    // failure doesn't roll back provisioning.
    if (dashboardUrl && lowerEmail) {
      try {
        const { data: queueRow } = await db
          .from("rgaios_provisioning_queue")
          .select("metadata")
          .eq("id", queueRowId)
          .maybeSingle();
        const tempPassword =
          (queueRow as { metadata: { temp_password?: string } } | null)
            ?.metadata?.temp_password ?? "";
        if (tempPassword) {
          const { sendWelcomeEmail } = await import("@/lib/auth/email");
          await sendWelcomeEmail({
            to: lowerEmail,
            dashboardUrl,
            tempPassword,
            organizationName:
              ownerName ?? lowerEmail.split("@")[0] ?? "your workspace",
          });
        }
      } catch (err) {
        console.error(
          `[stripe-webhook] welcome email failed for ${lowerEmail}: ${(err as Error).message}`,
        );
      }
    }
  } else if (queueRowId && provisioningError) {
    await db
      .from("rgaios_provisioning_queue")
      .update({ status: "error", error: provisioningError })
      .eq("id", queueRowId);
  }

  // ─── 6. Audit log ──────────────────────────────────────────────
  await db.from("rgaios_audit_log").insert({
    organization_id: orgId,
    kind: "stripe_provisioning_received",
    actor_type: "system",
    actor_id: "stripe-webhook",
    detail: {
      event_id: event.id ?? null,
      event_type: type,
      owner_email: lowerEmail,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      queue_row_id: queueRowId,
      provisioning_error: provisioningError,
    },
  });

  return NextResponse.json({ ok: true, queue_row_id: queueRowId });
}
