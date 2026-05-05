"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SalesCallUploader } from "@/components/onboarding/SalesCallUploader";

type PollResult = {
  ok?: boolean;
  scanned?: number;
  inserted?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
};

/**
 * /sales-calls client wrapper. Hosts:
 *   - the existing audio uploader (manual drop)
 *   - the manual "Sync from Fireflies" trigger that POSTs
 *     /api/sales-calls/fireflies/poll with the user's session - server
 *     reads the org's Fireflies connection (rgaios_connections,
 *     provider_config_key='fireflies') and pulls new transcripts. Cron
 *     hits the same endpoint with the CRON_SECRET bearer; this button
 *     exists for "I just connected, give me my data now" UX.
 */
export function SalesCallsClient() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function syncFromFireflies() {
    if (syncing) return;
    setSyncing(true);
    const toastId = toast.loading("Syncing from Fireflies...");
    try {
      const res = await fetch("/api/sales-calls/fireflies/poll", {
        method: "POST",
      });
      const body = (await res.json()) as PollResult;
      const errs = body.errors ?? [];
      if (!res.ok && body.error) {
        throw new Error(body.error);
      }
      if (errs.length > 0 && (body.inserted ?? 0) === 0) {
        toast.error(errs[0] ?? "sync failed", { id: toastId });
      } else {
        const ins = body.inserted ?? 0;
        const sk = body.skipped ?? 0;
        toast.success(
          ins === 0
            ? `Up to date (skipped ${sk})`
            : `Synced ${ins} new call${ins === 1 ? "" : "s"}`,
          {
            id: toastId,
            description:
              errs.length > 0
                ? `${errs.length} non-fatal error(s); see logs`
                : undefined,
          },
        );
        router.refresh();
      }
    } catch (err) {
      toast.error((err as Error).message, { id: toastId });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={syncFromFireflies}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 size-3.5" />
          )}
          {syncing ? "Syncing..." : "Sync from Fireflies"}
        </Button>
      </div>
      <SalesCallUploader
        onFinish={() => {
          /* standalone page - no onboarding chat handoff needed */
        }}
      />
    </div>
  );
}
