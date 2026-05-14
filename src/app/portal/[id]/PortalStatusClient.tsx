"use client";

import { useEffect, useState } from "react";

export type QueueStatus =
  | "pending"
  | "provisioning"
  | "ready"
  | "error"
  | "cancelled";

type StatusBody = {
  status: QueueStatus;
  dashboard_url: string | null;
  error: string | null;
};

interface Props {
  id: string;
  initialStatus: QueueStatus;
  initialDashboardUrl: string | null;
  initialError: string | null;
}

// ETA copy is informational only - the real source of truth is the
// /api/provisioning/status row. Keep the message honest: cloud-init
// finishes in ~3 to 5 min on Hetzner cx22, longer on first DNS issuance.
const STATUS_COPY: Record<
  QueueStatus,
  { label: string; description: string; tone: "active" | "ready" | "error" }
> = {
  pending: {
    label: "Queued",
    description:
      "Order received. We are about to spin up your environment. This usually starts within a minute.",
    tone: "active",
  },
  provisioning: {
    label: "Provisioning",
    description:
      "Caddy, Docker, and the drain server are installing on your VPS. Most builds finish in 3 to 5 minutes.",
    tone: "active",
  },
  ready: {
    label: "Ready",
    description:
      "Your workspace is live. Continue below to sign in and start onboarding. We also emailed this link to you.",
    tone: "ready",
  },
  error: {
    label: "Hit a snag",
    description:
      "Provisioning ran into an issue. Our team has been pinged and will reach out shortly.",
    tone: "error",
  },
  cancelled: {
    label: "Cancelled",
    description: "This order was cancelled. Reach out if you think this is wrong.",
    tone: "error",
  },
};

export function PortalStatusClient({
  id,
  initialStatus,
  initialDashboardUrl,
  initialError,
}: Props) {
  const [status, setStatus] = useState<QueueStatus>(initialStatus);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(
    initialDashboardUrl,
  );
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    if (status === "ready" || status === "error" || status === "cancelled") {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      // Prefer the /api/portal/[id]/status alias - same payload, cleaner
      // namespace under /portal. Fall back to the legacy provisioning
      // path if the alias 404s on an older deploy that hasn't picked up
      // the new route yet.
      try {
        let res = await fetch(`/api/portal/${id}/status`, {
          cache: "no-store",
        });
        if (res.status === 404) {
          res = await fetch(`/api/provisioning/status/${id}`, {
            cache: "no-store",
          });
        }
        if (!res.ok) return;
        const body = (await res.json()) as StatusBody;
        if (cancelled) return;
        setStatus(body.status);
        setDashboardUrl(body.dashboard_url);
        setError(body.error);
      } catch {
        // Transient. Try again next tick.
      }
    }

    timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [id, status]);

  const meta = STATUS_COPY[status] ?? STATUS_COPY.pending;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-3">
        <span
          className={
            meta.tone === "ready"
              ? "size-2 rounded-full bg-emerald-400"
              : meta.tone === "error"
                ? "size-2 rounded-full bg-rose-400"
                : "size-2 animate-pulse rounded-full bg-emerald-300"
          }
        />
        <h2 className="text-base font-medium">{meta.label}</h2>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-white/70">
        {meta.description}
      </p>

      {status === "ready" && dashboardUrl ? (
        <>
          <a
            href={dashboardUrl}
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-medium text-black transition hover:bg-emerald-400"
          >
            Continue to your workspace
          </a>
          {/* Show the bare URL too so a buyer who emails this to a
              colleague (or saves it for later) sees where they'll land
              before clicking. Important for trust on a brand-new
              subdomain they've never seen before. */}
          <p className="mt-3 text-xs text-white/40 break-all">{dashboardUrl}</p>
        </>
      ) : null}

      {/* Edge case: status=='ready' but dashboard_url is null. Should
          not happen in normal flow (both webhook and provision-tick
          set them together) but if it does, tell the buyer to refresh
          rather than render a dead state. */}
      {status === "ready" && !dashboardUrl ? (
        <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Workspace marked ready but the URL has not propagated yet. Refresh in a few seconds.
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}
    </section>
  );
}
